/**
 * 音频地址校验工具 (src/utils/audioUrl.ts)
 *
 * 第三方备轨返回的地址不可信：必须先确认 scheme 是 http/https，
 * 且要么是音频类扩展名，要么服务端确有可用的音频响应，否则一律不采用，
 * 避免把用户导向未知来源或直接把非音频内容交给播放器。
 */

import { request } from '../services/http';

/** 常见音频容器扩展名 */
const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'm4a',
  'aac',
  'flac',
  'ogg',
  'oga',
  'opus',
  'wav',
  'ape',
  'wma',
  'm4b',
  'mp4',
  'mp2',
]);

/** scheme 是否为 http/https */
export function isHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

/** 路径是否以音频扩展名结尾 */
export function hasAudioExtension(url: string): boolean {
  try {
    const pathname = new URL(url).pathname;
    const ext = pathname.slice(pathname.lastIndexOf('.') + 1).toLowerCase();
    return AUDIO_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

/**
 * 校验第三方音频地址是否可用：scheme 合法 + 音频类扩展或音频响应
 * 纯扩展名不足以判断时用 HEAD 探测 Content-Type（不改动响应体）
 */
export async function verifyPlayableAudioUrl(url: string, timeout = 5000): Promise<boolean> {
  const trimmed = url.trim();
  if (!isHttpUrl(trimmed)) return false;
  if (hasAudioExtension(trimmed)) return true;

  try {
    // 非 2xx 直接报错，便于统一按不可用处理
    const resp = await request(trimmed, { method: 'HEAD', timeout, throwOnHttpError: true });
    const contentType = (resp.headers['content-type'] || '').toLowerCase();
    return contentType.startsWith('audio/') || contentType.startsWith('application/octet-stream');
  } catch {
    return false;
  }
}
