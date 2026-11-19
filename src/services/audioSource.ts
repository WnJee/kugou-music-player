/**
 * 双轨音源播放引擎 (src/services/audioSource.ts)
 * 1. 主轨：结合酷狗概念版 Token 与 UserID 提取官方完整音源，支持概念版每日签到领 VIP
 * 2. 备轨：免登录 / 试听兜底，使用 songName + singerName 检索公开音源（时长匹配误差 ±3 秒内）
 */

import type { AudioSourceResult, KuGouSong, UserSettings } from '../types/music';
import { toSecureImageUrl } from '../utils/url';
import { readStoreValue, writeStoreValue } from '../utils/store';
import { todayLocalDate } from '../utils/date';
import { isHttpUrl, verifyPlayableAudioUrl } from '../utils/audioUrl';
import { httpGet, httpPost, KUGOU_GATEWAY_UA } from './http';
import { getDeviceMid } from './device';
import {
  gatewayClientverFor,
  otherPlatform,
  platformOfAppId,
  PLATFORM_STANDARD,
  signWithSalt,
  trackerKey,
  type GatewayPlatform,
} from './kugouConst';
import {
  audioQualityChain,
  audioQualityOption,
  DEFAULT_AUDIO_QUALITY,
  qualityOfParam,
} from './audioQuality';

const SETTINGS_STORE_FILE = 'kugou_settings.json';
const SETTINGS_KEY = 'user_settings';

/**
 * 单次音源解析的总时长预算：超预算直接进入备轨，
 * 避免「平台重试 × 多档位降档」串行把首播拖到十几秒（H5）。
 */
const PRIMARY_RESOLVE_BUDGET_MS = 10000;
/** 备轨总预算：候选项最多 5 个串行，必须共享一份预算，否则最坏情况要卡一分钟 */
const FALLBACK_RESOLVE_BUDGET_MS = 8000;

const DEFAULT_SETTINGS: UserSettings = {
  kugouToken: '',
  kugouUserId: '',
  lastCheckinDate: '',
  customFallbackApi: '',
  audioQuality: DEFAULT_AUDIO_QUALITY,
  audioEffect: 'off',
};

/**
 * 读取用户本地设置
 */
export async function getUserSettings(): Promise<UserSettings> {
  const value = await readStoreValue<Partial<UserSettings> | null>(
    SETTINGS_STORE_FILE,
    SETTINGS_KEY,
    null
  );
  return { ...DEFAULT_SETTINGS, ...value };
}

/**
 * 保存用户本地设置
 */
export async function saveUserSettings(settings: Partial<UserSettings>): Promise<UserSettings> {
  const current = await getUserSettings();
  const updated: UserSettings = { ...current, ...settings };
  await writeStoreValue(SETTINGS_STORE_FILE, SETTINGS_KEY, updated);
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

async function fetchUserProfileWith(
  token: string,
  userid: string,
  platform: GatewayPlatform
): Promise<{ nickname: string; avatar: string } | null> {
  try {
    const mid = await getDeviceMid();
    const timestamp = Math.floor(Date.now() / 1000);
    const params: Record<string, string | number> = {
      dfid: '-',
      mid,
      uuid: '-',
      appid: platform.appid,
      clientver: gatewayClientverFor(platform),
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
    const signature = signWithSalt(platform.signatureSalt, params, bodyStr);
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
        avatar: toSecureImageUrl(res.data.pic),
      };
    }
    return null;
  } catch (err) {
    console.warn('[fetchUserProfile] 拉取用户资料失败:', err);
    return null;
  }
}

/**
 * 拉取酷狗用户资料（昵称/头像），自动适配登录平台并在失败时切换平台重试
 */
export async function fetchUserProfile(
  token: string,
  userid: string
): Promise<{ nickname: string; avatar: string } | null> {
  if (!token || !userid) return null;

  const settings = await getUserSettings();
  const primary = platformOfAppId(settings.kugouAppId);
  const profile = await fetchUserProfileWith(token, userid, primary);
  if (profile) return profile;
  return fetchUserProfileWith(token, userid, otherPlatform(primary));
}

/** 保活结果：区分网络异常与登录态失效，供调用方给出不同提示（L11） */
export interface KeepAliveResult {
  ok: boolean;
  /** 失败原因：network = 网络/服务不可达；auth = token 失效；server = 服务端异常 */
  reason?: 'network' | 'auth' | 'server';
}

/** VIP 状态探测结果（内部用，把失败原因一路带出去） */
type VipProbe =
  | { ok: true; isVip: boolean; vipEndTime: string }
  | { ok: false; reason: 'network' | 'auth' | 'server' };

/**
 * 查询概念版 VIP 实时状态（kugouvip 网关，与签到查询同接口）
 * 从 busi_vip 数组中取 busi_type === 'concept' 的条目判断是否有效会员
 */
