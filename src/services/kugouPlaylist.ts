/**
 * 酷狗歌单导入与解析服务 (src/services/kugouPlaylist.ts)
 * 支持酷狗短链 (t1/t4)、酷狗码、网页链接、特殊合辑 ID (global_specialid / collection_3_*) 解析与本地持久化
 */

import { Store } from '@tauri-apps/plugin-store';
import type { KuGouPlaylist, KuGouSong } from '../types/music';
import { toSecureImageUrl } from '../utils/url';
import { httpGet, httpPost, KUGOU_GATEWAY_UA, request } from './http';
import { getDeviceMid } from './device';
import {
  gatewayClientverFor,
  otherPlatform,
  PLATFORM_STANDARD,
  platformOfAppId,
  signWithSalt,
  type GatewayParams,
  type GatewayPlatform,
} from './kugouConst';

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
 * 酷狗网关 MD5 签名：统一的 signWithSalt 实现，salt 必须与 appid 同平台配对
 */
function signGatewayParams(
  params: GatewayParams,
  options: { body?: unknown; salt?: string } = {}
): string {
  return signWithSalt(options.salt ?? PLATFORM_STANDARD.signatureSalt, params, options.body);
}

/**
 * 安全解析 URL：解析失败返回 null，不向调用方抛原生 TypeError
 */
