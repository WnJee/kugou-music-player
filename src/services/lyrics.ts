/**
 * 酷狗歌词服务 (src/services/lyrics.ts)
 * 检索并下载酷狗官方 LRC 歌词，解析为带毫秒时间戳的曲目歌词行
 */

import type { KuGouSong, LyricLine } from '../types/music';
import { httpGet } from './http';

/**
 * Base64 字符串解码为 UTF-8 文本
 */
function decodeBase64Utf8(base64Str: string): string {
  try {
    const binary = atob(base64Str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(bytes);
  } catch {
    return atob(base64Str);
  }
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

/**
 * 获取歌曲对应的 LRC 歌词
 */
export async function fetchSongLyrics(song: KuGouSong): Promise<LyricLine[]> {
  try {
    // 1. 检索歌词 Candidate
    const searchUrl = 'http://krcs.kugou.com/search';
    interface LyricSearchResponse {
      status: number;
      candidates?: Array<{
        id: string;
        accesskey: string;
        song: string;
        singer: string;
      }>;
    }

    const searchRes = await httpGet<LyricSearchResponse>(searchUrl, {
      ver: 1,
      man: 'yes',
      client: 'mobi',
      keyword: `${song.songName} ${song.singerName}`,
      duration: song.duration * 1000,
      hash: song.hash.toLowerCase(),
    });

    if (searchRes && searchRes.candidates && searchRes.candidates.length > 0) {
      const firstCandidate = searchRes.candidates[0];

      // 2. 下载 Base64 编码的 LRC 歌词
      const downloadUrl = 'http://krcs.kugou.com/download';
      interface LyricDownloadResponse {
        status: number;
        content?: string;
        fmt?: string;
      }

      const dlRes = await httpGet<LyricDownloadResponse>(downloadUrl, {
        ver: 1,
        client: 'mobi',
        id: firstCandidate.id,
        accesskey: firstCandidate.accesskey,
        fmt: 'lrc',
        charset: 'utf8',
      });

      if (dlRes && dlRes.content) {
        const decodedLrc = decodeBase64Utf8(dlRes.content);
        const parsed = parseLrc(decodedLrc);
        if (parsed.length > 0) {
          return parsed;
        }
      }
    }
  } catch (err) {
    console.warn('[fetchSongLyrics] 获取歌词失败:', err);
  }

  // 兜底提示无歌词
  return [{ time: 0, text: '纯音乐，请欣赏' }];
}