async function probeConceptVipWith(
  token: string,
  userid: string,
  platform: GatewayPlatform
): Promise<VipProbe> {
  try {
    const mid = await getDeviceMid();
    const timestamp = Math.floor(Date.now() / 1000);
    const params: Record<string, string | number> = {
      dfid: '-',
      mid,
      uuid: '-',
      appid: platform.appid,
      clientver: gatewayClientverFor(platform),
      userid: Number(userid),
      clienttime: timestamp,
      token,
      busi_type: 'concept',
    };
    const signature = signWithSalt(platform.signatureSalt, params, '');
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

    if (res?.status !== 1) return { ok: false, reason: 'auth' };
    if (!res.data) return { ok: false, reason: 'server' };

    // 优先取概念版条目；busi_vip 为空时回退顶层 is_vip
    const concept = res.data.busi_vip?.find((v) => v.busi_type === 'concept' && v.is_vip === 1);
    if (concept?.vip_end_time) {
      return { ok: true, isVip: true, vipEndTime: concept.vip_end_time };
    }
    return { ok: true, isVip: res.data.is_vip === 1, vipEndTime: '' };
  } catch (err) {
    console.warn('[fetchConceptVipStatus] 查询 VIP 状态失败:', err);
    return { ok: false, reason: 'network' };
  }
}

/**
 * 按登录平台探测 VIP 状态：主平台失败时换另一平台再试一次。
 * 两次都失败时返回首次的失败原因（主平台才是用户实际登录的平台）。
 */
async function probeConceptVip(token: string, userid: string): Promise<VipProbe> {
  const settings = await getUserSettings();
  const primary = platformOfAppId(settings.kugouAppId);
  const first = await probeConceptVipWith(token, userid, primary);
  if (first.ok) return first;
  const second = await probeConceptVipWith(token, userid, otherPlatform(primary));
  return second.ok ? second : first;
}

/**
 * 查询概念版 VIP 实时状态，自动适配登录平台并在失败时切换平台重试
 */
export async function fetchConceptVipStatus(
  token: string,
  userid: string
): Promise<{ isVip: boolean; vipEndTime: string } | null> {
  if (!token || !userid) return null;

  const probe = await probeConceptVip(token, userid);
  return probe.ok ? { isVip: probe.isVip, vipEndTime: probe.vipEndTime } : null;
}

/**
 * Token 保活（结构化结果）：轻量携带登录态的网关请求。
 * 酷狗登录态在长期无请求后会失效，定期活跃可尽量延长 token 有效期。
 */
export async function keepTokenAliveDetailed(
  token: string,
  userid: string
): Promise<KeepAliveResult> {
  if (!token || !userid) return { ok: false, reason: 'auth' };
  const probe = await probeConceptVip(token, userid);
  return probe.ok ? { ok: true } : { ok: false, reason: probe.reason };
}

/**
 * Token 保活（布尔封装，保持既有调用方兼容）
 */
export async function keepTokenAlive(token: string, userid: string): Promise<boolean> {
  return (await keepTokenAliveDetailed(token, userid)).ok;
}

/** 签到进度回调：向 UI 实时播报签到进展 */
export type CheckinProgressHandler = (message: string) => void;

/** 签到结果：success + 可直接展示给用户的提示文案 */
export interface CheckinResult {
  success: boolean;
  message: string;
}

/**
 * 酷狗概念版签到（单平台）
 *
 * 说明：概念版领取会员时长的接口只有「听歌上报」与「广告播放上报」两类，
 * 都要求真实播放行为参与；用固定歌曲 id / 定时伪造上报属于刷接口，会被风控，
 * 因此这些伪造实现已移除。此处只做真实的账号权益查询：
 *   1. 校验登录态并查询概念版会员到期时间；
 *   2. 记录本地签到日期（本地时区，避免东八区 0-8 点算成前一天）。
 */
async function performCheckinWith(
  token: string,
  userid: string,
  platform: GatewayPlatform,
  onProgress?: CheckinProgressHandler
): Promise<CheckinResult> {
  if (!token || !userid) {
    return { success: false, message: '未配置 Token 或 UserID' };
  }

  onProgress?.('正在校验登录态…');
  try {
    const probe = await probeConceptVipWith(token, userid, platform);
    if (!probe.ok) {
      return {
        success: false,
        message:
          probe.reason === 'auth'
            ? '登录态已失效，请在设置中重新扫码授权'
            : '签到服务暂不可用，请稍后重试',
      };
    }

    onProgress?.('正在确认会员权益…');
    if (!probe.isVip || !probe.vipEndTime) {
      return {
        success: false,
        message: '当前账号无有效概念版会员权益，请在酷狗概念版客户端完成每日领取后再试',
      };
    }

    await saveUserSettings({ lastCheckinDate: todayLocalDate() });
    return { success: true, message: `权益有效，到期时间 ${probe.vipEndTime}（已记录今日打卡）` };
  } catch (err) {
    console.warn('[checkinConceptVip] 签到失败:', err);
    return { success: false, message: err instanceof Error ? err.message : '签到网络异常' };
  }
}