function safeParseUrl(rawUrl: string): URL | null {
  const clean = rawUrl.replace(/&amp;/g, '&').trim();
  if (!clean) return null;
  try {
    return new URL(/^https?:\/\//i.test(clean) ? clean : `https://${clean}`);
  } catch {
    return null;
  }
}

/**
 * 从酷狗分享链接中提取歌单标识（special_id / global_collection_id）
 */
function parseKuGouShareUrl(rawUrl: string): {
  specialId?: string;
  globalCollectionId?: string;
} {
  const urlObj = safeParseUrl(rawUrl);
  if (!urlObj) return {};

  const globalCollectionId =
    urlObj.searchParams.get('global_specialid') ||
    urlObj.searchParams.get('global_collection_id') ||
    undefined;

  const rawSpecialId =
    urlObj.searchParams.get('special_id') ||
    urlObj.searchParams.get('specialid') ||
    urlObj.searchParams.get('id');

  // 只有当 specialId 是大于 0 的有效正整数时才采纳（过滤掉 -2147483648 等哨兵负值）
  const specialId = rawSpecialId && Number(rawSpecialId) > 0 ? rawSpecialId : undefined;

  // 路径形态：/yy/special/single/<collection_x_y_z_w | 纯数字>
  const pathSegment = urlObj.pathname.match(/\/yy\/special\/single\/([a-zA-Z0-9_-]+)/)?.[1];
  const pathCollectionId = pathSegment?.startsWith('collection_') ? pathSegment : undefined;
  const pathSpecialId =
    !pathCollectionId && pathSegment && /^\d+$/.test(pathSegment) && Number(pathSegment) > 0
      ? pathSegment
      : undefined;

  return {
    specialId: specialId || pathSpecialId,
    globalCollectionId: globalCollectionId || pathCollectionId,
  };
}

export type KuGouInputType = 'shortlink' | 'url' | 'id';

export interface KuGouInputInfo {
  /** 输入形态；invalid 表示既不是酷狗歌单链接也不是歌单 ID */
  type: KuGouInputType | 'invalid';
  /** 归一化后的值（invalid 时为原始输入，便于提示） */
  value: string;
  /** invalid 时面向用户的原因说明 */
  reason?: string;
}

/** 酷狗短链 (https://t1.kugou.com/xxxx / t4 / m) */
const KUGOU_SHORTLINK_RE = /https?:\/\/(?:t\d?|m)\.kugou\.com\/[a-zA-Z0-9_-]+/i;
/** 酷狗标准网页分享链接 */
const KUGOU_WEBLINK_RE =
  /https?:\/\/(?:www|m|activity)\.kugou\.com\/(?:share\/[^\s]+|yy\/special\/single\/[^\s]+)/i;
/** 无协议头的酷狗链接 */
const KUGOU_BARE_LINK_RE = /(?:www|m|activity)\.kugou\.com\/\S+/i;

/**
 * 从纯文本中识别酷狗短链 / 网页链接 / 歌单码或 ID。
 * 无法识别时返回 invalid 与用户可读原因，绝不把任意文本当 URL 解析。
 */
export function extractKuGouInput(text: string): KuGouInputInfo {
  const trimmed = (text || '').trim();
  if (!trimmed) {
    return { type: 'invalid', value: '', reason: '请输入酷狗歌单链接、短链或歌单 ID' };
  }

  // 1. 酷狗短链 (如 https://t1.kugou.com/xxxx 或 https://t4.kugou.com/xxxx)
  const shortlinkMatch = trimmed.match(KUGOU_SHORTLINK_RE);
  if (shortlinkMatch) {
    return { type: 'shortlink', value: shortlinkMatch[0] };
  }

  // 2. 酷狗标准网页分享链接 (share / yy/special/single)
  const webLinkMatch = trimmed.match(KUGOU_WEBLINK_RE);
  if (webLinkMatch) {
    return { type: 'url', value: webLinkMatch[0] };
  }

  // 3. 带协议头的其它链接：只接受酷狗域名，其余直接判为非法
  if (/^https?:\/\//i.test(trimmed)) {
    const host = safeParseUrl(trimmed)?.hostname || '';
    if (host !== 'kugou.com' && !host.endsWith('.kugou.com')) {
      return { type: 'invalid', value: trimmed, reason: '仅支持酷狗域名的歌单链接' };
    }
    return { type: 'url', value: trimmed };
  }

  // 4. 酷狗码口令 (如 ￥123456￥)
  const codeMatch = trimmed.match(/[￥¥]([a-zA-Z0-9_]+)[￥¥]/);
  if (codeMatch) {
    return { type: 'id', value: codeMatch[1] };
  }

  // 5. 纯数字歌单 ID
  if (/^\d{5,12}$/.test(trimmed)) {
    return { type: 'id', value: trimmed };
  }

  // 6. global_collection_id 原文
  if (/^collection_\d+_\d+_\d+_\d+$/.test(trimmed)) {
    return { type: 'id', value: trimmed };
  }

  // 7. 无协议头的酷狗链接（分享文案里常见）
  const bareLinkMatch = trimmed.match(KUGOU_BARE_LINK_RE);
  if (bareLinkMatch) {
    return { type: 'url', value: `https://${bareLinkMatch[0]}` };
  }

  // 8. 分享文案中夹带的纯数字歌单 ID
  const numberMatch = trimmed.match(/\b\d{5,12}\b/);
  if (numberMatch) {
    return { type: 'id', value: numberMatch[0] };
  }

  return {
    type: 'invalid',
    value: trimmed,
    reason: '无法识别的输入，请粘贴酷狗歌单链接、短链或歌单 ID',
  };
}

/**
 * 格式化歌曲封面链接（替换 {size} 占位符为 400）
 */
function formatCoverUrl(url?: string): string {
  return toSecureImageUrl(url?.replace(/\{size\}/g, '400'));
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
 * 各接口返回的原始曲目字段（酷狗各接口命名不一致，统一在此归一化）
 */
interface RawKuGouSong {
  hash?: string;
  FileHash?: string;
  HQFileHash?: string;
  SQFileHash?: string;
  sqhash?: string;
  name?: string;
  filename?: string;
  FileName?: string;
  songname?: string;
  SongName?: string;
  singername?: string;
  singer?: string;
  SingerName?: string;
  album_id?: string | number;
  albumid?: string | number;
  AlbumID?: string | number;
  timelen?: number;
  time_length?: number;
  duration?: number;
  Duration?: number;
  album_s_img?: string;
  pic?: string;
  img?: string;
  Image?: string;
  mixsongid?: string | number;
  audioid?: string | number;
  MixSongID?: string | number;
  ID?: string | number;
  fileid?: string | number;
}

/**
 * 把各接口的原始曲目字段映射为统一 KuGouSong
 * @param options.hash 优先采用的 hash（搜索接口按 SQ/HQ/普通顺序取值）
 * @param options.durationIn 接口时长单位：auto 按数值推断毫秒，seconds 直接当秒
 */
function toKuGouSong(
  raw: RawKuGouSong,
  options: { hash?: string; durationIn?: 'auto' | 'seconds' } = {}
): KuGouSong {
  const { hash, durationIn = 'auto' } = options;
  const { songName, singerName } = sanitizeSongInfo(
    raw.filename || raw.FileName,
    raw.songname || raw.SongName || raw.name,
    raw.singername || raw.singer || raw.SingerName
  );

  const rawDuration = Number(raw.timelen || raw.time_length || raw.duration || raw.Duration || 0);
  const duration =
    durationIn === 'seconds' || rawDuration <= 1000
      ? rawDuration
      : Math.round(rawDuration / 1000);

  const mixSongId = raw.mixsongid || raw.audioid || raw.MixSongID || raw.ID;

  return {
    hash: (hash || raw.hash || raw.FileHash || '').toLowerCase(),
    songName,
    singerName,
    albumId: String(raw.album_id || raw.albumid || raw.AlbumID || ''),
    duration,
    coverUrl: formatCoverUrl(raw.album_s_img || raw.pic || raw.img || raw.Image),
    sqHash: raw.sqhash ? raw.sqhash.toLowerCase() : undefined,
    mixSongId: mixSongId ? String(mixSongId) : undefined,
    fileId: raw.fileid ? String(raw.fileid) : undefined,
  };
}

/** 分页请求页间隔 / 退避延时的公共实现 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    const { specialId, globalCollectionId } = parseKuGouShareUrl(targetUrl);

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
    const duration = Math.round(parseInt(match[3], 10) / 1000) || 0;

    embeddedSongs.push({
      ...toKuGouSong({ filename: rawTitle, duration }, { hash, durationIn: 'seconds' }),
      coverUrl: coverUrl || '',
    });
  }

  return { specialId, playlistName, coverUrl, embeddedSongs };
}

/**
 * 调用酷狗移动端接口获取完整曲目列表（双接口高可用兜底）
 * totalSongs 为接口给出的云端总数（缺省时等于已取到的曲目数）。
 */
export async function fetchPlaylistTracks(specialId: string): Promise<{
  name: string;
  coverUrl: string;
  intro: string;
  songs: KuGouSong[];
  totalSongs: number;
}> {
  // 方式一：尝试使用酷狗移动端 CDN 标准接口（pagesize -1 即一次返回全部，无截断）
  try {
    const cdnUrl = 'http://mobilecdn.kugou.com/api/v3/special/song';
    interface CdnResponse {
      status: number;
      data?: {
        info: RawKuGouSong[];
        total?: number;
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
      const songs = cdnRes.data.info.map((item) => toKuGouSong(item));
      const total = Number(cdnRes.data.total || songs.length);

      // 单请求拿回来的曲目数必须与云端总数一致，否则说明被接口上限截断了：
      // 此时不能当成完整结果返回（那就是残表），交给下面的网关分页取完
      if (songs.length >= total) {
        return {
          name: `酷狗歌单 #${specialId}`,
          coverUrl: songs[0]?.coverUrl || '',
          intro: '',
          songs,
          totalSongs: total,
        };
      }
      console.warn(
        `[fetchPlaylistTracks] CDN 单请求仅返回 ${songs.length}/${total} 首，改走网关分页`
      );
    }
  } catch (err) {
    console.warn('[fetchPlaylistTracks] MobileCDN 接口拉取失败，尝试官方网关接口:', err);
  }

  // 方式二：使用移动端网关接口 + MD5 验签；显式分页取完全部曲目
  const gatewayUrl = 'http://gatewayretry.kugou.com/v2/get_other_list_file';
  const GATEWAY_PAGE_SIZE = 300;
  // 防风控安全上限：50 页 = 15000 首，超过即抛错，不返回残表
  const MAX_GATEWAY_PAGES = 50;
  const mid = await getDeviceMid();

  interface GatewayResponse {
    status: number;
    data?: {
      specialname?: string;
      intro?: string;
      img?: string;
      total?: number;
      info?: RawKuGouSong[];
    };
  }

  const songs: KuGouSong[] = [];
  let totalSongs = 0;
  let name = '';
  let coverUrl = '';
  let intro = '';

  for (let page = 1; page <= MAX_GATEWAY_PAGES; page++) {
    const timestamp = Math.floor(Date.now() / 1000);
    const queryParams: Record<string, string | number> = {
      appid: 1005,
      area_code: 1,
      clientver: 11239,
      module: 'CloudMusic',
      need_sort: 1,
      page,
      pagesize: GATEWAY_PAGE_SIZE,
      specalidpgc: specialId,
      specialid: specialId,
      type: 0,
      userid: 0,
    };

    const { res: gatewayRes } = await fetchPageWithRetry(
      () =>
        httpGet<GatewayResponse>(
          gatewayUrl,
          { ...queryParams, signature: signGatewayParams(queryParams) },
          {
            headers: {
              'User-Agent': KUGOU_GATEWAY_UA,
              Host: 'gatewayretry.kugou.com',
              'x-router': 'pubsongscdn.kugou.com',
              mid,
              dfid: '-',
              clienttime: String(timestamp),
            },
          }
        ),
      isReadAccepted
    );

    if (!gatewayRes || gatewayRes.status !== 1) {
      throw new Error(
        `获取歌单曲目失败 (specialId: ${specialId})，第 ${page} 页重试耗尽 (status: ${gatewayRes?.status ?? '无响应'})，已取到 ${songs.length}${totalSongs > 0 ? `/${totalSongs}` : ''} 首`
      );
    }

    const rawList = gatewayRes.data?.info || [];
    if (!name) {
      name = gatewayRes.data?.specialname || `酷狗歌单 #${specialId}`;
      coverUrl = formatCoverUrl(gatewayRes.data?.img);
      intro = gatewayRes.data?.intro || '';
      totalSongs = Number(gatewayRes.data?.total || 0);
    }

    songs.push(...rawList.map((item) => toKuGouSong(item)));

    // 末页判断：优先用云端总数，缺省时按「返回条数不足一页」
    const isLastPage =
      rawList.length < GATEWAY_PAGE_SIZE ||
      (totalSongs > 0 && songs.length >= totalSongs);
    if (isLastPage) {
      return {
        name,
        coverUrl: coverUrl || songs[0]?.coverUrl || '',
        intro,
        songs,
        totalSongs: totalSongs > 0 ? totalSongs : songs.length,
      };
    }

    await sleep(400);
  }

  throw new Error(
    `获取歌单曲目失败 (specialId: ${specialId})，超过 ${MAX_GATEWAY_PAGES} 页上限，已取到 ${songs.length}${totalSongs > 0 ? `/${totalSongs}` : ''} 首`
  );
}

/**
 * 对外统一导入歌单入口
 */
export async function importKuGouPlaylist(rawInput: string): Promise<KuGouPlaylist> {
  const extracted = extractKuGouInput(rawInput);
  // 非法输入直接给出用户可读错误，避免后续把任意文本当 URL 解析
  if (extracted.type === 'invalid') {
    throw new Error(extracted.reason || '无法识别的输入，请粘贴酷狗歌单链接、短链或歌单 ID');
  }

  let resolvedSpecialId: string | undefined = undefined;
  let resolvedGlobalCollectionId: string | undefined = undefined;
  let resolvedName: string | undefined = undefined;
  let resolvedCover: string | undefined = undefined;
  let parsedSongs: KuGouSong[] = [];
  let parsedTotal = 0;

  if (extracted.type === 'shortlink') {
    const res = await resolveShortLink(extracted.value);
    resolvedSpecialId = res.specialId;
    resolvedGlobalCollectionId = res.globalCollectionId;
  } else if (extracted.type === 'url') {
    const linkParams = parseKuGouShareUrl(extracted.value);
    resolvedSpecialId = linkParams.specialId;
    resolvedGlobalCollectionId = linkParams.globalCollectionId;
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
      parsedTotal = parsedSongs.length;
    }
  }

  // 如果没有从网页内嵌拿到歌曲，但拿到了数字 specialId，调用移动端 API 拉取
  if (parsedSongs.length === 0 && resolvedSpecialId) {
    const trackResult = await fetchPlaylistTracks(resolvedSpecialId);
    if (!resolvedName) resolvedName = trackResult.name;
    if (!resolvedCover) resolvedCover = trackResult.coverUrl;
    parsedSongs = trackResult.songs;
    parsedTotal = trackResult.totalSongs;
  }

  if (parsedSongs.length === 0) {
    throw new Error(`解析失败：未能从该分享链接中解析到曲目列表。输入内容: ${rawInput}`);
  }

  const playlist: KuGouPlaylist = {
    id: resolvedGlobalCollectionId || resolvedSpecialId || String(Date.now()),
    name: resolvedName || '我的酷狗歌单',
    coverUrl: resolvedCover || parsedSongs[0]?.coverUrl || '',
    intro: '',
    totalSongs: Math.max(parsedSongs.length, parsedTotal),
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
 * 歌单落盘写队列：所有「读-改-写」与整表覆盖串行执行，避免并发写互相覆盖
 */
let storageWriteChain: Promise<unknown> = Promise.resolve();

function enqueueStorageWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = storageWriteChain.then(task, task);
  storageWriteChain = run.catch(() => undefined);
  return run;
}

/**
 * 读取落盘的全部歌单（不做任何历史数据清洗）
 */
async function readPlaylists(): Promise<KuGouPlaylist[]> {
  const store = await getStore();
  if (store) {
    return (await store.get<KuGouPlaylist[]>(STORE_KEY)) || [];
  }
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as KuGouPlaylist[];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * 唯一的歌单落盘实现 (Tauri Store 或 localStorage)
 */
async function writePlaylists(playlists: KuGouPlaylist[]): Promise<void> {
  const store = await getStore();
  if (store) {
    await store.set(STORE_KEY, playlists);
    await store.save();
    return;
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORE_KEY, JSON.stringify(playlists));
  }
}

/**
 * 在写队列中执行一次「读-改-写」
 */
async function mutatePlaylists(
  mutate: (playlists: KuGouPlaylist[]) => KuGouPlaylist[]
): Promise<void> {
  await enqueueStorageWrite(async () => {
    await writePlaylists(mutate(await readPlaylists()));
  });
}

/**
 * 将歌单保存至本地存储 (Tauri Store 或 localStorage)
 */
export async function savePlaylistToStorage(playlist: KuGouPlaylist): Promise<void> {
  await mutatePlaylists((playlists) => {
    const existingIdx = playlists.findIndex((p) => p.id === playlist.id);
    if (existingIdx < 0) return [playlist, ...playlists];
    const next = playlists.slice();
    next[existingIdx] = playlist;
    return next;
  });
}

/**
 * 获取本地已导入的所有歌单列表
 */
export async function getLocalPlaylists(): Promise<KuGouPlaylist[]> {
  return readPlaylists();
}

/**
 * 根据 ID 删除本地歌单
 */
export async function deleteLocalPlaylist(id: string): Promise<void> {
  await mutatePlaylists((playlists) => playlists.filter((p) => p.id !== id));
}

/**
 * 覆盖保存所有本地歌单
 */
export async function saveAllPlaylistsToStorage(playlists: KuGouPlaylist[]): Promise<void> {
  await enqueueStorageWrite(() => writePlaylists(playlists));
}

/**
 * 酷狗网关带 body 的签名使用 signGatewayParams(params, { body, salt })；
 * 此处的 salt 必须与所用 appid 同平台，否则网关返回 20006 签名校验失败。
 */

/** 网关通用响应：status === 1 或 error_code === 0 表示成功 */
interface GatewayResult {
  status: number;
  error_code?: number;
}

/** 签名 / 登录态与平台强相关的错误码，只有这些错误值得换平台重试 */
const PLATFORM_SWITCH_CODES = [20006, 20017];

/** 读接口：status === 1 即认为成功 */
function isReadAccepted(res: GatewayResult | null): boolean {
  return Boolean(res && res.status === 1);
}

/** 写接口：部分接口只用 error_code 表达成功 */
function isWriteAccepted(res: GatewayResult | null): boolean {
  return Boolean(res && (res.status === 1 || res.error_code === 0));
}

/**
 * 组装一次网关请求的公共参数与请求头（clienttime 在两者中保持一致）
 */
function gatewayContext(
  platform: GatewayPlatform,
  mid: string,
  token: string,
  userid: string
): { query: Record<string, string | number>; headers: Record<string, string> } {
  const clienttime = Math.floor(Date.now() / 1000);
  return {
    query: {
      appid: platform.appid,
      clienttime,
      clientver: gatewayClientverFor(platform),
      dfid: '-',
      mid,
      plat: 1,
      token,
      userid: Number(userid),
      uuid: '-',
    },
    headers: {
      ...DEFAULT_GATEWAY_HEADERS,
      clienttime: String(clienttime),
      mid,
      token,
      userid,
    },
  };
}

/** postGateway 的附加参数 */
interface GatewayExtraParams {
  query?: Record<string, string | number>;
  headers?: Record<string, string>;
  /** 依赖 clienttime 的参数（如 last_time 必须与 clienttime 一致） */
  queryFromClienttime?: (clienttime: number) => Record<string, string | number>;
}

/**
 * 带 body 的网关 POST：公共参数/头 + 平台盐签名 + 附加 query/header
 */
async function postGateway<T>(
  url: string,
  platform: GatewayPlatform,
  auth: { mid: string; token: string; userid: string },
  body: unknown,
  extra: GatewayExtraParams = {}
): Promise<T | null> {
  const { query, headers } = gatewayContext(platform, auth.mid, auth.token, auth.userid);
  const finalQuery: Record<string, string | number> = {
    ...query,
    ...extra.queryFromClienttime?.(Number(query.clienttime)),
    ...extra.query,
  };
  finalQuery.signature = signGatewayParams(finalQuery, { body, salt: platform.signatureSalt });
  return httpPost<T>(url, body, {
    query: finalQuery,
    headers: { ...headers, ...extra.headers },
  });
}

/**
 * 按登录平台发起请求；若网关以签名/登录态错误拒绝，换另一平台再试一次
 * （历史 token 可能来自另一个 appid 平台）。
 */
async function requestWithPlatformFallback<T extends GatewayResult>(
  call: (platform: GatewayPlatform) => Promise<T | null>,
  isAccepted: (res: T | null) => boolean,
  kugouAppId?: number
): Promise<T | null> {
  const platform = platformOfAppId(kugouAppId);
  const first = await call(platform);
  if (first && isAccepted(first)) return first;

  // 与平台无关的错误（如参数不合法）不值得换平台重试
  const switchable =
    Boolean(first) &&
    first!.status !== 1 &&
    (first!.error_code === undefined || PLATFORM_SWITCH_CODES.includes(first!.error_code));
  if (!switchable) return first;

  const retry = await call(otherPlatform(platform));
  return retry && isAccepted(retry) ? retry : first;
}

/**
 * 单页请求重试封装：最多 maxAttempts 次，返回最后一次响应（含 attempts）。
 * 重试耗尽时不在这里抛错，由调用方拼上「已取到多少条」再抛。
 */
async function fetchPageWithRetry<T extends GatewayResult>(
  call: () => Promise<T | null>,
  isAccepted: (res: T | null) => boolean,
  maxAttempts = 3,
  retryDelayMs = 800
): Promise<{ res: T | null; attempts: number }> {
  let res: T | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      res = await call();
    } catch (err) {
      console.warn(`[kugouPlaylist] 分页请求异常，准备重试 ${attempt}/${maxAttempts}:`, err);
      res = null;
    }
    if (res && isAccepted(res)) return { res, attempts: attempt };
    if (attempt < maxAttempts) await sleep(retryDelayMs);
  }
  return { res, attempts: maxAttempts };
}

/**
 * 云端歌单写操作公共实现：按登录平台签名请求 + 换平台重试 + 统一成功语义
 */
async function requestCloudWrite(
  url: string,
  body: unknown,
  auth: { mid: string; token: string; userid: string },
  kugouAppId: number | undefined,
  extra: GatewayExtraParams = {}
): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await requestWithPlatformFallback(
    (platform) => postGateway<GatewayResult & { error?: string }>(url, platform, auth, body, extra),
    isWriteAccepted,
    kugouAppId
  );

  if (res && isWriteAccepted(res)) return { ok: true };
  return {
    ok: false,
    error: res?.error || `酷狗云端响应异常 (code: ${res?.error_code || res?.status})`,
  };
}

