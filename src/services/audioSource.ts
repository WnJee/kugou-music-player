/**
 * 双轨音源播放引擎 (src/services/audioSource.ts)
 * 1. 主轨：结合酷狗概念版 Token 与 UserID 提取官方完整音源，支持概念版每日签到领 VIP
 * 2. 备轨：免登录 / 试听兜底，使用 songName + singerName 检索公开音源（时长匹配误差 ±3 秒内）
 */

import { Store } from '@tauri-apps/plugin-store';
import type { AudioSourceResult, KuGouSong, UserSettings } from '../types/music';
import { md5 } from '../utils/md5';
import { httpGet, httpPost } from './http';

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
 * 酷狗概念版每日签到领取 VIP 接口
 */
export async function checkinConceptVip(token: string, userid: string): Promise<{ success: boolean; message: string }> {
  if (!token || !userid) {
    return { success: false, message: '未配置 Token 或 UserID' };
  }

  try {
    // 调用酷狗青年福利 / 概念版签到中心任务上报接口
    const checkinUrl = 'https://gateway.kugou.com/youth/v1/record/listen';
    const timestamp = Math.floor(Date.now() / 1000);

    const res = await httpPost<{ status: number; error_code: number; message?: string; data?: unknown }>(
      checkinUrl,
      {
        token,
        userid: Number(userid),
        clienttime: timestamp,
        appid: 3116, // 概念版专用 appid
        platid: 4,
      },
      {
        headers: {
          'x-router': 'youth.kugou.com',
          token,
          userid,
        },
      }
    );

    const todayStr = new Date().toISOString().split('T')[0];
    await saveUserSettings({ lastCheckinDate: todayStr });

    if (res && (res.status === 1 || res.error_code === 0)) {
      return { success: true, message: '概念版 VIP 签到成功！已领取会员福利。' };
    }
    return {
      success: true,
      message: res?.message || '签到请求已发送 (今日可能已完成打卡)。',
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
  await checkinConceptVip(settings.kugouToken, settings.kugouUserId);
}

/**
 * 主轨：根据歌曲 Hash 获取酷狗官方音频流
 */
export async function fetchPrimaryOfficialAudio(
  song: KuGouSong,
  settings: UserSettings
): Promise<AudioSourceResult | null> {
  const hash = song.hash.toLowerCase();
  const key = md5(`${hash}kgcloudv2`);

  // 1. 调用 TrackerCDN 官方流媒体分发 API
  const trackerUrl = 'http://trackercdn.kugou.com/i/v2/';
  interface TrackerResponse {
    status: number;
    url?: string[];
    timeLength?: number;
    fileSize?: number;
    bitRate?: number;
    error?: string;
  }

  try {
    const res = await httpGet<TrackerResponse>(trackerUrl, {
      cmd: 26,
      hash,
      key,
      pid: 2,
      behavior: 'play',
      appid: 1005,
      version: 9108,
      token: settings.kugouToken || '',
      userid: settings.kugouUserId || '0',
      vipType: settings.kugouToken ? 6 : 0,
    });

    if (res && res.status === 1 && res.url && res.url.length > 0) {
      const audioUrl = res.url[0];
      const duration = res.timeLength || song.duration || 0;
      // 酷狗试听曲目通常时长限制在 60 秒以下或原曲显著短于应有时长
      const isTrial = duration <= 60 && song.duration > 75;

      return {
        url: audioUrl,
        source: 'primary',
        bitrate: res.bitRate ? Math.round(res.bitRate / 1000) : 128,
        duration,
        isTrial,
        msg: isTrial ? '官方返回 60s 试听片段' : '官方原声音源',
      };
    }
  } catch (err) {
    console.warn('[fetchPrimaryOfficialAudio] 主轨请求异常:', err);
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

      for (const candidate of candidates) {
        const candidateHash = candidate.HQFileHash || candidate.FileHash;
        if (!candidateHash || candidateHash.toLowerCase() === song.hash.toLowerCase()) {
          continue; // 跳过原收费 Hash
        }

        const candKey = md5(`${candidateHash.toLowerCase()}kgcloudv2`);
        interface CandTrackerResponse {
          status: number;
          url?: string[];
          timeLength?: number;
        }

        try {
          const candRes = await httpGet<CandTrackerResponse>('http://trackercdn.kugou.com/i/v2/', {
            cmd: 26,
            hash: candidateHash.toLowerCase(),
            key: candKey,
            pid: 2,
            behavior: 'play',
            appid: 1005,
            version: 9108,
            token: '',
            userid: '0',
          });

          if (candRes && candRes.status === 1 && candRes.url && candRes.url.length > 0) {
            const fullDuration = candRes.timeLength || candidate.Duration;
            if (fullDuration > 60) {
              return {
                url: candRes.url[0],
                source: 'fallback',
                duration: fullDuration,
                isTrial: false,
                msg: '备轨：已自动匹配同款完整免费曲目',
              };
            }
          }
        } catch {
          // 继续尝试下一个候选
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
      msg: '该歌曲为酷狗 VIP 专享，未匹配到完整替代音源，当前为试听片段。可在设置中配置概念版 Token 开启完整播放。',
    };
  }

  throw new Error(`暂未找到歌曲《${song.songName}》的可用音频播放源`);
}
