/**
 * 把酷狗图片 CDN（imge.kugou.com）返回的明文 http 链接升级为 https。
 * 头像与封面统一走加密通道，避免 webview 的混合内容策略拦截。
 * 音频 CDN 无有效 https 证书，不适用此函数。
 */
export function toSecureImageUrl(url?: string): string {
  if (!url) return '';
  return url.replace(/^http:\/\//, 'https://');
}
