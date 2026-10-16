/**
 * 酷狗歌单导入与解析服务 (src/services/kugouPlaylist.ts)
 * 支持酷狗短链 (t1/t4)、酷狗码、网页链接、特殊合辑 ID (global_specialid / collection_3_*) 解析与本地持久化
 */

import { Store } from '@tauri-apps/plugin-store';
import type { KuGouPlaylist, KuGouSong } from '../types/music';
import { md5 } from '../utils/md5';
import { httpGet, httpPost, KUGOU_GATEWAY_UA, request } from './http';
import { getDeviceMid } from './device';

// 酷狗移动端网关请求签名秘钥 (从 KuGou Android 逆向获取的验签 Salt)
const KUGOU_API_SALT = 'OIlwieks28dk2k092lksi2UIkp';

// 本地存储文件名
const STORE_FILENAME = 'kugou_playlists.json';
const STORE_KEY = 'playlists';

/**
 * 酷狗网关错误码 → 用户可读提示
 */
const KUGOU_ERROR_HINTS: Record<number, string> = {
  20006: '接口签名校验失败',
  20010: '请求参数不合法',
  20017: '登录态未被酷狗网关接受（Token 失效或与设备标识不匹配），请重新扫码授权',
};

function describeKuGouError(errorCode?: number, status?: number): string {
  if (errorCode && KUGOU_ERROR_HINTS[errorCode]) return KUGOU_ERROR_HINTS[errorCode];
  if (errorCode) return `酷狗网关返回错误码 ${errorCode}`;
  return `酷狗网关响应异常 (status: ${status ?? 'unknown'})`;
}

let tauriStoreInstance: Store | null = null;

/**
 * 获取或初始化本地存储 Store 实例（兼容浏览器 localStorage）
 */
async function getStore(): Promise<Store | null> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    if (!tauriStoreInstance) {
      try {
        tauriStoreInstance = await Store.load(STORE_FILENAME);
      } catch (err) {
        console.warn('[PlaylistStore] 加载 Tauri Store 失败，回退至 localStorage', err);
      }
    }
    return tauriStoreInstance;
  }
  return null;
}

/**
 * 酷狗移动端 MD5 签名算法实现
 */
