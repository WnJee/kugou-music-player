/**
 * 双轨音源播放引擎 (src/services/audioSource.ts)
 * 1. 主轨：结合酷狗概念版 Token 与 UserID 提取官方完整音源，支持概念版每日签到领 VIP
 * 2. 备轨：免登录 / 试听兜底，使用 songName + singerName 检索公开音源（时长匹配误差 ±3 秒内）
 */

import { Store } from '@tauri-apps/plugin-store';
import type { AudioSourceResult, KuGouSong, UserSettings } from '../types/music';
import { md5 } from '../utils/md5';
import { httpGet, httpPost, KUGOU_CONCEPT_UA, KUGOU_GATEWAY_UA } from './http';
import { getDeviceMid } from './device';

const SETTINGS_STORE_FILE = 'kugou_settings.json';
const SETTINGS_KEY = 'user_settings';

const DEFAULT_SETTINGS: UserSettings = {
  kugouToken: '',
  kugouUserId: '',
  autoCheckinVip: true,
  lastCheckinDate: '',
  customFallbackApi: '',
};

let settingsStore: Store | null = null;

/**
 * 获取本地配置存储 Store
 */
async function getSettingsStore(): Promise<Store | null> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    if (!settingsStore) {
      try {
        settingsStore = await Store.load(SETTINGS_STORE_FILE);
      } catch (e) {
        console.warn('[SettingsStore] 加载 Tauri Store 失败，使用 localStorage', e);
      }
    }
    return settingsStore;
  }
  return null;
}

/**
 * 读取用户本地设置
 */
export async function getUserSettings(): Promise<UserSettings> {
  const store = await getSettingsStore();
  if (store) {
    const val = await store.get<UserSettings>(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...val };
  }
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
      } catch {
        return DEFAULT_SETTINGS;
      }
    }
  }
  return DEFAULT_SETTINGS;
}

/**
 * 保存用户本地设置
 */
export async function saveUserSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
  const current = await getUserSettings();
  const updated: UserSettings = { ...current, ...settings };
  const store = await getSettingsStore();

  if (store) {
    await store.set(SETTINGS_KEY, updated);
    await store.save();
  } else if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  }
  return updated;
}

/**
 * 拉取酷狗用户资料（昵称/头像）
 * 走 usercenter /v3/get_my_info，p 参数为 RSA_NO_PADDING 加密（前端用 BigInt 实现）
 */
const RSA_MODULUS = 0xC8006ED03842D2628209BD314984CA5ED6CFE06E30C95F9D4704D9C49791D7A935BA950ECB0BC8EBF5F5994F0BAC927A7EB151B3C1DE343303FA539C83136ECCFD7D7E511E2DBCE18EAA9F784C9B50D443E75865979E0A5E216E46C684066A8D6B998580BBAA22D73F5790286BB14742E83244E44DB6D707FFE162C5C7002D45n;
const RSA_EXPONENT = 65537n;

function rsaNoPaddingHex(data: string): string {
  const bytes = new TextEncoder().encode(data);
  const padded = new Uint8Array(128);
  padded.set(bytes.slice(0, 128));
  const m = BigInt('0x' + Array.from(padded).map((b) => b.toString(16).padStart(2, '0')).join(''));
  // 模幂运算（e=65537，17 次平方乘法，耗时忽略不计）
  let result = 1n;
  let base = m % RSA_MODULUS;
  let exp = RSA_EXPONENT;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % RSA_MODULUS;
    base = (base * base) % RSA_MODULUS;
    exp >>= 1n;
  }
  return result.toString(16).toUpperCase().padStart(256, '0');
}

