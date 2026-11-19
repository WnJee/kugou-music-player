/**
 * 网络请求层 (src/services/http.ts)
 * 基于 @tauri-apps/plugin-http 封装，彻底绕过 CORS 跨域限制，支持桌面端与移动端
 *
 * 约定：
 * 1. 超时覆盖「建连 + 响应头 + 读取 body」整段，不是只卡到响应头；
 * 2. 任何进入 message / 日志的 URL 都已脱敏（token、userid、mid、signature 等换成 ***）；
 * 3. 非 2xx 默认保持原有「返回 status/data」行为，传 throwOnHttpError 时抛 HttpError。
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { HttpRequestOptions, HttpResponse } from '../types/music';
import { redactText, redactUrl } from '../utils/redact';

// 酷狗概念版 Android 客户端 User-Agent
export const KUGOU_CONCEPT_UA =
  'Mozilla/5.0 (Linux; Android 12; Pixel 6 Build/SD1A.210817.023; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/94.0.4606.71 Mobile Safari/537.36 KuGouConcept/3.0.0';

// 酷狗网关 API 专用 User-Agent
export const KUGOU_GATEWAY_UA = 'Android9-AndroidPhone-11239-18-0-playlist-wifi';

// 默认请求头配置
const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': KUGOU_CONCEPT_UA,
  Referer: 'https://www.kugou.com/',
  Accept: '*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

/** 重定向状态码（含 303 与 308） */
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/** 带 Tauri 标记的 window，避免散落的 any 断言 */
interface TauriMarkedWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
  __TAURI__?: unknown;
  isTauri?: boolean;
}

/** 失败类别：超时 / 非 2xx / 网络层失败（DNS、连接被拒、被取消等） */
export type HttpErrorKind = 'timeout' | 'status' | 'network';

/** 统一请求错误：message 与 url 均已脱敏，可安全展示到界面 */
export class HttpError extends Error {
  readonly kind: HttpErrorKind;
  readonly status?: number;
  /** 已脱敏的请求地址 */
  readonly url: string;

  constructor(kind: HttpErrorKind, message: string, url: string, status?: number) {
    super(message);
    this.name = 'HttpError';
    this.kind = kind;
    this.url = url;
    this.status = status;
  }
}

/**
 * 判断当前是否处于 Tauri 运行时环境
 */
export function isTauriEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  const marked = window as TauriMarkedWindow;
  return Boolean(marked.__TAURI_INTERNALS__ || marked.__TAURI__ || marked.isTauri);
}

/** 浏览器开发模式下需要走 Vite 代理的酷狗域名 → 代理前缀（与协议无关） */
const BROWSER_PROXIES: Array<[host: string, prefix: string]> = [
  ['login-user.kugou.com', '/proxy-login'],
  ['gateway.kugou.com', '/proxy-gateway'],
  ['gatewayretry.kugou.com', '/proxy-gateway-retry'],
  ['songsearch.kugou.com', '/proxy-search'],
  // CDN 只有 http 可用（https 握手直接失败），仍走代理，由代理侧发起 http 请求
  ['mobilecdn.kugou.com', '/proxy-mobilecdn'],
  ['trackercdn.kugou.com', '/proxy-trackercdn'],
  ['krcs.kugou.com', '/proxy-krcs'],
  ['kugouvip.kugou.com', '/proxy-vip'],
  ['t1.kugou.com', '/proxy-t1'],
  ['t4.kugou.com', '/proxy-t4'],
  ['m.kugou.com', '/proxy-m'],
  ['www.kugou.com', '/proxy-www'],
];

function rewriteUrlForBrowser(url: string): string {
  if (isTauriEnvironment()) return url;
  const origin = /^https?:\/\/[^/?#]+/i.exec(url);
  if (!origin) return url;
  const host = origin[0].replace(/^https?:\/\//i, '').toLowerCase();
  const proxy = BROWSER_PROXIES.find(([name]) => name === host);
  return proxy ? url.replace(origin[0], proxy[1]) : url;
}

/**
 * 序列化 Query 参数到 URL（兼容绝对路径与相对路径）
 */
function buildUrlWithQuery(url: string, query?: Record<string, string | number | boolean>): string {
  const base = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const urlObj = new URL(url, base);
  if (query && Object.keys(query).length > 0) {
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        urlObj.searchParams.set(key, String(value));
      }
    });
  }
  if (url.startsWith('/')) {
    return urlObj.pathname + urlObj.search;
  }
  return urlObj.toString();
}

/** Tauri plugin-http 扩展的初始化参数 */
interface FetchInit extends RequestInit {
  maxRedirections?: number;
}

/**
 * 统一网络请求核心方法
 */