export function signKuGouGatewayParams(params: Record<string, string | number>): string {
  const sortedPairs = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`);
  const rawString = `${KUGOU_API_SALT}${sortedPairs.join('')}${KUGOU_API_SALT}`;
  return md5(rawString);
}

/**
 * 从纯文本中提取酷狗短链 URL 或纯数字 ID
 */
export function extractKuGouInput(text: string): {
  type: 'shortlink' | 'url' | 'id';
  value: string;
} {
  const trimmed = text.trim();

  // 1. 匹配酷狗短链 (如 https://t1.kugou.com/xxxx 或 https://t4.kugou.com/xxxx)
  const shortlinkMatch = trimmed.match(/https?:\/\/(?:t\d?|m)\.kugou\.com\/[a-zA-Z0-9_-]+/i);
  if (shortlinkMatch) {
    return { type: 'shortlink', value: shortlinkMatch[0] };
  }

  // 2. 匹配酷狗标准网页分享链接 (activity.kugou.com, zlist.html 或 special/single)
  const webLinkMatch = trimmed.match(
    /https?:\/\/(?:www|m|activity)\.kugou\.com\/(?:share\/[^\s]+|yy\/special\/single\/[^\s]+)/i
  );
  if (webLinkMatch) {
    return { type: 'url', value: webLinkMatch[0] };
  }

  // 3. 匹配酷狗码中的纯数字或口令 (如 ￥123456￥ 或纯数字 3280341)
  const codeMatch = trimmed.match(/[￥¥]([a-zA-Z0-9_]+)[￥¥]/);
  if (codeMatch) {
    return { type: 'id', value: codeMatch[1] };
  }

  const numberMatch = trimmed.match(/\b\d{5,12}\b/);
  if (numberMatch) {
    return { type: 'id', value: numberMatch[0] };
  }

  // 兜底返回原始输入
  return { type: 'url', value: trimmed };
}

/**
 * 格式化歌曲封面链接（替换 {size} 占位符为 400）
 */
function formatCoverUrl(url?: string): string {
  if (!url) return '';
  return url.replace(/\{size\}/g, '400').replace(/^http:\/\//, 'https://');
}

/**
 * 常见音频扩展名：酷狗 filename 常带 .mp3/.flac 等后缀，
 * 若不去除会污染歌名，进而影响全网搜索、备轨匹配与歌词查找
 */
const AUDIO_EXT_RE = /\.(mp3|flac|ape|wma|wav|m4a|aac|ogg|opus|alac|lossless)\s*$/i;

function stripAudioExtension(name: string): string {
  return name.replace(AUDIO_EXT_RE, '').trim();
}

/**
 * 统一清洗歌名与歌手名（处理 "歌手 - 歌名" 复合字符串）
 */
function sanitizeSongInfo(
  filename?: string,
  rawSongName?: string,
  rawSingerName?: string
): { songName: string; singerName: string } {
  let songName = stripAudioExtension(rawSongName?.trim() || '');
  let singerName = rawSingerName?.trim() || '';

  if (filename && (!songName || !singerName)) {
    const cleanFilename = stripAudioExtension(filename.trim());
    const parts = cleanFilename.split('-');
    if (parts.length >= 2) {
      if (!singerName) singerName = parts[0].trim();
      if (!songName) songName = stripAudioExtension(parts.slice(1).join('-'));
    } else {
      if (!songName) songName = cleanFilename;
    }
  }

  return {
    songName: songName || '未知歌曲',
    singerName: singerName || '未知歌手',
  };
}

/**
 * 解析酷狗短链，捕获 302 重定向后的真实长链接与关键参数
 */
export async function resolveShortLink(
  shortUrl: string
): Promise<{ finalUrl: string; specialId?: string; globalCollectionId?: string }> {
  try {
    // 优先使用 manualRedirect 禁止自动跳转，以捕获 HTTP 302 Header 中的 Location
    const resp = await request<string>(shortUrl, {
      manualRedirect: true,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });

    let targetUrl = resp.redirectUrl || '';

    // 若未直接获得 Location，尝试从 HTML 文本的 window.location 或 meta refresh 中提取
    if (!targetUrl && typeof resp.data === 'string') {
      const matchRedirect =
        resp.data.match(/window\.location(?:\.href)?\s*=\s*['"]([^'"]+)['"]/i) ||
        resp.data.match(/<meta[^>]*http-equiv=["']refresh["'][^>]*content=["'][^'"]*url=([^'"]+)["']/i) ||
        resp.data.match(/<a[^>]*href=["']([^"']+)["'][^>]*>Found<\/a>/i);
      if (matchRedirect) {
        targetUrl = matchRedirect[1];
      }
    }

    if (!targetUrl) {
      const followResp = await request<string>(shortUrl, { manualRedirect: false });
      targetUrl = shortUrl;
      if (typeof followResp.data === 'string') {
        const scriptMatch =
          followResp.data.match(/global_(?:specialid|collection_id)\s*[:=]\s*['"]([^'"]+)['"]/i) ||
          followResp.data.match(/(collection_\d+_\d+_\d+_\d+)/);
        if (scriptMatch) {
          return { finalUrl: targetUrl, globalCollectionId: scriptMatch[1] };
        }
      }
    }

    // 从最终的目标 URL 中提取参数（兼容 global_specialid 和 global_collection_id）
    const cleanUrl = targetUrl.replace(/&amp;/g, '&');
    const urlObj = new URL(cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`);

    const globalCollectionId =
      urlObj.searchParams.get('global_specialid') ||
      urlObj.searchParams.get('global_collection_id') ||
      undefined;

    const rawSpecialId =
      urlObj.searchParams.get('special_id') ||
      urlObj.searchParams.get('specialid') ||
      urlObj.searchParams.get('id') ||
      undefined;

    // 只有当 specialId 是大于 0 的有效正整数时才采纳（过滤掉 -2147483648 等哨兵负值）
    const specialId = rawSpecialId && Number(rawSpecialId) > 0 ? rawSpecialId : undefined;

    return {
      finalUrl: targetUrl,
      specialId,
      globalCollectionId,
    };
  } catch (error) {
    console.error('[resolveShortLink] 短链解析异常:', error);
    throw new Error(`无法解析酷狗短链，请检查网络或链接是否有效: ${shortUrl}`);
  }
}

