/**
 * 酷狗歌词服务 (src/services/lyrics.ts)
 * 检索并下载酷狗官方 LRC 歌词，解析为带毫秒时间戳的曲目歌词行
 *
 * 需要区分三种结果：拿到歌词 / 确认是纯音乐（接口返回空） / 请求失败。
 * 旧实现把「请求失败」也显示成「纯音乐，请欣赏」，会误导用户。
 */

import type { KuGouSong, LyricLine } from '../types/music';
import { httpGet } from './http';

/** 歌词获取结果类别 */
export type LyricsStatus = 'ok' | 'instrumental' | 'error';

export interface LyricsResult {
  lyrics: LyricLine[];
  status: LyricsStatus;
  /** 失败时的原始原因（已脱敏，可展示） */
  message?: string;
}

/** 无歌词时展示的提示行 */
const INSTRUMENTAL_LINE: LyricLine = { time: 0, text: '纯音乐，请欣赏' };
const ERROR_LINE: LyricLine = { time: 0, text: '歌词加载失败，请稍后重试' };

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Base64 解码为字节数组（纯实现，不依赖 atob，任何运行时都可用）
 */
function decodeBase64Bytes(base64Str: string): Uint8Array {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const char of base64Str) {
    if (char === '=') break;
    const value = BASE64_CHARS.indexOf(char);
    if (value < 0) continue; // 跳过换行、空白等非 base64 字符
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
}

/**
 * Base64 字符串解码为 UTF-8 文本
 */
function decodeBase64Utf8(base64Str: string): string {
  return new TextDecoder('utf-8').decode(decodeBase64Bytes(base64Str));
}

/**
 * 解析标准 LRC 歌词文本为时间行数组
 * 格式支持: [mm:ss.xx]文本 或 [mm:ss]文本
 */
export function parseLrc(lrcText: string): LyricLine[] {
  const lines = lrcText.split('\n');
  const result: LyricLine[] = [];
  const timeRegex = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\]/g;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    timeRegex.lastIndex = 0;
    const matches: number[] = [];
    let match: RegExpExecArray | null;

    while ((match = timeRegex.exec(line)) !== null) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const milliseconds = match[3]
        ? parseInt(match[3].padEnd(3, '0').slice(0, 3), 10)
        : 0;
      const totalSeconds = minutes * 60 + seconds + milliseconds / 1000;
      matches.push(totalSeconds);
    }

    if (matches.length > 0) {
      const text = line.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, '').trim();
      // 过滤掉元信息标签（如 [ar:], [ti:] 等）
      if (!text.startsWith('[') || !text.endsWith(']')) {
        for (const time of matches) {
          result.push({ time, text });
        }
      }
    }
  }

  // 按时间升序排序
  return result.sort((a, b) => a.time - b.time);
}

interface LyricCandidate {
  id: string;
  accesskey: string;
  song?: string;
  singer?: string;
  /** 候选歌词对应时长（毫秒），接口提供时用于挑选最贴近原曲的版本 */
  duration?: number;
}

/** 在候选里挑时长最接近原曲的一条；无时长信息时按接口返回顺序取第一条 */
function pickCandidate(candidates: LyricCandidate[], songDuration: number): LyricCandidate {
  if (songDuration <= 0) return candidates[0];

  let best = candidates[0];
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const seconds = (candidate.duration || 0) / 1000;
    if (seconds <= 0) continue;
    const diff = Math.abs(seconds - songDuration);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = candidate;
    }
  }
  return best;
}

/**
 * 获取歌曲歌词，并区分「纯音乐」「请求失败」两种无歌词情形
 */
export async function fetchSongLyricsResult(song: KuGouSong): Promise<LyricsResult> {
  try {
    // 1. 检索歌词 Candidate（https 已验证可用）
    const searchUrl = 'https://krcs.kugou.com/search';
    interface LyricSearchResponse {
      status: number;
      candidates?: LyricCandidate[];
    }

    const searchRes = await httpGet<LyricSearchResponse>(searchUrl, {
      ver: 1,
      man: 'yes',
      client: 'mobi',
      keyword: `${song.songName} ${song.singerName}`,
      duration: song.duration * 1000,
      hash: song.hash.toLowerCase(),
    });

    const candidates = searchRes?.candidates;
    if (!candidates || candidates.length === 0) {
      // 接口正常应答但没有候选：确认无歌词（多为纯音乐）
      return { lyrics: [INSTRUMENTAL_LINE], status: 'instrumental' };
    }

    // 2. 下载 Base64 编码的 LRC 歌词
    const candidate = pickCandidate(candidates, song.duration);
    const downloadUrl = 'https://krcs.kugou.com/download';
    interface LyricDownloadResponse {
      status: number;
      content?: string;
      fmt?: string;
    }

    const dlRes = await httpGet<LyricDownloadResponse>(downloadUrl, {
      ver: 1,
      client: 'mobi',
      id: candidate.id,
      accesskey: candidate.accesskey,
      fmt: 'lrc',
      charset: 'utf8',
    });

    if (dlRes?.content) {
      const parsed = parseLrc(decodeBase64Utf8(dlRes.content));
      if (parsed.length > 0) {
        return { lyrics: parsed, status: 'ok' };
      }
    }

    return { lyrics: [INSTRUMENTAL_LINE], status: 'instrumental' };
  } catch (err) {
    const message = err instanceof Error ? err.message : '歌词接口请求失败';
    console.warn('[fetchSongLyrics] 获取歌词失败:', message);
    return { lyrics: [ERROR_LINE], status: 'error', message };
  }
}

/**
 * 获取歌曲对应的 LRC 歌词（兼容入口：失败时给出可区分的提示文案）
 */
export async function fetchSongLyrics(song: KuGouSong): Promise<LyricLine[]> {
  const result = await fetchSongLyricsResult(song);
  return result.lyrics;
}