/** 网络异常转用户可读消息 */
function describeRequestError(err: unknown): string {
  return err instanceof Error ? err.message : '网络同步请求失败';
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

  const searchUrl = 'https://songsearch.kugou.com/song_search_v2';
  interface SearchResponse {
    status: number;
    data?: {
      lists?: RawKuGouSong[];
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
        .map((item) =>
          toKuGouSong(
            { ...item, sqhash: item.SQFileHash },
            {
              hash: item.FileHash || item.HQFileHash || item.SQFileHash || '',
              durationIn: 'seconds',
            }
          )
        )
        .filter((s) => Boolean(s.hash));
    }
  } catch (err) {
    console.warn('[searchKuGouSongs] 搜索曲目异常:', err);
  }

  return [];
}

/** 云端歌单列表项（v7/get_all_list 的字段命名不统一，此处收敛为一份） */
interface CloudListMeta {
  listid?: number | string;
  list_id?: number | string;
  id?: number | string;
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
}

/** 云端歌单列表分页上限（100 页 × 100 条 = 10000 个歌单） */
const MAX_CLOUD_LIST_PAGES = 100;

/**
 * 拉取已授权用户的酷狗账号云端歌单列表（显式分页取完，不静默截断）
 */
export async function fetchUserCloudPlaylists(
  token: string,
  userid: string,
  kugouAppId?: number
): Promise<KuGouPlaylist[]> {
  if (!token || !userid) return [];

  const mid = await getDeviceMid();
  const url = 'https://gateway.kugou.com/cloudlist.service/v7/get_all_list';

  interface GetAllListResponse extends GatewayResult {
    data?: {
      info?: CloudListMeta[];
      list?: CloudListMeta[];
      lists?: CloudListMeta[];
    };
  }

  const CLOUD_LIST_PAGE_SIZE = 100;
  const items: CloudListMeta[] = [];

  for (let page = 1; page <= MAX_CLOUD_LIST_PAGES; page++) {
    // appid / clientver / 签名盐必须与登录平台同源，否则网关按「未登录」返回 20017，
    // 因此一次调用整体换平台重试（历史 token 可能来自另一个平台）。
    const res = await requestWithPlatformFallback(
      (platform) =>
        postGateway<GetAllListResponse>(
          url,
          platform,
          { mid, token, userid },
          {
            userid: Number(userid),
            token,
            total_ver: 979,
            type: 2,
            page,
            pagesize: CLOUD_LIST_PAGE_SIZE,
          }
        ),
      isReadAccepted,
      kugouAppId
    );

    // 网关返回 status !== 1 时抛出真实错误，避免 UI 误显示为「暂无云端歌单」
    if (!res || res.status !== 1) {
      throw new Error(describeKuGouError(res?.error_code, res?.status));
    }

    const pageItems = res.data?.info || res.data?.list || res.data?.lists || [];
    items.push(...pageItems);
    if (pageItems.length < CLOUD_LIST_PAGE_SIZE) break;
    await sleep(300);
  }

  const result: KuGouPlaylist[] = [];

  for (const item of items) {
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

/** 云端歌单曲目分页结果 */
export interface CloudPlaylistTracksResult {
  songs: KuGouSong[];
  /** 接口给出的云端权威总数（接口未返回时等于已取到数量） */
  totalSongs: number;
  /** 是否已完整取完（false 仅表示触发了分页上限） */
  complete: boolean;
}

/**
 * 拉取用户云端歌单内包含的完整曲目：显式分页取完。
 * 单页重试耗尽时抛错（携带已取到条数），绝不返回残表。
 */
export async function fetchUserCloudPlaylistTracksFull(
  listId: string,
  token: string,
  userid: string,
  kugouAppId?: number
): Promise<CloudPlaylistTracksResult> {
  const mid = await getDeviceMid();
  const PAGE_SIZE = 300;
  // 防风控安全上限：20 页 = 6000 首
  const MAX_PAGES = 20;
  const PAGE_INTERVAL_MS = 400;

  const url = 'https://gateway.kugou.com/cloudlist.service/v4/get_list_all_file_v3';

  interface TrackListResponse extends GatewayResult {
    data?: {
      info?: RawKuGouSong[];
      songs?: RawKuGouSong[];
      total?: number;
    };
  }

  // 单页请求：clienttime 与签名由 postGateway 按页重新计算
  const fetchPage = (page: number, platform: GatewayPlatform) =>
    postGateway<TrackListResponse>(
      url,
      platform,
      { mid, token, userid },
      {
        listid: Number(listId),
        userid: Number(userid),
        type: 0,
        page,
        pagesize: PAGE_SIZE,
        area_code: 1,
        allplatform: 1,
        show_cover: 1,
        token,
      }
    );

  const all: KuGouSong[] = [];
  let totalSongs = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { res } = await fetchPageWithRetry(
      () =>
        requestWithPlatformFallback<TrackListResponse>(
          (platform) => fetchPage(page, platform),
          isReadAccepted,
          kugouAppId
        ),
      isReadAccepted
    );

    if (!res || res.status !== 1) {
      throw new Error(
        `获取云端歌单曲目失败 (listId: ${listId})：第 ${page} 页重试耗尽 (status: ${res?.status ?? '无响应'})，已取到 ${all.length}${totalSongs > 0 ? `/${totalSongs}` : ''} 首`
      );
    }

    if (page === 1) {
      totalSongs = Number(res.data?.total || 0);
    }

    const rawSongs = res.data?.info || res.data?.songs || [];
    all.push(...rawSongs.map((item) => toKuGouSong(item)));

    // 末页判断：优先用云端总数，其次用「返回条数不足一页」
    if (rawSongs.length < PAGE_SIZE || (totalSongs > 0 && all.length >= totalSongs)) {
      return { songs: all, totalSongs: totalSongs > 0 ? totalSongs : all.length, complete: true };
    }

    // 页间留间隔，降低请求频率避免触发风控
    await sleep(PAGE_INTERVAL_MS);
  }

  return { songs: all, totalSongs: totalSongs > 0 ? totalSongs : all.length, complete: false };
}

/**
 * 拉取用户云端歌单内包含的完整曲目（兼容旧调用方：异常时返回空表）。
 * 需要区分「失败」与「完整」请直接用 fetchUserCloudPlaylistTracksFull。
 */
export async function fetchUserCloudPlaylistTracks(
  listId: string,
  token: string,
  userid: string,
  kugouAppId?: number
): Promise<KuGouSong[]> {
  try {
    const { songs } = await fetchUserCloudPlaylistTracksFull(listId, token, userid, kugouAppId);
    return songs;
  } catch (err) {
    console.warn(`[fetchUserCloudPlaylistTracks] 获取歌单曲目失败 (listId: ${listId}):`, err);
    return [];
  }
}

/**
 * 将指定曲目添加到酷狗云端歌单并同步酷狗账号
 */
export async function addSongToUserCloudPlaylist(
  song: KuGouSong,
  listId: string,
  token: string,
  userid: string,
  kugouAppId?: number
): Promise<{ success: boolean; message: string }> {
  if (!token || !userid || !listId) {
    return { success: false, message: '缺少登录态或歌单 ID' };
  }

  const mid = await getDeviceMid();

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

  const url = 'https://gateway.kugou.com/cloudlist.service/v6/add_song';

  try {
    const result = await requestCloudWrite(url, body, { mid, token, userid }, kugouAppId, {
      // last_time 必须与 clienttime 一致，由 postGateway 注入
      queryFromClienttime: (clienttime) => ({ last_area: 'gztx', last_time: clienttime }),
    });
    if (result.ok) return { success: true, message: '已成功添加并同步至酷狗账号！' };
    return { success: false, message: result.error };
  } catch (err: unknown) {
    return { success: false, message: describeRequestError(err) };
  }
}

/**
 * 从酷狗云端歌单删除指定曲目。
 *
 * 网关路由 v4/delete_songs 必须带 x-router 才能命中 cloudlist 服务，
 * 且删除以歌单内条目 fileid 为准，歌曲 hash 不参与定位。
 */
export async function removeSongFromUserCloudPlaylist(
  song: KuGouSong,
  listId: string,
  token: string,
  userid: string,
  kugouAppId?: number
): Promise<{ success: boolean; message: string }> {
  if (!token || !userid || !listId) {
    return { success: false, message: '缺少登录态或歌单 ID' };
  }

  const mid = await getDeviceMid();

  // 搜索结果与本地缓存里没有 fileid，只能回云端列表按 hash 定位条目
  let fileId = song.fileId;
  if (!fileId) {
    const cloudSongs = await fetchUserCloudPlaylistTracks(listId, token, userid, kugouAppId);
    fileId = cloudSongs.find((s) => s.hash === song.hash.toLowerCase())?.fileId;
    if (!fileId) {
      return { success: false, message: '云端歌单中没有找到这首歌曲' };
    }
  }

  const body = {
    listid: Number(listId),
    userid: Number(userid),
    data: [{ fileid: Number(fileId) }],
    type: 0,
    token,
    list_ver: 0,
  };

  const url = 'https://gateway.kugou.com/v4/delete_songs';

  try {
    const result = await requestCloudWrite(url, body, { mid, token, userid }, kugouAppId, {
      // v4/delete_songs 必须带 x-router 才能命中 cloudlist 服务
      headers: { 'x-router': 'cloudlist.service.kugou.com' },
    });
    if (result.ok) return { success: true, message: '已从酷狗云端歌单删除' };
    return { success: false, message: result.error };
  } catch (err: unknown) {
    return { success: false, message: describeRequestError(err) };
  }
}