/**
 * 从 global_collection_id 网页抓取歌单基础信息与完整内嵌歌曲列表
 */
async function resolveFromGlobalCollectionId(globalCollectionId: string): Promise<{
  specialId?: string;
  playlistName?: string;
  coverUrl?: string;
  intro?: string;
  embeddedSongs: KuGouSong[];
}> {
  const pageUrl = `https://www.kugou.com/yy/special/single/${globalCollectionId}.html`;
  const html = await httpGet<string>(pageUrl);

  if (typeof html !== 'string') {
    return { embeddedSongs: [] };
  }

  // 1. 提取有效正整数 specialId（仅接受明确的 specialid 字段，
  //    避免误匹配页面中 author_id / album_id 等无关数字）
  let specialId: string | undefined;
  const idMatch = html.match(/["']?special_?id["']?\s*:\s*["']?(\d+)["']?/i);
  if (idMatch && Number(idMatch[1]) > 0) {
    specialId = idMatch[1];
  }

  // 2. 提取歌单名称
  let playlistName: string | undefined;
  const nameMatch =
    html.match(/specialName\s*:\s*["']([^"']+)["']/) ||
    html.match(/["']name["']\s*:\s*["']([^"']+)["']/) ||
    html.match(/<h[12][^>]*class=["'][^"']*special_name[^"']*["'][^>]*>(.*?)<\/h[12]>/i) ||
    html.match(/<title>(.*?) - 酷狗音乐<\/title>/i);
  if (nameMatch) {
    playlistName = nameMatch[1].trim();
  }

  // 3. 提取歌单封面
  let coverUrl: string | undefined;
  const coverMatch =
    html.match(/specialImg\s*:\s*["']([^"']+)["']/) ||
    html.match(/["']image["']\s*:\s*["']([^"']+)["']/) ||
    html.match(/<img[^>]*class=["'][^"']*(?:pic|cover)[^"']*["'][^>]*src=["']([^"']+)["']/i);
  if (coverMatch) {
    coverUrl = formatCoverUrl(coverMatch[1]);
  }

  // 4. 解析 HTML 中内嵌的所有曲目: <a title="歌手 - 歌名" href="..." data="HASH|DURATION_MS">
  const embeddedSongs: KuGouSong[] = [];
  const songRegex = /<a[^>]*title="([^"]+)"[^>]*data="([A-Fa-f0-9]{32})\|(\d+)"/g;
  let match: RegExpExecArray | null;

  while ((match = songRegex.exec(html)) !== null) {
    const rawTitle = match[1];
    const hash = match[2].toLowerCase();
    const durationMs = parseInt(match[3], 10);
    const duration = Math.round(durationMs / 1000);

    const { songName, singerName } = sanitizeSongInfo(rawTitle);

    embeddedSongs.push({
      hash,
      songName,
      singerName,
      albumId: '',
      duration: duration || 0,
      coverUrl: coverUrl || '',
    });
  }

  return { specialId, playlistName, coverUrl, embeddedSongs };
}

/**
 * 调用酷狗移动端接口获取完整曲目列表（双接口高可用兜底）
 */
export async function fetchPlaylistTracks(specialId: string): Promise<{
  name: string;
  coverUrl: string;
  intro: string;
  songs: KuGouSong[];
}> {
  // 方式一：尝试使用酷狗移动端 CDN 标准接口
  try {
    const cdnUrl = 'http://mobilecdn.kugou.com/api/v3/special/song';
    interface CdnResponse {
      status: number;
      data?: {
        info: Array<{
          hash: string;
          filename: string;
          songname?: string;
          singername?: string;
          album_id?: string;
          duration: number;
          album_s_img?: string;
          sqhash?: string;
        }>;
      };
    }

    const cdnRes = await httpGet<CdnResponse>(cdnUrl, {
      specialid: specialId,
      page: 1,
      pagesize: -1,
      plat: 0,
      version: 9108,
      with_res_tag: 1,
    });

    if (cdnRes && cdnRes.status === 1 && cdnRes.data?.info && cdnRes.data.info.length > 0) {
      const songs: KuGouSong[] = cdnRes.data.info.map((item) => {
        const { songName, singerName } = sanitizeSongInfo(
          item.filename,
          item.songname,
          item.singername
        );
        return {
          hash: (item.hash || '').toLowerCase(),
          songName,
          singerName,
          albumId: String(item.album_id || ''),
          duration: item.duration > 1000 ? Math.round(item.duration / 1000) : item.duration,
          coverUrl: formatCoverUrl(item.album_s_img),
          sqHash: item.sqhash ? item.sqhash.toLowerCase() : undefined,
        };
      });

      return {
        name: `酷狗歌单 #${specialId}`,
        coverUrl: songs[0]?.coverUrl || '',
        intro: '',
        songs,
      };
    }
  } catch (err) {
    console.warn('[fetchPlaylistTracks] MobileCDN 接口拉取失败，尝试官方网关接口:', err);
  }

  // 方式二：使用移动端网关接口 + MD5 验签
  const timestamp = Math.floor(Date.now() / 1000);
  const queryParams: Record<string, string | number> = {
    appid: 1005,
    area_code: 1,
    clientver: 11239,
    module: 'CloudMusic',
    need_sort: 1,
    page: 1,
    pagesize: 300,
    specalidpgc: specialId,
    specialid: specialId,
    type: 0,
    userid: 0,
  };

  const signature = signKuGouGatewayParams(queryParams);

  interface GatewayResponse {
    status: number;
    data?: {
      specialname?: string;
      intro?: string;
      img?: string;
      info?: Array<{
        hash: string;
        filename: string;
        name?: string;
        singername?: string;
        album_id?: string;
        time_length?: number;
        img?: string;
        sqhash?: string;
      }>;
    };
  }

  const gatewayUrl = 'http://gatewayretry.kugou.com/v2/get_other_list_file';
  const gatewayRes = await httpGet<GatewayResponse>(
    gatewayUrl,
    { ...queryParams, signature },
    {
      headers: {
        'User-Agent': KUGOU_GATEWAY_UA,
        Host: 'gatewayretry.kugou.com',
        'x-router': 'pubsongscdn.kugou.com',
        mid: '239526275778893399526700786998289824956',
        dfid: '-',
        clienttime: String(timestamp),
      },
    }
  );

  if (gatewayRes && gatewayRes.status === 1 && gatewayRes.data?.info) {
    const songs: KuGouSong[] = gatewayRes.data.info.map((item) => {
      const { songName, singerName } = sanitizeSongInfo(
        item.filename,
        item.name,
        item.singername
      );
      const duration = item.time_length
        ? item.time_length > 1000
          ? Math.round(item.time_length / 1000)
          : item.time_length
        : 0;

      return {
        hash: (item.hash || '').toLowerCase(),
        songName,
        singerName,
        albumId: String(item.album_id || ''),
        duration,
        coverUrl: formatCoverUrl(item.img),
        sqHash: item.sqhash ? item.sqhash.toLowerCase() : undefined,
      };
    });

    return {
      name: gatewayRes.data.specialname || `酷狗歌单 #${specialId}`,
      coverUrl: formatCoverUrl(gatewayRes.data.img) || songs[0]?.coverUrl || '',
      intro: gatewayRes.data.intro || '',
      songs,
    };
  }

  throw new Error(`获取歌单曲目失败 (specialId: ${specialId})，接口未返回有效数据`);
}

/**
 * 对外统一导入歌单入口
 */
export async function importKuGouPlaylist(rawInput: string): Promise<KuGouPlaylist> {
  const extracted = extractKuGouInput(rawInput);
  let resolvedSpecialId: string | undefined = undefined;
  let resolvedGlobalCollectionId: string | undefined = undefined;
  let resolvedName: string | undefined = undefined;
  let resolvedCover: string | undefined = undefined;
  let parsedSongs: KuGouSong[] = [];

  if (extracted.type === 'shortlink') {
    const res = await resolveShortLink(extracted.value);
    resolvedSpecialId = res.specialId;
    resolvedGlobalCollectionId = res.globalCollectionId;
  } else if (extracted.type === 'url') {
    const cleanUrl = extracted.value.replace(/&amp;/g, '&');
    const urlObj = new URL(cleanUrl.startsWith('http') ? cleanUrl : `https://${cleanUrl}`);

    resolvedGlobalCollectionId =
      urlObj.searchParams.get('global_specialid') ||
      urlObj.searchParams.get('global_collection_id') ||
      undefined;

    const rawId =
      urlObj.searchParams.get('special_id') ||
      urlObj.searchParams.get('specialid') ||
      urlObj.searchParams.get('id') ||
      undefined;

    if (rawId && Number(rawId) > 0) {
      resolvedSpecialId = rawId;
    }

    const pathMatch = urlObj.pathname.match(/\/yy\/special\/single\/([a-zA-Z0-9_-]+)/);
    if (pathMatch) {
      if (pathMatch[1].startsWith('collection_')) {
        resolvedGlobalCollectionId = pathMatch[1];
      } else if (/^\d+$/.test(pathMatch[1]) && Number(pathMatch[1]) > 0) {
        resolvedSpecialId = pathMatch[1];
      }
    }
  } else {
    if (extracted.value.startsWith('collection_')) {
      resolvedGlobalCollectionId = extracted.value;
    } else if (Number(extracted.value) > 0) {
      resolvedSpecialId = extracted.value;
    }
  }

  // 若存在 global_collection_id，从网页直接拉取歌曲与歌单信息
  if (resolvedGlobalCollectionId) {
    const collectionInfo = await resolveFromGlobalCollectionId(resolvedGlobalCollectionId);
    if (!resolvedSpecialId && collectionInfo.specialId) {
      resolvedSpecialId = collectionInfo.specialId;
    }
    if (collectionInfo.playlistName) resolvedName = collectionInfo.playlistName;
    if (collectionInfo.coverUrl) resolvedCover = collectionInfo.coverUrl;
    if (collectionInfo.embeddedSongs && collectionInfo.embeddedSongs.length > 0) {
      parsedSongs = collectionInfo.embeddedSongs;
    }
  }

  // 如果没有从网页内嵌拿到歌曲，但拿到了数字 specialId，调用移动端 API 拉取
  if (parsedSongs.length === 0 && resolvedSpecialId) {
    const trackResult = await fetchPlaylistTracks(resolvedSpecialId);
    if (!resolvedName) resolvedName = trackResult.name;
    if (!resolvedCover) resolvedCover = trackResult.coverUrl;
    parsedSongs = trackResult.songs;
  }

  if (parsedSongs.length === 0) {
    throw new Error(`解析失败：未能从该分享链接中解析到曲目列表。输入内容: ${rawInput}`);
  }

  const playlist: KuGouPlaylist = {
    id: resolvedGlobalCollectionId || resolvedSpecialId || String(Date.now()),
    name: resolvedName || '我的酷狗歌单',
    coverUrl: resolvedCover || parsedSongs[0]?.coverUrl || '',
    intro: '',
    totalSongs: parsedSongs.length,
    songs: parsedSongs,
    importedAt: Date.now(),
    sourceType: extracted.type === 'id' ? 'kugou_code' : extracted.type,
    rawInput,
  };

  // 保存到本地持久化存储
  await savePlaylistToStorage(playlist);
  return playlist;
}

/**
 * 将歌单保存至本地存储 (Tauri Store 或 localStorage)
 */
export async function savePlaylistToStorage(playlist: KuGouPlaylist): Promise<void> {
  const store = await getStore();
  const playlists = await getLocalPlaylists();

  const existingIdx = playlists.findIndex((p) => p.id === playlist.id);
  if (existingIdx >= 0) {
    playlists[existingIdx] = playlist;
  } else {
    playlists.unshift(playlist);
  }

  if (store) {
    await store.set(STORE_KEY, playlists);
    await store.save();
  } else if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORE_KEY, JSON.stringify(playlists));
  }
}

/**
 * 获取本地已导入的所有歌单列表
 */
export async function getLocalPlaylists(): Promise<KuGouPlaylist[]> {
  const store = await getStore();
  let result: KuGouPlaylist[] = [];

  if (store) {
    result = (await store.get<KuGouPlaylist[]>(STORE_KEY)) || [];
  } else if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      try {
        result = JSON.parse(raw);
      } catch {
        result = [];
      }
    }
  }

  // 兼容历史缓存：早期版本歌名带 .mp3 等后缀，读取时统一清洗
  return result.map((p) => ({
    ...p,
    songs: (p.songs || []).map((s) => ({ ...s, songName: stripAudioExtension(s.songName || '') })),
  }));
}

/**
 * 根据 ID 删除本地歌单
 */
export async function deleteLocalPlaylist(id: string): Promise<void> {
  const store = await getStore();
  const playlists = await getLocalPlaylists();
  const filtered = playlists.filter((p) => p.id !== id);

  if (store) {
    await store.set(STORE_KEY, filtered);
    await store.save();
  } else if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORE_KEY, JSON.stringify(filtered));
  }
}

/**
 * 覆盖保存所有本地歌单
 */
export async function saveAllPlaylistsToStorage(playlists: KuGouPlaylist[]): Promise<void> {
  const store = await getStore();
  if (store) {
    await store.set(STORE_KEY, playlists);
    await store.save();
  } else if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORE_KEY, JSON.stringify(playlists));
  }
}

/**
 * 酷狗 Android 网关带 Body 的 MD5 签名算法
 */
function signKuGouAndroidBody(
  params: Record<string, string | number>,
  bodyObj: unknown
): string {
  const sortedPairs = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`);
  const paramsStr = sortedPairs.join('');
  const bodyStr = bodyObj ? (typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj)) : '';
  return md5(`${KUGOU_API_SALT}${paramsStr}${bodyStr}${KUGOU_API_SALT}`);
}

const DEFAULT_GATEWAY_HEADERS = {
  'User-Agent': 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi',
  'Content-Type': 'application/json',
  'kg-rc': '1',
  'kg-thash': '5d816a0',
  'kg-rec': '1',
  'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
  dfid: '-',
  uuid: '-',
};

/**
 * 全局搜索歌曲或歌手
 */
export async function searchKuGouSongs(
  keyword: string,
  page = 1,
  pageSize = 30
): Promise<KuGouSong[]> {
  const cleanKeyword = keyword.trim();
  if (!cleanKeyword) return [];

  const searchUrl = 'http://songsearch.kugou.com/song_search_v2';
  interface SearchResponse {
    status: number;
    data?: {
      lists?: Array<{
        FileHash?: string;
        HQFileHash?: string;
        SQFileHash?: string;
        SongName?: string;
        FileName?: string;
        SingerName?: string;
        AlbumID?: string | number;
        Duration?: number;
        Image?: string;
        MixSongID?: string | number;
        ID?: string | number;
      }>;
    };
  }

  try {
    const res = await httpGet<SearchResponse>(searchUrl, {
      keyword: cleanKeyword,
      page,
      pagesize: pageSize,
      platform: 'WebFilter',
    });

    if (res && res.status === 1 && res.data?.lists) {
      return res.data.lists
        .map((item) => {
          const { songName, singerName } = sanitizeSongInfo(
            item.FileName,
            item.SongName,
            item.SingerName
          );
          return {
            hash: (item.FileHash || item.HQFileHash || item.SQFileHash || '').toLowerCase(),
            songName,
            singerName,
            albumId: String(item.AlbumID || ''),
            duration: Number(item.Duration || 0),
            coverUrl: (item.Image || '')
              .replace('{size}', '400')
              .replace(/^http:\/\//, 'https://'),
            sqHash: item.SQFileHash ? item.SQFileHash.toLowerCase() : undefined,
            mixSongId: String(item.MixSongID || item.ID || ''),
          };
        })
        .filter((s) => Boolean(s.hash));
    }
  } catch (err) {
    console.warn('[searchKuGouSongs] 搜索曲目异常:', err);
  }

  return [];
}

/**
 * 拉取已授权用户的酷狗账号云端歌单列表
 */
export async function fetchUserCloudPlaylists(
  token: string,
  userid: string
): Promise<KuGouPlaylist[]> {
  if (!token || !userid) return [];

  const timestamp = Math.floor(Date.now() / 1000);
  const mid = await getDeviceMid();

  const params: Record<string, string | number> = {
    appid: 1005,
    clienttime: timestamp,
    clientver: 20489,
    dfid: '-',
    mid,
    plat: 1,
    token,
    userid: Number(userid),
    uuid: '-',
  };

  const body = {
    userid: Number(userid),
    token,
    total_ver: 979,
    type: 2,
    page: 1,
    pagesize: 50,
  };

  const signature = signKuGouAndroidBody(params, body);
  params.signature = signature;

  const url = 'https://gateway.kugou.com/cloudlist.service/v7/get_all_list';
  interface GetAllListResponse {
    status: number;
    error_code?: number;
    data?: {
      info?: Array<{
        listid?: number | string;
        list_id?: number | string;
        name?: string;
        listname?: string;
        title?: string;
        pic?: string;
        picpath?: string;
        cover?: string;
        count?: number;
        songcount?: number;
        total?: number;
        type?: number;
        gid?: string;
        global_collection_id?: string;
      }>;
      list?: Array<any>;
      lists?: Array<any>;
    };
  }

  const res = await httpPost<GetAllListResponse>(url, body, {
    query: params,
    headers: {
      ...DEFAULT_GATEWAY_HEADERS,
      clienttime: String(timestamp),
      mid,
      token,
      userid,
    },
  });

  // 网关返回 status !== 1 时抛出真实错误，避免 UI 误显示为「暂无云端歌单」
  if (!res || res.status !== 1) {
    throw new Error(describeKuGouError(res?.error_code, res?.status));
  }

  const rawList = res?.data?.info || res?.data?.list || res?.data?.lists || [];
  const result: KuGouPlaylist[] = [];

  for (const item of rawList) {
    const listId = String(item.listid || item.list_id || item.id || '');
    if (!listId) continue;
    const name = item.name || item.listname || item.title || `云端歌单 #${listId}`;
    const coverUrl = formatCoverUrl(item.pic || item.picpath || item.cover);
    const totalSongs = Number(item.count || item.songcount || item.total || 0);
    const globalCollectionId =
      item.global_collection_id || (item.gid ? `collection_3_${userid}_${listId}_0` : '');

    result.push({
      id: `cloud_${listId}`,
      listId,
      name,
      coverUrl,
      intro: '酷狗账号云端歌单',
      totalSongs,
      songs: [],
      importedAt: Date.now(),
      sourceType: 'user_cloud',
      rawInput: globalCollectionId || `listid:${listId}`,
      isUserOwned: true,
    });
  }

  return result;
}