export async function request<T = unknown>(
  url: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponse<T>> {
  const {
    method = 'GET',
    headers = {},
    query,
    body,
    manualRedirect = false,
    timeout = 15000,
    signal,
    throwOnHttpError = false,
  } = options;

  const resolvedUrl = rewriteUrlForBrowser(url);
  const targetUrl = buildUrlWithQuery(resolvedUrl, query);
  // 任何进入 message / 日志的地址都要先脱敏
  const safeUrl = redactUrl(targetUrl);

  // 合并默认请求头与用户自定义头
  const mergedHeaders: Record<string, string> = {
    ...DEFAULT_HEADERS,
    ...headers,
  };

  // 区分选择请求驱动（Tauri plugin-http 或 原生 fetch）
  const fetchDriver = isTauriEnvironment() ? tauriFetch : window.fetch;

  // 构造 AbortController 处理超时
  const controller = new AbortController();

  // 超时守卫：覆盖建连 + 响应头 + body 读取整段
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutGuard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new HttpError('timeout', `[HttpService] 请求超时 (${timeout}ms): ${safeUrl}`, safeUrl)
      );
    }, timeout);
  });
  // 请求先完成时，守卫的 rejection 不应变成未处理异常
  timeoutGuard.catch(() => {});

  // 外部取消信号透传（切歌时取消旧请求用）
  let cancelled = false;
  const onExternalAbort = (): void => {
    cancelled = true;
    controller.abort();
  };
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort);
  }

  const run = async (): Promise<HttpResponse<T>> => {
    const fetchInit: FetchInit = {
      method,
      headers: mergedHeaders,
      signal: controller.signal,
      // 当需要捕获 302 重定向短链时，指定 redirect 为 manual，并在 Tauri plugin-http 中指定 maxRedirections: 0
      redirect: manualRedirect ? 'manual' : 'follow',
      maxRedirections: manualRedirect ? 0 : 10,
    };

    if (body) {
      if (typeof body === 'string') {
        fetchInit.body = body;
      } else if (body instanceof FormData || body instanceof URLSearchParams) {
        fetchInit.body = body;
      } else {
        fetchInit.body = JSON.stringify(body);
        if (!mergedHeaders['Content-Type']) {
          mergedHeaders['Content-Type'] = 'application/json';
        }
      }
    }

    let response: Response;
    try {
      response = await fetchDriver(targetUrl, fetchInit);
    } catch (error: unknown) {
      if (controller.signal.aborted) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new HttpError(
        'network',
        `[HttpService] 请求失败: ${safeUrl}（${redactText(detail)}）`,
        safeUrl
      );
    }

    // 解析响应头字典
    const respHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      respHeaders[key.toLowerCase()] = value;
    });

    let redirectUrl: string | undefined = undefined;
    // 当状态码为重定向且指定了 manualRedirect，提取 Location
    if (REDIRECT_STATUS.has(response.status)) {
      redirectUrl = respHeaders['location'] || response.headers.get('location') || undefined;
    }

    const finalUrl = redirectUrl || response.url || targetUrl;

    // 尝试解析响应内容（支持 JSON 或 Text）；204/重定向/HEAD 无实体
    const contentType = respHeaders['content-type'] || '';
    const isBodyless =
      method === 'HEAD' || response.status === 204 || REDIRECT_STATUS.has(response.status);

    let parsedData: unknown = null;
    if (!isBodyless) {
      if (contentType.includes('application/json')) {
        parsedData = await response.json().catch(() => null);
      } else {
        const text = await response.text().catch(() => '');
        try {
          // 尝试兜底解析成 JSON，若失败则保留纯文本
          parsedData = JSON.parse(text);
        } catch {
          parsedData = text;
        }
      }
    }

    if (throwOnHttpError && !response.ok) {
      throw new HttpError(
        'status',
        `[HttpService] HTTP ${response.status} ${response.statusText}: ${safeUrl}`,
        safeUrl,
        response.status
      );
    }

    return {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
      data: parsedData as T,
      redirectUrl,
      finalUrl,
    };
  };

  try {
    return await Promise.race([run(), timeoutGuard]);
  } catch (error: unknown) {
    if (error instanceof HttpError) throw error;
    if (cancelled) {
      throw new HttpError('network', `[HttpService] 请求已取消: ${safeUrl}`, safeUrl);
    }
    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      throw new HttpError(
        'timeout',
        `[HttpService] 请求超时 (${timeout}ms): ${safeUrl}`,
        safeUrl
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new HttpError(
      'network',
      `[HttpService] 请求失败: ${safeUrl}（${redactText(detail)}）`,
      safeUrl
    );
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

/**
 * 封装 GET 请求快捷方法
 */
export async function httpGet<T = unknown>(
  url: string,
  query?: Record<string, string | number | boolean>,
  options?: Omit<HttpRequestOptions, 'method' | 'query'>
): Promise<T> {
  const resp = await request<T>(url, {
    ...options,
    method: 'GET',
    query,
  });
  return resp.data;
}

/**
 * 封装 POST 请求快捷方法
 */
export async function httpPost<T = unknown>(
  url: string,
  body?: unknown,
  options?: Omit<HttpRequestOptions, 'method' | 'body'>
): Promise<T> {
  const resp = await request<T>(url, {
    ...options,
    method: 'POST',
    body,
  });
  return resp.data;
}
