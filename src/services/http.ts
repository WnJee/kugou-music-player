/**
 * 网络请求层 (src/services/http.ts)
 * 基于 @tauri-apps/plugin-http 封装，彻底绕过 CORS 跨域限制，支持桌面端与移动端
 */

import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { HttpRequestOptions, HttpResponse } from '../types/music';

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

/**
 * 判断当前是否处于 Tauri 运行时环境
 */
export function isTauriEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  return Boolean(
    (window as any).__TAURI_INTERNALS__ ||
    (window as any).__TAURI__ ||
    (window as any).isTauri
  );
}

/**
 * 在浏览器开发模式下重写酷狗请求地址至 Vite 代理，避免跨域报错
 */
function rewriteUrlForBrowser(url: string): string {
  if (isTauriEnvironment()) return url;
  if (url.startsWith('https://login-user.kugou.com')) {
    return url.replace('https://login-user.kugou.com', '/proxy-login');
  }
  if (url.startsWith('https://gateway.kugou.com')) {
    return url.replace('https://gateway.kugou.com', '/proxy-gateway');
  }
  if (url.startsWith('http://gateway.kugou.com')) {
    return url.replace('http://gateway.kugou.com', '/proxy-gateway');
  }
  if (url.startsWith('http://songsearch.kugou.com')) {
    return url.replace('http://songsearch.kugou.com', '/proxy-search');
  }
  if (url.startsWith('https://songsearch.kugou.com')) {
    return url.replace('https://songsearch.kugou.com', '/proxy-search');
  }
  if (url.startsWith('https://trackercdn.kugou.com')) {
    return url.replace('https://trackercdn.kugou.com', '/proxy-trackercdn');
  }
  if (url.startsWith('http://trackercdn.kugou.com')) {
    return url.replace('http://trackercdn.kugou.com', '/proxy-trackercdn');
  }
  if (url.startsWith('http://krcs.kugou.com')) {
    return url.replace('http://krcs.kugou.com', '/proxy-krcs');
  }
  if (url.startsWith('https://krcs.kugou.com')) {
    return url.replace('https://krcs.kugou.com', '/proxy-krcs');
  }
  if (url.startsWith('https://t1.kugou.com')) {
    return url.replace('https://t1.kugou.com', '/proxy-t1');
  }
  if (url.startsWith('https://m.kugou.com')) {
    return url.replace('https://m.kugou.com', '/proxy-m');
  }
  if (url.startsWith('https://www.kugou.com')) {
    return url.replace('https://www.kugou.com', '/proxy-www');
  }
  return url;
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
  } = options;

  const resolvedUrl = rewriteUrlForBrowser(url);
  const targetUrl = buildUrlWithQuery(resolvedUrl, query);

  // 合并默认请求头与用户自定义头
  const mergedHeaders: Record<string, string> = {
    ...DEFAULT_HEADERS,
    ...headers,
  };

  // 区分选择请求驱动（Tauri plugin-http 或 原生 fetch）
  const fetchDriver = isTauriEnvironment() ? tauriFetch : window.fetch;

  // 构造 AbortController 处理超时
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const fetchInit: any = {
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

    const response = await fetchDriver(targetUrl, fetchInit);
    clearTimeout(timer);

    // 解析响应头字典
    const respHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      respHeaders[key.toLowerCase()] = value;
    });

    let redirectUrl: string | undefined = undefined;
    // 当状态码为重定向且指定了 manualRedirect，提取 Location
    if (response.status === 301 || response.status === 302 || response.status === 307) {
      redirectUrl = respHeaders['location'] || response.headers.get('location') || undefined;
    }

    const finalUrl = redirectUrl || (response as any).url || targetUrl;

    // 尝试解析响应内容（支持 JSON 或 Text）
    const contentType = respHeaders['content-type'] || '';
    let parsedData: unknown;

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

    return {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders,
      data: parsedData as T,
      redirectUrl,
      finalUrl,
    };
  } catch (error: unknown) {
    clearTimeout(timer);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`[HttpService] 请求超时 (${timeout}ms): ${targetUrl}`);
    }
    throw error;
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