/**
 * 手动签到入口（设置页「立即打卡」触发），主平台失败时切换另一平台再试一次
 */
export async function checkinConceptVip(
  token: string,
  userid: string,
  onProgress?: CheckinProgressHandler
): Promise<{ success: boolean; message: string }> {
  if (!token || !userid) {
    return { success: false, message: '未配置 Token 或 UserID' };
  }

  const settings = await getUserSettings();
  const primary = platformOfAppId(settings.kugouAppId);
  const first = await performCheckinWith(token, userid, primary, onProgress);
  if (first.success) return first;

  onProgress?.('切换备用平台重试…');
  const second = await performCheckinWith(token, userid, otherPlatform(primary), onProgress);
  return second.success ? second : first;
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
  if ((settings.kugouAppId || 1005) !== 3116) {
    // 旧版标准版平台 token：概念版 VIP 鉴权不生效，需重新扫码授权
    return `《${song.songName}》为 VIP 专享，当前登录的是酷狗标准版平台，请在设置中重新扫码授权概念版账号`;
  }
  return `《${song.songName}》官方音源无完整播放权限，请确认概念版 VIP 生效且账号未被限制`;
}

/**
 * 按指定平台请求酷狗网关 trackercdn /v5/url
 */
async function requestTrackerUrl(
  song: KuGouSong,
  settings: UserSettings,
  quality: number | string,
  platform: GatewayPlatform,
  deadline?: number
): Promise<TrackerAttempt> {
  const hash = (song.hash || '').toLowerCase();
  if (!hash) return { result: null };

  // 解析预算耗尽时立即放弃，交给备轨
  const remaining = deadline ? deadline - Date.now() : PRIMARY_RESOLVE_BUDGET_MS;
  if (remaining <= 0) return { result: null, errorMsg: '音源解析超出时长预算' };

  const mid = await getDeviceMid();
  const userid = settings.kugouUserId || '0';
  const clienttime = Math.floor(Date.now() / 1000);

  const params: Record<string, string | number> = {
    dfid: '-',
    mid,
    uuid: '-',
    appid: platform.appid,
    clientver: platform.clientver,
    clienttime,
    token: settings.kugouToken || '',
    userid: Number(userid) || 0,
    album_id: Number(song.albumId || 0),
    area_code: 1,
    hash,
    ssa_flag: 'is_fromtrack',
    version: platform.clientver,
    page_id: platform.pageId,
    quality,
    album_audio_id: Number(song.mixSongId || 0),
    behavior: 'play',
    pid: platform.pid,
    cmd: 26,
    pidversion: 3001,
    IsFreePart: 0,
    ppage_id: platform.ppid,
    cdnBackup: 1,
    module: '',
    key: trackerKey(hash, platform, mid, userid),
  };
  params.signature = signWithSalt(platform.signatureSalt, params);

  try {
    const res = await httpGet<TrackerV5Response>('https://gateway.kugou.com/v5/url', params, {
      timeout: remaining,
      headers: {
        'User-Agent': KUGOU_GATEWAY_UA,
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
    console.warn('[requestTrackerUrl] 音源解析异常:', err);
  }

  return { result: null };
}

/**
 * 统一音源解析器：走酷狗网关 trackercdn /v5/url
 *
 * 优先使用登录平台参数（token 与 appid 同平台，VIP 鉴权才会生效）；
 * 若返回 error_code 20018（token 与 appid 平台不匹配，如旧版标准版 token），
 * 自动用另一平台参数重试一次。
 */
export async function resolveKugouAudioUrl(
  song: KuGouSong,
  settings: UserSettings,
  quality: number | string = 128,
  deadline?: number
): Promise<TrackerAttempt> {
  const primary = hasCredentials(settings)
    ? platformOfAppId(settings.kugouAppId)
    : PLATFORM_STANDARD;
  const attempt = await requestTrackerUrl(song, settings, quality, primary, deadline);
  if (attempt.result || attempt.errorCode !== 20018) {
    return attempt;
  }
  console.info('[resolveKugouAudioUrl] token 与登录平台不匹配 (20018)，切换平台重试');
  return requestTrackerUrl(song, settings, quality, otherPlatform(primary), deadline);
}

/**
 * 主轨：根据歌曲 Hash 获取酷狗官方音频流
 *
 * 按用户音质档位请求，授权不足时沿请求链降档重试。试听片段不算成功：
 * 先继续往下找完整码流，整条链都只有试听才把第一段试听交回去。
 */
export async function fetchPrimaryOfficialAudio(
  song: KuGouSong,
  settings: UserSettings
): Promise<AudioSourceResult | null> {
  const requested = audioQualityOption(settings.audioQuality).id;
  const attempts = audioQualityChain(settings.audioQuality);
  const deadline = Date.now() + PRIMARY_RESOLVE_BUDGET_MS;
  let lastFailure: TrackerAttempt | null = null;
  let trial: AudioSourceResult | null = null;

  for (const quality of attempts) {
    // 预算耗尽：不再串行降档，直接把已有结果（试听/失败）交给上层走备轨
    if (Date.now() >= deadline) {
      console.warn('[fetchPrimaryOfficialAudio] 音源解析超出时长预算，转备轨');
      break;
    }
    const attempt = await resolveKugouAudioUrl(song, settings, quality, deadline);
    if (attempt.result) {
      const result: AudioSourceResult = {
        ...attempt.result,
        quality: qualityOfParam(quality),
        requestedQuality: requested,
      };
      if (!result.isTrial) return result;
      if (!trial) trial = result;
      continue;
    }
    lastFailure = attempt;
  }

  if (lastFailure?.errorCode) {
    console.warn(
      `[fetchPrimaryOfficialAudio] 官方音源未授权/未获取成功: ${lastFailure.errorCode} ${lastFailure.errorMsg || ''}`
    );
  }
  return trial;
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
  const requestedQuality = audioQualityOption(settings.audioQuality).id;
  const deadline = Date.now() + FALLBACK_RESOLVE_BUDGET_MS;

  // 1. 若配置了自定义 Fallback 聚合 API，优先使用
  if (settings.customFallbackApi) {
    try {
      const customApiUrl = settings.customFallbackApi
        .replace('{name}', encodeURIComponent(cleanSongName))
        .replace('{artist}', encodeURIComponent(cleanSinger))
        .replace('{hash}', song.hash);

      const res = await httpGet<{ url?: string; duration?: number }>(customApiUrl);
      if (res?.url && isHttpUrl(res.url)) {
        return {
          url: res.url,
          source: 'fallback',
          duration: res.duration || targetDuration,
          isTrial: false,
          quality: '128',
          requestedQuality,
          msg: '自定义备轨音源',
        };
      }
    } catch (e) {
      console.warn('[fetchFallbackAudio] 自定义备用 API 请求失败:', e);
    }
  }

  // 2. 酷狗公共无限制同款曲目搜索重解析 (通过免费版本 Hash 绕过 VIP 限制)
  try {
    const searchUrl = 'https://songsearch.kugou.com/song_search_v2';
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
      // 时长必须在 ±3 秒内；目标时长或候选时长未知时只接受标题完全一致的候选，
      // 避免「未知时长」涋过弱匹配播错歌（M13）
      const candidates = searchRes.data.lists.filter((item) => {
        const itemDuration = item.Duration || 0;
        if (targetDuration <= 0 || itemDuration <= 0) {
          return (item.SongName || '').trim() === cleanSongName;
        }
        return Math.abs(itemDuration - targetDuration) <= 3;
      });

      for (const candidate of candidates.slice(0, 5)) {
        // 预算耗尽就别再串行试下一个候选了，直接交给上层走试听降级
        if (Date.now() >= deadline) {
          console.warn('[fetchFallbackAudio] 备轨解析超出时长预算，停止继续尝试');
          break;
        }
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
          128,
          deadline
        )).result;

        if (resolved && resolved.duration > 60) {
          return {
            ...resolved,
            source: 'fallback',
            isTrial: false,
            quality: '128',
            requestedQuality,
            msg: '备轨：已自动匹配同款完整免费曲目',
          };
        }
      }
    }
  } catch (err) {
    console.warn('[fetchFallbackAudio] 酷狗公共库备选检索异常:', err);
  }

  // 3. 兜底方案：公共免鉴权 Meting 公开音源镜像
  try {
    const publicMirrorUrl = `https://api.injahow.cn/meting/?type=url&id=${encodeURIComponent(
      cleanSongName + ' ' + cleanSinger
    )}`;
    const mirrorRes = await httpGet<{ url?: string; code?: number }>(publicMirrorUrl);
    // 第三方返回的地址不可信：scheme 必须合法且能确认是音频资源才使用
    if (mirrorRes?.url && (await verifyPlayableAudioUrl(mirrorRes.url))) {
      return {
        url: mirrorRes.url,
        source: 'fallback',
        duration: targetDuration,
        isTrial: false,
        quality: '128',
        requestedQuality,
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
