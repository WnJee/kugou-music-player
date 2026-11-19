/**
 * 敏感信息脱敏工具 (src/utils/redact.ts)
 *
 * 酷狗网关把 token、userid、mid、signature 等敏感参数放在 URL query 里，
 * 任何进入日志或界面（error message）的 URL 都必须先经过本模块脱敏，避免凭据泄漏。
 */

/** 需要脱敏的 query 参数名（小写比较） */
const SENSITIVE_QUERY_KEYS = new Set([
  'token',
  'userid',
  'user_id',
  'mid',
  'dfid',
  'key',
  'signature',
  'sign',
  'authorization',
  'cookie',
  'pwd',
  // 歌词接口的访问凭证（krcs 下载链接里带 accesskey）
  'accesskey',
]);

/** 单个 query 参数过滤：敏感名一律替换成 *** */
export function redactParam(key: string, value: string): string {
  return SENSITIVE_QUERY_KEYS.has(key.toLowerCase()) ? '***' : value;
}

/** 判断某个参数名是否敏感（供调用方做额外判断） */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_QUERY_KEYS.has(key.toLowerCase());
}

/** query 里敏感值替换成 `***`，其余保留原样 */
function redactPairs(query: string): string {
  return query
    .split('&')
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf('=');
      if (eq < 0) return pair;
      const key = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      return `${key}=${redactParam(key, value)}`;
    })
    .join('&');
}

/**
 * fragment 里同样可能带凭据（`#access_token=…`），带 `=` 就按 query 脱敏，
 * 纯锚点（`#/playlist`）原样保留
 */
function redactFragment(fragment: string): string {
  const body = fragment.slice(1);
  if (!body) return fragment;
  const q = body.indexOf('?');
  if (q >= 0) return `#${body.slice(0, q + 1)}${redactPairs(body.slice(q + 1))}`;
  if (!body.includes('=')) return fragment;
  return `#${redactPairs(body)}`;
}

/**
 * URL 脱敏：保留 scheme/host/path，query 中的敏感值替换成 `***`
 * 非法的 URL 串按 query 结构做字符串级处理，不会抛错。
 */
export function redactUrl(url: string): string {
  const splitAt = url.indexOf('?');
  if (splitAt < 0) return url;

  // fragment 里的状态参数一并脱敏，否则 #access_token=… 会原样落进日志
  const hashAt = url.indexOf('#', splitAt);
  const fragment = hashAt < 0 ? '' : url.slice(hashAt);
  const base = url.slice(0, splitAt);
  const query = hashAt < 0 ? url.slice(splitAt + 1) : url.slice(splitAt + 1, hashAt);

  return `${base}?${redactPairs(query)}${redactFragment(fragment)}`;
}

/**
 * 文本脱敏：把文本中所有 URL 逐个脱敏（错误信息里可能嵌了多个链接）
 * 协议相对地址（`//host?token=…`）同样有凭据，一并处理
 */
export function redactText(text: string): string {
  return text.replace(/(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s'"<>）)\/][^\s'"<>）)]*/gi, (match) =>
    redactUrl(match)
  );
}