/**
 * 拉取用户云端歌单内包含的完整曲目
 */
export async function fetchUserCloudPlaylistTracks(
  listId: string,
  token: string,
  userid: string
): Promise<KuGouSong[]> {
  const mid = await getDeviceMid();
  const PAGE_SIZE = 300;
  // 防风控安全上限：最多 10 页（约 3000 首），远大于常规歌单规模
  const MAX_PAGES = 10;
  const PAGE_INTERVAL_MS = 400;

  const url = 'https://gateway.kugou.com/cloudlist.service/v4/get_list_all_file_v3';

  interface TrackItem {
    hash?: string;
    FileHash?: string;
    name?: string;
    filename?: string;
    songname?: string;
    singername?: string;
    singer?: string;
    album_id?: string | number;
    albumid?: string | number;
    timelen?: number;
    duration?: number;
    album_s_img?: string;
    pic?: string;
    sqhash?: string;
    mixsongid?: string | number;
    audioid?: string | number;
  }

  interface TrackListResponse {
    status: number;
    error_code?: number;
    data?: {
      info?: TrackItem[];
      songs?: TrackItem[];
    };
  }

  const mapSongs = (rawList: TrackItem[]): KuGouSong[] =>
    rawList
      .map((item) => {
        const { songName, singerName } = sanitizeSongInfo(
          item.filename || item.name,
          item.songname,
          item.singername || item.singer
        );
        const rawDuration = Number(item.timelen || item.duration || 0);
        const duration = rawDuration > 1000 ? Math.round(rawDuration / 1000) : rawDuration;

        return {
          hash: (item.hash || item.FileHash || '').toLowerCase(),
          songName,
          singerName,
          albumId: String(item.album_id || item.albumid || ''),
          duration,
          coverUrl: formatCoverUrl(item.album_s_img || item.pic),
          sqHash: item.sqhash ? item.sqhash.toLowerCase() : undefined,
          mixSongId: String(item.mixsongid || item.audioid || ''),
        };
      })
      .filter((s) => Boolean(s.hash));

  // 单页请求：clienttime 与签名必须按页重新计算
  const fetchPage = async (page: number): Promise<TrackListResponse | null> => {
    const timestamp = Math.floor(Date.now() / 1000);
    const params: Record<string, string | number> = {
      appid: 1005,
      clienttime: timestamp,
      clientver: 20489,
      dfid: '-',
      mid,
      plat: 1,
      token,
      userid: Number(userid),
      uuid: '-',
    };

    const body = {
      listid: Number(listId),
      userid: Number(userid),
      type: 0,
      page,
      pagesize: PAGE_SIZE,
      area_code: 1,
      allplatform: 1,
      show_cover: 1,
      token,
    };

    const signature = signKuGouAndroidBody(params, body);
    params.signature = signature;

    return httpPost<TrackListResponse>(url, body, {
      query: params,
      headers: {
        ...DEFAULT_GATEWAY_HEADERS,
        clienttime: String(timestamp),
        mid,
        token,
        userid,
      },
    });
  };

  const all: KuGouSong[] = [];


  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      // 单页失败自动重试（最多 3 次），避免翻页偶发失败导致整表被静默截断
      let res: TrackListResponse | null = null;
      let pageOk = false;
      for (let attempt = 0; attempt < 3 && !pageOk; attempt++) {
        try {
          res = await fetchPage(page);
          if (res && res.status === 1) {
            pageOk = true;
          } else {
            console.warn(
              `[fetchUserCloudPlaylistTracks] 第 ${page} 页响应异常 (status: ${res?.status}, error_code: ${res?.error_code})，重试 ${attempt + 1}/3`
            );
          }
        } catch (pageErr) {
          console.warn(`[fetchUserCloudPlaylistTracks] 第 ${page} 页请求异常，重试 ${attempt + 1}/3:`, pageErr);
        }
        if (!pageOk && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
      }

      const rawSongs = res?.data?.info || res?.data?.songs || [];
      const mapped = mapSongs(rawSongs);
      all.push(...mapped);

      // 返回数量不足一页，说明已到末页
      if (mapped.length < PAGE_SIZE) break;

      // 页间留间隔，降低请求频率避免触发风控
      if (page < MAX_PAGES) {
        await new Promise((resolve) => setTimeout(resolve, PAGE_INTERVAL_MS));
      }
    }
  } catch (err) {
    console.warn(`[fetchUserCloudPlaylistTracks] 获取歌单曲目失败 (listId: ${listId}):`, err);
  }

  return all;
}