export async function fetchUserProfile(
  token: string,
  userid: string
): Promise<{ nickname: string; avatar: string } | null> {
  if (!token || !userid) return null;

  try {
    const mid = await getDeviceMid();
    const timestamp = Math.floor(Date.now() / 1000);
    const params: Record<string, string | number> = {
      dfid: '-',
      mid,
      uuid: '-',
      appid: 1005,
      clientver: 20489,
      userid: Number(userid),
      clienttime: timestamp,
      token,
      plat: 1,
    };
    const body = {
      visit_time: timestamp,
      usertype: 1,
      p: rsaNoPaddingHex(JSON.stringify({ token, clienttime: timestamp })),
      userid: Number(userid),
    };
    const bodyStr = JSON.stringify(body);
    const signature = signGatewayParams(params, bodyStr);
    params.signature = signature;

    const res = await httpPost<{
      status: number;
      data?: { nickname?: string; pic?: string };
    }>('https://gateway.kugou.com/v3/get_my_info', body, {
      query: params,
      headers: {
        'User-Agent': KUGOU_GATEWAY_UA,
        Cookie: `token=${token}; userid=${userid}; dfid=-`,
        dfid: '-',
        clienttime: String(timestamp),
        mid,
        'x-router': 'usercenter.kugou.com',
      },
    });

    if (res?.status === 1 && res.data?.nickname) {
      return {
        nickname: res.data.nickname,
        avatar: (res.data.pic || '').replace(/^http:\/\//, 'https://'),
      };
    }
    return null;
  } catch (err) {
    console.warn('[fetchUserProfile] 拉取用户资料失败:', err);
    return null;
  }
}

/**
 * 查询概念版 VIP 实时状态（kugouvip 网关，与签到查询同接口）
 * 从 busi_vip 数组中取 busi_type === 'concept' 的条目判断是否有效会员
 */
export async function fetchConceptVipStatus(
  token: string,
  userid: string
): Promise<{ isVip: boolean; vipEndTime: string } | null> {
  if (!token || !userid) return null;

  try {
    const mid = await getDeviceMid();
    const timestamp = Math.floor(Date.now() / 1000);
    const params: Record<string, string | number> = {
      dfid: '-',
      mid,
      uuid: '-',
      appid: 1005,
      clientver: 20489,
      userid: Number(userid),
      clienttime: timestamp,
      token,
      busi_type: 'concept',
    };
    const signature = signGatewayParams(params, '');
    params.signature = signature;

    const res = await httpGet<{
      status: number;
      data?: {
        is_vip?: number;
        busi_vip?: Array<{
          is_vip?: number;
          busi_type?: string;
          vip_end_time?: string;
          product_type?: string;
        }>;
      };
    }>('https://kugouvip.kugou.com/v1/get_union_vip', params, {
      headers: {
        'User-Agent': KUGOU_GATEWAY_UA,
        Cookie: `token=${token}; userid=${userid}; dfid=-`,
        dfid: '-',
        clienttime: String(timestamp),
        mid,
      },
    });

    if (res?.status !== 1 || !res.data) return null;

    // 优先取概念版条目；busi_vip 为空时回退顶层 is_vip
    const concept = res.data.busi_vip?.find((v) => v.busi_type === 'concept' && v.is_vip === 1);
    if (concept?.vip_end_time) {
      return { isVip: true, vipEndTime: concept.vip_end_time };
    }
    return { isVip: res.data.is_vip === 1, vipEndTime: '' };
  } catch (err) {
    console.warn('[fetchConceptVipStatus] 查询 VIP 状态失败:', err);
    return null;
  }
}

/**
 * 酷狗概念版每日领取 VIP（已实测可用的官方接口，2025+ 版本）
 * 流程（与酷狗概念版 App「听歌领会员」一致）：
 *   1. 听歌上报 /youth/v2/report/listen_song（clientver=10566 + 专用 UA）
 *   2. 广告播放上报 /youth/v1/ad/play_report 领取会员时长（每日最多 8 次，每次 3 小时）
 *   3. 查询 /v1/get_union_vip 获取概念版会员到期时间
 * 成功或"今日已领完"才写入 lastCheckinDate；失败如实返回错误信息。
 */
export async function checkinConceptVip(token: string, userid: string): Promise<{ success: boolean; message: string }> {
  if (!token || !userid) {
    return { success: false, message: '未配置 Token 或 UserID' };
  }

  const mid = await getDeviceMid();
  const todayStr = new Date().toISOString().split('T')[0];

  /** 构造网关签名请求（参数集与概念版客户端一致，body 参与签名） */
  const kgPost = async <T>(
    path: string,
    data: unknown,
    extra: {
      query?: Record<string, string | number>;
      base?: string;
      ua?: string;
      contentType?: string;
    } = {}
  ): Promise<T> => {
    const timestamp = Math.floor(Date.now() / 1000);
    const params: Record<string, string | number> = {
      dfid: '-',
      mid,
      uuid: '-',
      appid: 1005,
      clientver: 20489,
      userid: Number(userid),
      clienttime: timestamp,
      token,
      ...(extra.query || {}),
    };
    const bodyStr = data === undefined ? '' : JSON.stringify(data);
    const signature = signGatewayParams(params, bodyStr);
    params.signature = signature;

    return httpPost<T>(`${extra.base || 'https://gateway.kugou.com'}${path}`, data, {
      query: params,
      headers: {
        'User-Agent': extra.ua || KUGOU_GATEWAY_UA,
        Cookie: `token=${token}; userid=${userid}; dfid=-`,
        dfid: '-',
        clienttime: String(timestamp),
        mid,
        ...(bodyStr ? { 'Content-Type': extra.contentType || 'application/json' } : {}),
      },
    });
  };

  try {
    // 1. 听歌上报（触发每日听歌任务）
    const listen = await kgPost<{ status: number; error_code: number; error_msg?: string }>(
      '/youth/v2/report/listen_song',
      { mixsongid: 666075191 },
      {
        query: { clientver: 10566 },
        ua: 'Android13-1070-10566-201-0-ReportPlaySongToServerProtocol-wifi',
        contentType: 'application/json; charset=utf-8',
      }
    );
    console.info('[checkinConceptVip] 听歌上报:', listen?.status, listen?.error_msg || '');

    // 2. 广告播放上报领取会员时长：每日最多 8 次，error_code 30002 表示今日已领完
    let claimed = 0;
    let reachedLimit = false;
    let lastMsg = '';
    for (let i = 1; i <= 8; i++) {
      const now = Date.now();
      const ad = await kgPost<{
        status: number;
        error_code: number;
        error_msg?: string;
        data?: { remain?: number; done?: number; total?: number; award_vip_hour?: number };
      }>('/youth/v1/ad/play_report', {
        ad_id: 12307537187,
        play_end: now,
        play_start: now - 30000,
      });

      if (ad?.status === 1) {
        claimed += 1;
        // 每次领取间隔 2 秒，防止风控
        if (i < 8) await new Promise((resolve) => setTimeout(resolve, 2000));
      } else if (ad?.error_code === 30002) {
        reachedLimit = true;
        break;
      } else {
        lastMsg = ad?.error_msg || `领取失败 (error_code: ${ad?.error_code})`;
        break;
      }
    }

    // 3. 查询概念版会员到期时间（复用 GET 版状态查询，失败不影响签到结果）
    let expiryHint = '';
    try {
      const vip = await fetchConceptVipStatus(token, userid);
      if (vip?.vipEndTime) expiryHint = `，到期时间 ${vip.vipEndTime}`;
    } catch {
      /* 忽略查询失败 */
    }

    if (claimed > 0 || reachedLimit) {
      await saveUserSettings({ lastCheckinDate: todayStr });
      const claimMsg = reachedLimit
        ? claimed > 0
          ? `今日领取 ${claimed} 次后已达上限`
          : '今日已完成领取'
        : `成功领取 ${claimed} 次`;
      return {
        success: true,
        message: `概念版 VIP 打卡完成：${claimMsg}${expiryHint}`,
      };
    }

    return {
      success: false,
      message: lastMsg || '签到失败：未领取到任何会员时长',
    };
  } catch (err: unknown) {
    console.error('[checkinConceptVip] 签到异常:', err);
    return {
      success: false,
      message: err instanceof Error ? err.message : '签到网络异常',
    };
  }
}

/**
 * 尝试自动执行每日签到（若开启且今日未签）
 * 启动时网络可能尚未就绪，失败自动重试最多 3 次
 */
export async function tryAutoCheckin(): Promise<void> {
  const settings = await getUserSettings();
  if (!settings.autoCheckinVip || !settings.kugouToken || !settings.kugouUserId) {
    return;
  }
  const today = new Date().toISOString().split('T')[0];
  if (settings.lastCheckinDate === today) {
    return; // 今日已签过
  }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await checkinConceptVip(settings.kugouToken, settings.kugouUserId);
    if (res.success) {
      console.info('[tryAutoCheckin] 自动签到成功:', res.message);
      return;
    }
    console.warn(`[tryAutoCheckin] 自动签到失败 (${attempt}/3): ${res.message}`);
    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

/**
 * 酷狗标准版音源 key 盐值（取自官方 Android 客户端）
 */
const TRACKER_KEY_SALT = '57ae12eb6890223e355ccfcb74edf70d';
// 酷狗概念版（lite）专用协议参数：登录态与 appid 必须同平台，VIP 鉴权才会生效。
const CONCEPT_APPID = 3116;
const CONCEPT_CLIENTVER = 11430;
const CONCEPT_SIGNATURE_SALT = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA';
const CONCEPT_TRACKER_KEY_SALT = '185672dd44712f60bb1736df5a377e82';
const CONCEPT_PAGE_ID = 967177915;
const CONCEPT_PPID = '356753938,823673182,967485191';

/**
 * 酷狗 Android 网关签名盐值
 */
const KUGOU_API_SALT = 'OIlwieks28dk2k092lksi2UIkp';

function signGatewayParams(
  params: Record<string, string | number>,
  bodyObj?: unknown
): string {
  const sorted = Object.keys(params)
    .filter((k) => k !== 'signature')
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('');
  const bodyStr = bodyObj ? (typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj)) : '';
  return md5(`${KUGOU_API_SALT}${sorted}${bodyStr}${KUGOU_API_SALT}`);
}

interface TrackerV5Response {
  status: number;
  error_code?: number;
  error_msg?: string;
  url?: string[] | string;
  timeLength?: number;
  bitRate?: number;
  fileSize?: number;
}

function trackerUserAgent(settings: UserSettings): string {
  // 网关 UA 是官方 Android 协议标识；概念版差异由 appid/盐值和页面 ID 控制。
  return KUGOU_GATEWAY_UA;
}

interface TrackerAttempt {
  result: AudioSourceResult | null;
  errorCode?: number;
  errorMsg?: string;
}

function hasCredentials(settings: UserSettings): boolean {
  return Boolean(settings.kugouToken && settings.kugouUserId);
}

function describeMissingVipPermission(
  song: KuGouSong,
  settings: UserSettings
): string {
  if (!hasCredentials(settings)) {
    return `《${song.songName}》为 VIP 专享，请先在设置中授权酷狗概念版账号`;
  }
  return `《${song.songName}》官方音源无完整播放权限，请确认概念版 VIP 生效且账号未被限制`;
}

/**
 * 统一音源解析器：走酷狗网关 trackercdn /v5/url
 *
 * 旧实现调用废弃的 /i/v2/ 且缺少 mid 参数，服务端固定返回 "Empty mid"，
 * 导致主轨 100% 失败；备轨候选也复用了同一个坏接口，最终只能依赖第三方镜像。
 */
export async function resolveKugouAudioUrl(
  song: KuGouSong,
  settings: UserSettings,
  quality: number | string = 128
): Promise<TrackerAttempt> {
  const hash = (song.hash || '').toLowerCase();
  if (!hash) return { result: null };

  const mid = await getDeviceMid();
  const userid = settings.kugouUserId || '0';
  const isConcept = hasCredentials(settings);
  const appid = isConcept ? CONCEPT_APPID : 1005;
  const clienttime = Math.floor(Date.now() / 1000);

  const params: Record<string, string | number> = {
    dfid: '-',
    mid,
    uuid: '-',
    appid,
    clientver: isConcept ? CONCEPT_CLIENTVER : 11430,
    clienttime,
    token: settings.kugouToken || '',
    userid: Number(userid) || 0,
    album_id: Number(song.albumId || 0),
    area_code: 1,
    hash,
    ssa_flag: 'is_fromtrack',
    version: 11430,
    page_id: isConcept ? CONCEPT_PAGE_ID : 151369488,
    quality,
    album_audio_id: Number(song.mixSongId || 0),
    behavior: 'play',
    pid: isConcept ? 411 : 2,
    cmd: 26,
    pidversion: 3001,
    IsFreePart: 0,
    ppage_id: isConcept ? CONCEPT_PPID : '463467626,350369493,788954147',
    cdnBackup: 1,
    module: '',
    key: md5(
      `${hash}${
        isConcept ? CONCEPT_TRACKER_KEY_SALT : TRACKER_KEY_SALT
      }${appid}${mid}${userid}`
    ),
  };
  params.signature = isConcept
    ? md5(
        `${CONCEPT_SIGNATURE_SALT}${Object.keys(params)
          .filter((k) => k !== 'signature')
          .sort()
          .map((k) => `${k}=${params[k]}`)
          .join('')}${CONCEPT_SIGNATURE_SALT}`
      )
    : signGatewayParams(params);

  try {
    const res = await httpGet<TrackerV5Response>('https://gateway.kugou.com/v5/url', params, {
      headers: {
        'User-Agent': trackerUserAgent(settings),
        'kg-rc': '1',
        'kg-thash': '5d816a0',
        'kg-rec': '1',
        'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
        dfid: '-',
        clienttime: String(clienttime),
        mid,
        // 酷狗鉴权除了 query token，还会校验登录 Cookie；缺失时会按未登录返回试听。
        Cookie: `token=${settings.kugouToken || ''}; userid=${userid}; dfid=-`,
        'x-router': 'trackercdn.kugou.com',
      },
    });

    if (res?.status === 1) {
      const url = Array.isArray(res.url) ? res.url[0] : res.url;
      if (url) {
        const duration = res.timeLength || song.duration || 0;
        const isTrial = duration > 0 && duration <= 60 && song.duration > 75;
        const result: AudioSourceResult = {
          url,
          source: 'primary',
          bitrate: res.bitRate ? Math.round(res.bitRate / 1000) : 128,
          duration,
          isTrial,
          msg: isTrial ? '官方返回试听片段' : '官方原声音源',
        };
        return { result };
      }
    }
    return { result: null, errorCode: res?.error_code, errorMsg: res?.error_msg };
  } catch (err) {
    console.warn('[resolveKugouAudioUrl] 音源解析异常:', err);
  }

  return { result: null };
}

/**
 * 主轨：根据歌曲 Hash 获取酷狗官方音频流
 */
export async function fetchPrimaryOfficialAudio(
  song: KuGouSong,
  settings: UserSettings
): Promise<AudioSourceResult | null> {
  const attempts: Array<number | string> = [128, 128, '128'];
  let lastFailure: TrackerAttempt | null = null;

  for (const quality of attempts) {
    const attempt = await resolveKugouAudioUrl(song, settings, quality);
    if (attempt.result) return attempt.result;
    lastFailure = attempt;
  }

  if (lastFailure?.errorCode) {
    console.warn(
      `[fetchPrimaryOfficialAudio] 官方音源未授权/未获取成功: ${lastFailure.errorCode} ${lastFailure.errorMsg || ''}`
    );
  }
  return null;
}

/**
 * 备轨：免登录 Fallback 音源引擎
 * 当主轨无权限、未配置或仅为试听片段时触发
 * 策略：使用 songName + singerName 检索公开替代曲目，匹配 duration 误差在 ±3 秒内
 */
export async function fetchFallbackAudio(
  song: KuGouSong,
  settings: UserSettings
): Promise<AudioSourceResult | null> {
  const cleanSongName = song.songName.trim();
  const cleanSinger = song.singerName.trim();
  const targetDuration = song.duration;

  // 1. 若配置了自定义 Fallback 聚合 API，优先使用
  if (settings.customFallbackApi) {
    try {
      const customApiUrl = settings.customFallbackApi
        .replace('{name}', encodeURIComponent(cleanSongName))
        .replace('{artist}', encodeURIComponent(cleanSinger))
        .replace('{hash}', song.hash);

      const res = await httpGet<{ url?: string; duration?: number }>(customApiUrl);
      if (res && res.url) {
        return {
          url: res.url,
          source: 'fallback',
          duration: res.duration || targetDuration,
          isTrial: false,
          msg: '自定义备轨音源',
        };
      }
    } catch (e) {
      console.warn('[fetchFallbackAudio] 自定义备用 API 请求失败:', e);
    }
  }

  // 2. 酷狗公共无限制同款曲目搜索重解析 (通过免费版本 Hash 绕过 VIP 限制)
  try {
    const searchUrl = 'http://songsearch.kugou.com/song_search_v2';
    interface SearchResponse {
      status: number;
      data?: {
        lists?: Array<{
          FileHash: string;
          SQFileHash?: string;
          HQFileHash?: string;
          FileName: string;
          SongName: string;
          SingerName: string;
          Duration: number;
          Bitrate?: number;
          Privilege?: number;
          AlbumID?: string | number;
          MixSongID?: string | number;
          ID?: string | number;
        }>;
      };
    }

    const searchRes = await httpGet<SearchResponse>(searchUrl, {
      keyword: `${cleanSongName} ${cleanSinger}`,
      page: 1,
      pagesize: 12,
      platform: 'WebFilter',
    });

    if (searchRes && searchRes.status === 1 && searchRes.data?.lists) {
      // 筛选与目标曲目时长在 ±3 秒以内的曲目，优先选择免费无限制 (Privilege != 10) 的候选项
      const candidates = searchRes.data.lists.filter((item) => {
        const itemDuration = item.Duration || 0;
        const diff = Math.abs(itemDuration - targetDuration);
        return diff <= 3 || targetDuration <= 0;
      });

      for (const candidate of candidates.slice(0, 5)) {
        const candidateHash = (candidate.HQFileHash || candidate.FileHash || '').toLowerCase();
        if (!candidateHash || candidateHash === song.hash.toLowerCase()) {
          continue; // 跳过原收费 Hash
        }

        // 复用统一音源解析器（旧实现走废弃的 /i/v2/ 且缺 mid，固定失败）
        const resolved = (await resolveKugouAudioUrl(
          {
            hash: candidateHash,
            songName: cleanSongName,
            singerName: cleanSinger,
            albumId: String(candidate.AlbumID || ''),
            duration: candidate.Duration || 0,
            coverUrl: '',
            mixSongId: String(candidate.MixSongID || candidate.ID || ''),
          },
          settings,
          128
        )).result;

        if (resolved && resolved.duration > 60) {
          return {
            ...resolved,
            source: 'fallback',
            isTrial: false,
            msg: '备轨：已自动匹配同款完整免费曲目',
          };
        }
      }
    }
  } catch (err) {
    console.warn('[fetchFallbackAudio] 酷狗公共库备选检索异常:', err);
  }

  // 3. 兜底方案：公共免鉴权 Meting / 网易公开音源镜像
  try {
    const publicMirrorUrl = `https://api.injahow.cn/meting/?type=url&id=${encodeURIComponent(
      cleanSongName + ' ' + cleanSinger
    )}`;
    const mirrorRes = await httpGet<{ url?: string; code?: number }>(publicMirrorUrl);
    if (mirrorRes && mirrorRes.url && mirrorRes.url.startsWith('http')) {
      return {
        url: mirrorRes.url,
        source: 'fallback',
        duration: targetDuration,
        isTrial: false,
        msg: '备轨：公共聚合镜像音源',
      };
    }
  } catch {
    // 忽略
  }

  return null;
}

/**
 * 双轨调度主入口
 * 优先主轨，当主轨返回仅 60s 试听、无结果或失败时，自动切换至备轨
 */
export async function resolveAudioSource(song: KuGouSong): Promise<AudioSourceResult> {
  const settings = await getUserSettings();

  // 1. 尝试主轨 (官方源)
  const primaryResult = await fetchPrimaryOfficialAudio(song, settings);

  if (primaryResult && !primaryResult.isTrial) {
    return primaryResult;
  }

  // 2. 主轨为试听片段或获取失败，启动备轨 Fallback
  const fallbackResult = await fetchFallbackAudio(song, settings);

  if (fallbackResult) {
    return fallbackResult;
  }

  // 3. 若备轨仍未找到，但在主轨有试听地址，则降级返回试听地址并提示
  if (primaryResult) {
    return {
      ...primaryResult,
      msg: `${describeMissingVipPermission(song, settings)}；当前降级为试听片段。`,
    };
  }

  throw new Error(
    hasCredentials(settings)
      ? describeMissingVipPermission(song, settings)
      : `暂未找到歌曲《${song.songName}》的可用音频播放源`
  );
}