/**
 * 将指定曲目添加到酷狗云端歌单并同步酷狗账号
 */
export async function addSongToUserCloudPlaylist(
  song: KuGouSong,
  listId: string,
  token: string,
  userid: string
): Promise<{ success: boolean; message: string }> {
  if (!token || !userid || !listId) {
    return { success: false, message: '缺少登录态或歌单 ID' };
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const mid = await getDeviceMid();

  const params: Record<string, string | number> = {
    appid: 1005,
    clienttime: timestamp,
    clientver: 20489,
    dfid: '-',
    last_area: 'gztx',
    last_time: timestamp,
    mid,
    plat: 1,
    token,
    userid: Number(userid),
    uuid: '-',
  };

  const body = {
    userid: Number(userid),
    token,
    listid: Number(listId),
    list_ver: 0,
    type: 0,
    slow_upload: 1,
    scene: 'false;null',
    data: [
      {
        number: 1,
        name: `${song.singerName} - ${song.songName}`,
        hash: song.hash.toUpperCase(),
        size: 0,
        sort: 0,
        timelen: (song.duration || 0) * 1000,
        bitrate: 0,
        album_id: Number(song.albumId || 0),
        mixsongid: Number(song.mixSongId || 0),
      },
    ],
  };

  const signature = signKuGouAndroidBody(params, body);
  params.signature = signature;

  const url = 'https://gateway.kugou.com/cloudlist.service/v6/add_song';
  try {
    const res = await httpPost<{ status: number; error_code?: number; error?: string }>(
      url,
      body,
      {
        query: params,
        headers: {
          ...DEFAULT_GATEWAY_HEADERS,
          clienttime: String(timestamp),
          mid,
          token,
          userid,
        },
      }
    );

    if (res && (res.status === 1 || res.error_code === 0)) {
      return { success: true, message: '已成功添加并同步至酷狗账号！' };
    }
    return {
      success: false,
      message: res?.error || `酷狗云端响应异常 (code: ${res?.error_code || res?.status})`,
    };
  } catch (err: unknown) {
    return {
      success: false,
      message: err instanceof Error ? err.message : '网络同步请求失败',
    };
  }
}

