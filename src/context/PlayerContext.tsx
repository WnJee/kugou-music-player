/**
 * 全局播放器状态管理上下文 (src/context/PlayerContext.tsx)
 */

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type {
  AudioEffectId,
  AudioQuality,
  AudioSourceResult,
  KuGouPlaylist,
  KuGouSong,
  LyricLine,
  PlayMode,
  UserSettings,
} from '../types/music';
import {
  fetchConceptVipStatus,
  getUserSettings,
  resolveAudioSource,
  saveUserSettings,
  tryAutoCheckin,
  keepTokenAlive,
} from '../services/audioSource';
import { AudioEffectChain, audioEffectPreset, checkAudioCors } from '../services/audioEffects';
import { DEFAULT_AUDIO_QUALITY, audioQualityOption } from '../services/audioQuality';
import {
  deleteLocalPlaylist,
  getLocalPlaylists,
  saveAllPlaylistsToStorage,
  fetchUserCloudPlaylists,
  fetchUserCloudPlaylistTracks,
  addSongToUserCloudPlaylist,
  removeSongFromUserCloudPlaylist,
} from '../services/kugouPlaylist';
import { fetchSongLyrics } from '../services/lyrics';
import { Store } from '@tauri-apps/plugin-store';

interface PlayerContextType {
  // 用户设置与登录态
  userSettings: UserSettings | null;
  refreshUserSettings: () => Promise<void>;
  /** 概念版 VIP 实时状态（null = 未登录或查询失败） */
  vipStatus: { isVip: boolean; vipEndTime: string } | null;
  refreshVipStatus: () => Promise<void>;
  // 歌单状态
  playlists: KuGouPlaylist[];
  activePlaylist: KuGouPlaylist | null;
  selectPlaylist: (playlist: KuGouPlaylist) => Promise<void>;
  deletePlaylistById: (id: string) => Promise<void>;
  refreshPlaylists: () => Promise<void>;
  isSyncingCloud: boolean;
  syncCloudPlaylists: (force?: boolean) => Promise<void>;
  /** 云端歌单同步失败原因（null 表示无错误） */
  cloudSyncError: string | null;
  addSongToPlaylist: (
    song: KuGouSong,
    playlistId: string
  ) => Promise<{ success: boolean; message: string }>;
  removeSongFromPlaylist: (
    song: KuGouSong,
    playlistId: string
  ) => Promise<{ success: boolean; message: string }>;

  // 播放状态
  currentSong: KuGouSong | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  playMode: PlayMode;
  isLoadingAudio: boolean;
  audioSourceInfo: AudioSourceResult | null;
  errorMsg: string | null;
  /** 当前音质档位（切换后立即用新档位重解析当前曲目） */
  audioQuality: AudioQuality;
  setAudioQuality: (quality: AudioQuality) => void;
  /** 当前音效档位 */
  audioEffect: AudioEffectId;
  setAudioEffect: (effect: AudioEffectId) => void;
  /** 当前音源没有放行跨域，音效无法接入音频图 */
  effectBlocked: boolean;
  /** 独立播放队列（与歌单解耦，仅「播放全部」或手动清空时刷新） */
  queueSongs: KuGouSong[];
  clearQueue: () => Promise<void>;

  // 歌词状态
  lyrics: LyricLine[];
  activeLyricIndex: number;

  // 控制动作
  playSong: (song: KuGouSong, opts?: { insertFront?: boolean }) => Promise<void>;
  /** 播放全部：清空并重建独立播放队列，从第一首开始播放 */
  playAll: (songs: KuGouSong[]) => Promise<void>;
  togglePlay: () => void;
  nextSong: () => void;
  prevSong: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  cyclePlayMode: () => void;
}

const PlayerContext = createContext<PlayerContextType | null>(null);

function sameSong(a: KuGouSong | null | undefined, b: KuGouSong | null | undefined): boolean {
  return Boolean(a && b && a.hash && a.hash === b.hash);
}

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [playlists, setPlaylists] = useState<KuGouPlaylist[]>([]);
  // 概念版 VIP 实时状态（用于界面打标，验证打卡是否真实到账）
  const [vipStatus, setVipStatus] = useState<{ isVip: boolean; vipEndTime: string } | null>(null);
  const [activePlaylist, setActivePlaylist] = useState<KuGouPlaylist | null>(null);
  // 独立播放队列：与歌单解耦。仅「播放全部」重建、手动清空清空、
  // 单曲播放按需插入（搜索结果插最前，其余追加末尾）。切换歌单不影响队列。
  const [queue, setQueue] = useState<KuGouSong[]>([]);

  const [currentSong, setCurrentSong] = useState<KuGouSong | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [volume, setVolumeState] = useState<number>(0.8);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playMode, setPlayMode] = useState<PlayMode>('sequence');
  const [isLoadingAudio, setIsLoadingAudio] = useState<boolean>(false);
  const [audioSourceInfo, setAudioSourceInfo] = useState<AudioSourceResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [audioQuality, setAudioQualityState] = useState<AudioQuality>(DEFAULT_AUDIO_QUALITY);
  const [audioEffect, setAudioEffectState] = useState<AudioEffectId>('off');
  const [effectBlocked, setEffectBlocked] = useState<boolean>(false);

  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [activeLyricIndex, setActiveLyricIndex] = useState<number>(-1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playRequestIdRef = useRef(0);
  // 恢复上次播放进度时暂存的目标位置，待音频元数据加载完成后定位
  const pendingSeekRef = useRef<number | null>(null);
  // 音源异常后自动跳过的触发口：改由下面的 effect 绑定，避免与 nextSong 的声明顺序互相牵扯
  const skipBrokenRef = useRef<(reason: unknown) => void>(() => {});
  // 媒体元素的事件监听只在建元素时绑一次，用 ref 读最新值
  const nextSongRef = useRef<() => void>(() => {});
  const playModeRef = useRef<PlayMode>('sequence');
  const volumeRef = useRef<number>(0.8);
  const isMutedRef = useRef<boolean>(false);
  // 音效处理链：绑定到某个 <audio> 后无法迁移，换元素时必须一并丢弃
  const effectChainRef = useRef<AudioEffectChain | null>(null);
  // 解析音源、挂音效这些异步流程里要读最新档位，不能等下一次渲染
  const audioQualityRef = useRef<AudioQuality>(DEFAULT_AUDIO_QUALITY);
  const audioEffectRef = useRef<AudioEffectId>('off');

  audioQualityRef.current = audioQuality;
  audioEffectRef.current = audioEffect;
  volumeRef.current = volume;
  isMutedRef.current = isMuted;
  playModeRef.current = playMode;

  /**
   * 媒体元素工厂
   * 音效要把元素接进 Web Audio，而 MediaElementSource 一旦建立就无法解绑：
   * 遇到不支持 CORS 的音源只能整个换掉 <audio>，所以创建与事件绑定必须可重复执行。
   */
  const createMediaElement = useCallback((): HTMLAudioElement => {
    const audio = new Audio();
    audio.volume = isMutedRef.current ? 0 : volumeRef.current;

    audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime));
    audio.addEventListener('durationchange', () => {
      if (audio.duration && !isNaN(audio.duration)) setDuration(audio.duration);
    });
    audio.addEventListener('play', () => setIsPlaying(true));
    audio.addEventListener('pause', () => setIsPlaying(false));
    audio.addEventListener('waiting', () => setIsLoadingAudio(true));
    audio.addEventListener('playing', () => setIsLoadingAudio(false));
    // 地址解析成功但流本身不可用（404 / 换源 / 解码失败）时 media 元素只抛 error，不会自己往下走
    audio.addEventListener('error', () => {
      if (!audio.src) return;
      const code = audio.error?.code;
      setErrorMsg(audio.error?.message || `音源错误${code ? ` (${code})` : ''}`);
      setIsPlaying(false);
      setIsLoadingAudio(false);
      skipBrokenRef.current(audio.error ?? 'media error');
    });
    // 恢复上次播放进度：待元数据加载完成后定位
    audio.addEventListener('loadedmetadata', () => {
      if (pendingSeekRef.current == null) return;
      const target = pendingSeekRef.current;
      pendingSeekRef.current = null;
      if (isFinite(audio.duration) && target < audio.duration) {
        audio.currentTime = target;
        setCurrentTime(target);
      }
    });
    audio.addEventListener('ended', () => {
      if (playModeRef.current === 'single') {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } else {
        nextSongRef.current();
      }
    });

    return audio;
  }, []);

  // 初始化 Audio 实例
  useEffect(() => {
    const audio = createMediaElement();
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.removeAttribute('src');
      effectChainRef.current?.dispose();
      effectChainRef.current = null;
    };
  }, [createMediaElement]);

  /** 用全新的媒体元素顶替当前元素，保留曲目与进度（MediaElementSource 无法解绑时的唯一出路） */
  const swapMediaElement = useCallback(
    (crossOrigin: boolean): HTMLAudioElement => {
      const prev = audioRef.current;
      const src = prev?.src ?? '';
      const at = prev?.currentTime ?? 0;
      const wasPlaying = prev ? !prev.paused : false;

      const next = createMediaElement();
      next.crossOrigin = crossOrigin ? 'anonymous' : null;
      audioRef.current = next;

      effectChainRef.current?.dispose();
      effectChainRef.current = null;

      prev?.pause();
      prev?.removeAttribute('src');

      if (src) {
        if (at > 0) pendingSeekRef.current = at;
        next.src = src;
        if (wasPlaying) next.play().catch(() => {});
      }
      return next;
    },
    [createMediaElement]
  );

  // ===== 记忆播放状态：音量 / 播放模式 / 上次播放的歌单、歌曲与进度 =====
  const PLAYBACK_STORE_FILE = 'kugou_playback.json';

  interface PersistedPlayback {
    volume?: number;
    playMode?: PlayMode;
    playlistId?: string | null;
    song?: KuGouSong | null;
    position?: number;
    /** 独立播放队列（重启后恢复） */
    queue?: KuGouSong[] | null;
  }

  const savePlaybackPrefs = useCallback(
    async (patch: PersistedPlayback) => {
      try {
        if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
        const store = await Store.load(PLAYBACK_STORE_FILE);
        const prev = (await store.get<PersistedPlayback>('last')) || {};
        await store.set('last', { ...prev, ...patch, savedAt: Date.now() });
        await store.save();
      } catch (e) {
        console.warn('[PlaybackStore] 保存播放状态失败:', e);
      }
    },
    []
  );

  // 启动时恢复上次播放状态（不自动播放，仅定位到上次进度）
  const restorePlayback = useCallback(async () => {
    try {
      if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
      const store = await Store.load(PLAYBACK_STORE_FILE);
      const saved = await store.get<PersistedPlayback>('last');
      if (!saved) return;

      if (typeof saved.volume === 'number' && saved.volume > 0) {
        setVolumeState(saved.volume);
        if (audioRef.current) audioRef.current.volume = saved.volume;
      }
      if (saved.playMode) setPlayMode(saved.playMode);

      if (saved.song) {
        setCurrentSong(saved.song);
        if (saved.position && saved.position > 1) {
          pendingSeekRef.current = saved.position;
        }
        if (saved.playlistId) {
          const list = await getLocalPlaylists();
          const pl = list.find((p) => p.id === saved.playlistId);
          if (pl) setActivePlaylist(pl);
        }
      }
      // 恢复独立播放队列
      if (saved.queue && saved.queue.length > 0) {
        setQueue(saved.queue);
      } else if (saved.song) {
        setQueue([saved.song]);
      }
    } catch (e) {
      console.warn('[PlaybackStore] 恢复播放状态失败:', e);
    }
  }, []);

  // 音量 / 播放模式 / 当前歌曲变化时持久化（防抖）
  useEffect(() => {
    const t = setTimeout(() => {
      void savePlaybackPrefs({
        volume,
        playMode,
        playlistId: activePlaylist?.id ?? null,
        song: currentSong,
        queue,
      });
    }, 500);
    return () => clearTimeout(t);
  }, [volume, playMode, activePlaylist, currentSong, queue, savePlaybackPrefs]);
  // 暂停或退出时保存播放进度
  const currentTimeRef = useRef(0);
  currentTimeRef.current = currentTime;
  useEffect(() => {
    const save = () => {
      if (currentSong) void savePlaybackPrefs({ position: currentTimeRef.current });
    };
    if (!isPlaying) save();
    window.addEventListener('beforeunload', save);
    return () => window.removeEventListener('beforeunload', save);
  }, [isPlaying, currentSong, savePlaybackPrefs]);

  const refreshUserSettings = useCallback(async () => {
    const settings = await getUserSettings();
    setUserSettings(settings);
    setAudioQualityState(audioQualityOption(settings.audioQuality).id);
    setAudioEffectState(audioEffectPreset(settings.audioEffect).id);
  }, []);

  // 拉取概念版 VIP 实时状态（设置弹窗打卡后也会调用以刷新标识）
  const refreshVipStatus = useCallback(async () => {
    const settings = await getUserSettings();
    if (!settings.kugouToken || !settings.kugouUserId) {
      setVipStatus(null);
      return;
    }
    const status = await fetchConceptVipStatus(settings.kugouToken, settings.kugouUserId);
    setVipStatus(status);
  }, []);

  const [isSyncingCloud, setIsSyncingCloud] = useState<boolean>(false);
  const [cloudSyncError, setCloudSyncError] = useState<string | null>(null);

  // 防风控：云端同步的并发守卫与最小请求间隔
  const syncInFlightRef = useRef(false);
  const lastSyncAtRef = useRef(0);
  const SYNC_MIN_INTERVAL_MS = 3000;

  // 刷新本地歌单列表
  // 注意：必须用函数式更新读取 activePlaylist。若把 activePlaylist 直接放进依赖，
  // 而 getLocalPlaylists 每次都返回新对象引用，会形成「effect → setActivePlaylist → effect」死循环
  const refreshPlaylists = useCallback(async () => {
    const list = await getLocalPlaylists();
    setPlaylists(list);
    setActivePlaylist((prev) => {
      if (!prev) return list.length > 0 ? list[0] : null;
      return list.find((p) => p.id === prev.id) ?? prev;
    });
  }, []);

  // 同步用户账号下的云端歌单（force=true 供用户手动刷新，可突破最小间隔限制）
  const syncCloudPlaylists = useCallback(async (force = false) => {
    const settings = await getUserSettings();
    if (!settings.kugouToken || !settings.kugouUserId) return;


    // 防风控守卫：进行中的同步不重入；非强制调用受最小间隔限制
    if (syncInFlightRef.current) return;
    const now = Date.now();
    if (!force && now - lastSyncAtRef.current < SYNC_MIN_INTERVAL_MS) return;
    syncInFlightRef.current = true;
    lastSyncAtRef.current = now;

    setIsSyncingCloud(true);
    setCloudSyncError(null);
    try {
      const cloudLists = await fetchUserCloudPlaylists(
        settings.kugouToken,
        settings.kugouUserId,
        settings.kugouAppId
      );
      if (cloudLists.length > 0) {
        const localList = await getLocalPlaylists();
        const importedOnly = localList.filter((p) => !p.isUserOwned);

        const mergedCloud = cloudLists.map((cloudP) => {
          const cached = localList.find((p) => p.id === cloudP.id);
          // 仅当缓存的曲目数已达到云端总数时才复用缓存；
          // 缓存不完整（如历史版本只拉到 300/487 首）则丢弃缓存，走重新拉取
          const cacheComplete =
            cached &&
            cached.songs.length > 0 &&
            (cloudP.totalSongs > 0 ? cached.songs.length >= cloudP.totalSongs : true);
          if (cacheComplete && cached) {
            return {
              ...cloudP,
              songs: cached.songs,
              totalSongs: Math.max(cached.songs.length, cloudP.totalSongs),
            };
          }
          return cloudP;
        });

        const all = [...mergedCloud, ...importedOnly];
        await saveAllPlaylistsToStorage(all);
        setPlaylists(all);

        setActivePlaylist((prev) => prev ?? (all.length > 0 ? all[0] : null));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '云端歌单同步失败';
      console.error('[syncCloudPlaylists] 同步失败:', err);
      setCloudSyncError(msg);
    } finally {
      syncInFlightRef.current = false;
      setIsSyncingCloud(false);
    }
  }, []);

  // 应用启动时拉取歌单与用户配置，并自动同步云端歌单（仅执行一次，防止依赖变化导致重复请求）
  const didInitRef = useRef(false);
  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    void (async () => {
      await refreshPlaylists();
      await restorePlayback();
    })();
    refreshUserSettings().then(async () => {
      const settings = await getUserSettings();
      if (settings.kugouToken && settings.kugouUserId) {
        syncCloudPlaylists();
        // 拉取概念版 VIP 状态用于界面打标
        refreshVipStatus();
      }
    });
    tryAutoCheckin().catch(() => {});
  }, [refreshPlaylists, refreshUserSettings, syncCloudPlaylists, refreshVipStatus]);

  // Token 保活：酷狗登录态长期无请求会失效。运行期间每 6 小时发一次
  // 轻量带登录态的请求（VIP 状态查询），尽量延长 token 有效期。
  useEffect(() => {
    const ping = async () => {
      try {
        const s = await getUserSettings();
        if (!s.kugouToken || !s.kugouUserId) return;
        const ok = await keepTokenAlive(s.kugouToken, s.kugouUserId);
        if (!ok) {
          console.warn('[TokenKeepAlive] 保活请求失败，token 可能已失效，请重新扫码授权');
        }
      } catch {
        /* 网络异常忽略，下个周期重试 */
      }
    };
    const timer = setInterval(ping, 6 * 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // 根据当前播放时间定位歌词行
  useEffect(() => {
    if (!lyrics.length) {
      setActiveLyricIndex(-1);
      return;
    }
    let idx = -1;
    for (let i = 0; i < lyrics.length; i++) {
      if (currentTime >= lyrics[i].time) {
        idx = i;
      } else {
        break;
      }
    }
    setActiveLyricIndex(idx);
  }, [currentTime, lyrics]);

  // 播放单曲核心逻辑
  // reload：同一首歌换音源（切音质 / 重挂音效），不动队列、歌词与播放进度
  const playSong = async (
    song: KuGouSong,
    opts?: { insertFront?: boolean; reload?: { startAt: number; autoplay: boolean } }
  ) => {
    const requestId = ++playRequestIdRef.current;
    const reload = opts?.reload;

    if (!reload) {
      // 维护独立播放队列：队列中不存在时按需插入
      // （搜索结果插到最前面，其余场景追加到末尾；已存在则直接播放不重复添加）
      setQueue((prev) => {
        if (prev.some((s) => s.hash && s.hash === song.hash)) return prev;
        return opts?.insertFront ? [song, ...prev] : [...prev, song];
      });

      setCurrentSong(song);
      setAudioSourceInfo(null);
      setCurrentTime(0);
      setDuration(0);
      setLyrics([]);

      // 异步拉取歌词
      fetchSongLyrics(song).then((lines) => setLyrics(lines));
    }

    // 先停掉并卸载旧音源，避免新歌解析失败时继续播放上一首。
    let audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }

    setErrorMsg(null);
    setIsLoadingAudio(true);

    try {
      const sourceResult = await resolveAudioSource(song);
      if (playRequestIdRef.current !== requestId) return;
      setAudioSourceInfo(sourceResult);

      // 音效要走 Web Audio：跨域未放行的资源接进音频图只会输出静音，
      // 所以挂链前先探一次 CORS；已绑过图的元素遇到不支持的音源只能整个换掉。
      const effectId = audioEffectRef.current;
      let effectOn = false;
      if (effectId !== 'off') {
        const allowed = await checkAudioCors(sourceResult.url);
        if (playRequestIdRef.current !== requestId) return;
        setEffectBlocked(!allowed);
        if (allowed) {
          audio = audioRef.current;
          if (audio) audio.crossOrigin = 'anonymous';
          effectOn = true;
        } else if (effectChainRef.current) {
          audio = swapMediaElement(false);
        }
      } else {
        setEffectBlocked(false);
      }

      audio = audioRef.current;
      if (!audio) return;

      if (reload && reload.startAt > 0) pendingSeekRef.current = reload.startAt;
      audio.src = sourceResult.url;

      if (effectOn) {
        if (!effectChainRef.current) effectChainRef.current = new AudioEffectChain(audio);
        effectChainRef.current.setPreset(effectId);
        void effectChainRef.current.resume();
      }

      if (reload && !reload.autoplay) {
        audio.load();
      } else {
        await audio.play().then(() => {
          if (playRequestIdRef.current !== requestId) {
            audioRef.current?.pause();
          }
        });
      }
    } catch (err: unknown) {
      if (playRequestIdRef.current !== requestId) return;
      console.error('[PlayerContext] 音源解析失败:', err);
      const msg = err instanceof Error ? err.message : '播放失败';
      setErrorMsg(msg);
      setIsPlaying(false);
      skipBrokenRef.current(err);
    } finally {
      setIsLoadingAudio(false);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current || !currentSong) return;
    if (isPlaying) {
      audioRef.current.pause();
      return;
    }
    // 冷启动恢复的只是「上次播放的歌」这个记录，音源还没解析、audio 没有 src，
    // 此时直接 play() 会被浏览器拒绝、表现为点了没反应，所以走一次完整解析。
    if (!audioSourceInfo) {
      void playSong(currentSong);
      return;
    }
    // 已解析过但地址已失效（签名过期 / 源站换链）时 play() 同样会被拒，一并往前跳
    audioRef.current.play().catch((e) => {
      console.warn('播放恢复受阻:', e);
      skipBrokenRef.current(e);
    });
  };

  // 获取下一曲索引（基于独立播放队列）
  const getNextSongIndex = useCallback((): number => {
    if (queue.length === 0 || !currentSong) return -1;
    const currentIndex = queue.findIndex((s) => sameSong(s, currentSong));
    const total = queue.length;

    if (playMode === 'random') {
      let rand = Math.floor(Math.random() * total);
      if (rand === currentIndex && total > 1) {
        rand = (rand + 1) % total;
      }
      return rand;
    }
    return (currentIndex + 1) % total;
  }, [queue, currentSong, playMode]);

  // 下一曲
  const nextSong = useCallback(() => {
    if (queue.length === 0) return;
    const nextIdx = getNextSongIndex();
    if (nextIdx >= 0) {
      playSong(queue[nextIdx]);
    }
  }, [queue, getNextSongIndex]);

  // 音源异常（解析不出地址 / 媒体元素报错）时自动跳下一首，不让播放停在这首上
  const AUTO_SKIP_LIMIT = 5;
  // failed: 本轮连续坏掉的歌，既用于挡同一首的重复报错，也用于卡死上限
  const autoSkipRef = useRef<{ failed: Set<string> }>({ failed: new Set() });
  useEffect(() => {
    skipBrokenRef.current = (reason) => {
      console.warn('[PlayerContext] 音源异常，自动跳过:', reason);
      const hash = currentSong?.hash ?? '';
      const { failed } = autoSkipRef.current;
      // 同一首坏音源会同时抛 media error 和 play() 拒绝，只处理第一次
      if (failed.has(hash)) return;
      // 整队列都播不了时不能无限轮转，连续失败攒够上限就停在这里
      if (failed.size >= AUTO_SKIP_LIMIT) {
        setErrorMsg('队列中没有可播放的音源');
        return;
      }
      failed.add(hash);
      nextSong();
    };
  }, [currentSong, nextSong]);

  // 用户换了队列（播放全部 / 清空 / 插入新歌）就当作新一轮，失败记录作废
  useEffect(() => {
    autoSkipRef.current.failed.clear();
  }, [queue]);

  // 上一曲
  const prevSong = () => {
    if (queue.length === 0 || !currentSong) return;
    const currentIndex = queue.findIndex((s) => sameSong(s, currentSong));
    const total = queue.length;
    const prevIdx = (currentIndex - 1 + total) % total;
    playSong(queue[prevIdx]);
  };

  // 播放列表对外暴露的就是独立播放队列
  const queueSongs = queue;

  // 播放全部：清空并重建独立播放队列，从第一首开始播放
  const playAll = async (songs: KuGouSong[]) => {
    if (!songs || songs.length === 0) return;
    setQueue([...songs]);
    await playSong(songs[0]);
  };

  // 手动清空播放队列（仅停止播放并清空队列，不影响任何歌单）
  const clearQueue = useCallback(async () => {
    playRequestIdRef.current += 1;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setCurrentSong(null);
    setAudioSourceInfo(null);
    setLyrics([]);
    setActiveLyricIndex(-1);
    setErrorMsg(null);
    setIsPlaying(false);
    setIsLoadingAudio(false);
    setCurrentTime(0);
    setDuration(0);
    setQueue([]);
    // 清空队列时同步移除“上次播放”的恢复记录
    await savePlaybackPrefs({ song: null, position: 0, queue: [] });
  }, [savePlaybackPrefs]);

  // 媒体元素里的「自然播放结束」读的是 ref，这里同步最新的 nextSong
  useEffect(() => {
    nextSongRef.current = nextSong;
  }, [nextSong]);

  const seek = (time: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    // 音频尚未加载（如刚恢复播放状态还没点播放）时，设置 currentTime 会抛 InvalidStateError
    // 此时先记住目标位置，待元数据加载完成后再定位
    if (!audio.src || audio.readyState === 0) {
      pendingSeekRef.current = time;
      setCurrentTime(time);
      return;
    }

    try {
      audio.currentTime = time;
      setCurrentTime(time);
    } catch (e) {
      console.warn('[PlayerContext] seek 失败，稍后重试定位:', e);
      pendingSeekRef.current = time;
    }
  };

  const setVolume = (val: number) => {
    const clamped = Math.max(0, Math.min(1, val));
    setVolumeState(clamped);
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : clamped;
    }
  };

  const toggleMute = () => {
    setIsMuted((prev) => {
      const next = !prev;
      if (audioRef.current) {
        audioRef.current.volume = next ? 0 : volume;
      }
      return next;
    });
  };

  const cyclePlayMode = () => {
    const modes: PlayMode[] = ['sequence', 'loop', 'single', 'random'];
    const nextIndex = (modes.indexOf(playMode) + 1) % modes.length;
    setPlayMode(modes[nextIndex]);
  };

  // 切音质：落盘后立刻用新档位重解析当前曲目，进度与播放状态原样接续
  const setAudioQuality = (quality: AudioQuality) => {
    if (quality === audioQualityRef.current) return;
    audioQualityRef.current = quality;
    setAudioQualityState(quality);
    void saveUserSettings({ audioQuality: quality }).then(setUserSettings);

    const audio = audioRef.current;
    if (currentSong && audioSourceInfo && audio) {
      void playSong(currentSong, {
        reload: { startAt: audio.currentTime, autoplay: isPlaying },
      });
    }
  };

  // 切音效：已挂上音频图就直接改增益，没挂就探测 CORS 后重建元素再挂
  const setAudioEffect = async (effect: AudioEffectId) => {
    audioEffectRef.current = effect;
    setAudioEffectState(effect);
    void saveUserSettings({ audioEffect: effect }).then(setUserSettings);

    if (effect === 'off') {
      // 关掉音效就换回不带跨域约束的元素，别让后续备轨音源被静音
      if (effectChainRef.current) swapMediaElement(false);
      setEffectBlocked(false);
      return;
    }

    if (effectChainRef.current) {
      effectChainRef.current.setPreset(effect);
      await effectChainRef.current.resume();
      return;
    }

    const url = audioRef.current?.src ?? '';
    // 还没解析出音源：记住档位，下一首载入时自动挂链
    if (!url) return;

    if (!(await checkAudioCors(url))) {
      setEffectBlocked(true);
      return;
    }

    const audio = swapMediaElement(true);
    const chain = new AudioEffectChain(audio);
    chain.setPreset(effect);
    effectChainRef.current = chain;
    await chain.resume();
    setEffectBlocked(false);
  };

  const selectPlaylist = async (playlist: KuGouPlaylist) => {
    setActivePlaylist(playlist);
    // 若为账号云端歌单且尚未拉取曲目列表，异步拉取并缓存
    if (
      playlist.isUserOwned &&
      playlist.listId &&
      (playlist.songs.length === 0 ||
        (playlist.totalSongs > 0 && playlist.songs.length < playlist.totalSongs)) &&
      userSettings?.kugouToken &&
      userSettings?.kugouUserId
    ) {
      try {
        const tracks = await fetchUserCloudPlaylistTracks(
          playlist.listId,
          userSettings.kugouToken,
          userSettings.kugouUserId,
          userSettings.kugouAppId
        );
        if (tracks.length > 0) {
          const updated: KuGouPlaylist = {
            ...playlist,
            songs: tracks,
            totalSongs: tracks.length,
            coverUrl: playlist.coverUrl || tracks[0]?.coverUrl || '',
          };
          setActivePlaylist(updated);
          setPlaylists((prev) => {
            const next = prev.map((p) => (p.id === playlist.id ? updated : p));
            saveAllPlaylistsToStorage(next);
            return next;
          });
        }
      } catch (err) {
        console.warn('[selectPlaylist] 加载云歌歌曲目失败:', err);
      }
    }
  };

  const addSongToPlaylist = async (
    song: KuGouSong,
    playlistId: string
  ): Promise<{ success: boolean; message: string }> => {
    const target = playlists.find((p) => p.id === playlistId);
    if (!target) {
      return { success: false, message: '未找到目标歌单' };
    }

    const alreadyIn = target.songs.some((s) => s.hash.toLowerCase() === song.hash.toLowerCase());
    if (alreadyIn) {
      return { success: true, message: `《${target.name}》中已存在该歌曲` };
    }

    let cloudNotice = '';
    // 若为账号云端歌单且已登录，调用官方接口同步
    if (target.isUserOwned && target.listId && userSettings?.kugouToken && userSettings?.kugouUserId) {
      const cloudRes = await addSongToUserCloudPlaylist(
        song,
        target.listId,
        userSettings.kugouToken,
        userSettings.kugouUserId,
        userSettings.kugouAppId
      );
      if (cloudRes.success) {
        cloudNotice = '，并已成功同步至酷狗账号！';
      } else {
        cloudNotice = ` (本地已加入，云端同步: ${cloudRes.message})`;
      }
    }

    // 列表按倒序展示（最新在前），新歌追加到数组末尾才会出现在第一位
    const updatedSongs = [...target.songs, song];
    const updatedPlaylist: KuGouPlaylist = {
      ...target,
      songs: updatedSongs,
      totalSongs: updatedSongs.length,
      coverUrl: target.coverUrl || song.coverUrl,
    };

    const nextPlaylists = playlists.map((p) => (p.id === playlistId ? updatedPlaylist : p));
    setPlaylists(nextPlaylists);
    if (activePlaylist?.id === playlistId) {
      setActivePlaylist(updatedPlaylist);
    }
    await saveAllPlaylistsToStorage(nextPlaylists);

    return {
      success: true,
      message: `已加入《${target.name}》${cloudNotice}`,
    };
  };

  const removeSongFromPlaylist = async (
    song: KuGouSong,
    playlistId: string
  ): Promise<{ success: boolean; message: string }> => {
    const target = playlists.find((p) => p.id === playlistId);
    if (!target) {
      return { success: false, message: '未找到目标歌单' };
    }

    let cloudNotice = '';
    // 云端歌单先删云端：失败就保留本地，避免本地与账号两边状态不一致
    if (target.isUserOwned && target.listId && userSettings?.kugouToken && userSettings?.kugouUserId) {
      const cloudRes = await removeSongFromUserCloudPlaylist(
        song,
        target.listId,
        userSettings.kugouToken,
        userSettings.kugouUserId,
        userSettings.kugouAppId
      );
      if (!cloudRes.success) {
        return { success: false, message: `云端删除失败: ${cloudRes.message}` };
      }
      cloudNotice = '，已同步删除酷狗云端';
    }

    const updatedSongs = target.songs.filter(
      (s) => s.hash.toLowerCase() !== song.hash.toLowerCase()
    );
    const updatedPlaylist: KuGouPlaylist = {
      ...target,
      songs: updatedSongs,
      totalSongs: updatedSongs.length,
    };

    const nextPlaylists = playlists.map((p) => (p.id === playlistId ? updatedPlaylist : p));
    setPlaylists(nextPlaylists);
    if (activePlaylist?.id === playlistId) {
      setActivePlaylist(updatedPlaylist);
    }
    await saveAllPlaylistsToStorage(nextPlaylists);

    return {
      success: true,
      message: `已从《${target.name}》移除${cloudNotice}`,
    };
  };

  const deletePlaylistById = async (id: string) => {
    await deleteLocalPlaylist(id);
    await refreshPlaylists();
    if (activePlaylist?.id === id) {
      const remaining = playlists.filter((p) => p.id !== id);
      setActivePlaylist(remaining.length > 0 ? remaining[0] : null);
    }
  };

  // ===== 键盘快捷键：空格 播放/暂停，←→ 快退/快进 5s，↑↓ 音量 =====
  // 另支持标准媒体键（车机方向盘 / 蓝牙媒体按键 / 部分键盘）：
  // MediaPlayPause / MediaTrackNext / MediaTrackPrevious / MediaStop
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // 焦点在输入类控件时不拦截按键
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      // 标准媒体键：不受「是否有当前歌曲」限制，切歌/清空队列后仍可响应
      switch (e.key) {
        case 'MediaPlayPause':
          e.preventDefault();
          togglePlay();
          return;
        case 'MediaPlay':
          e.preventDefault();
          if (!isPlaying) togglePlay();
          return;
        case 'MediaPause':
          e.preventDefault();
          if (isPlaying) togglePlay();
          return;
        case 'MediaTrackNext':
          e.preventDefault();
          nextSong();
          return;
        case 'MediaTrackPrevious':
          e.preventDefault();
          prevSong();
          return;
        case 'MediaStop':
          e.preventDefault();
          if (audioRef.current) audioRef.current.pause();
          return;
      }

      if (!currentSong) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          seek(Math.max(0, currentTime - 5));
          break;
        case 'ArrowRight':
          e.preventDefault();
          seek(Math.min(duration || 0, currentTime + 5));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume(Math.min(1, (isMuted ? 0 : volume) + 0.05));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume(Math.max(0, volume - 0.05));
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentSong, currentTime, duration, volume, isMuted, isPlaying, togglePlay, nextSong, prevSong, seek, setVolume]);

  // ===== 系统媒体控制（Media Session）：macOS 控制中心 / 媒体键 =====
  useEffect(() => {
    const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
    if (!ms || !currentSong) return;

    ms.metadata = new MediaMetadata({
      title: currentSong.songName,
      artist: currentSong.singerName,
      album: activePlaylist?.name || '酷狗无损播放器',
      artwork: currentSong.coverUrl
        ? [{ src: currentSong.coverUrl, sizes: '400x400', type: 'image/jpeg' }]
        : [],
    });
  }, [currentSong, activePlaylist]);

  useEffect(() => {
    const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
    if (!ms || !currentSong) return;
    ms.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying, currentSong]);

  useEffect(() => {
    const ms = (navigator as Navigator & { mediaSession?: MediaSession }).mediaSession;
    if (!ms) return;
    try {
      ms.setActionHandler('play', () => togglePlay());
      ms.setActionHandler('pause', () => togglePlay());
      ms.setActionHandler('stop', () => {
        if (audioRef.current) audioRef.current.pause();
      });
      ms.setActionHandler('previoustrack', () => prevSong());
      ms.setActionHandler('nexttrack', () => nextSong());
      ms.setActionHandler('seekto', (d) => {
        if (d.seekTime != null) seek(d.seekTime);
      });
      // 不要注册 seekbackward / seekforward：macOS 控制中心会拿这对「快进快退」挤掉
      // 上一首 / 下一首，按钮位置变成两个圆弧箭头。
    } catch {
      // 当前平台不支持的 action 忽略
    }
  }, [currentSong, togglePlay, prevSong, nextSong, seek]);

  return (
    <PlayerContext.Provider
      value={{
        userSettings,
        refreshUserSettings,

        refreshPlaylists,
        isSyncingCloud,
        syncCloudPlaylists,
        cloudSyncError,
        playlists,
        activePlaylist,
        selectPlaylist,
        deletePlaylistById,
        vipStatus,
        refreshVipStatus,
        addSongToPlaylist,
        removeSongFromPlaylist,

        currentSong,
        isPlaying,
        currentTime,
        duration,
        volume,
        isMuted,
        playMode,
        isLoadingAudio,
        audioSourceInfo,
        errorMsg,
        audioQuality,
        setAudioQuality,
        audioEffect,
        setAudioEffect,
        effectBlocked,
        queueSongs,
        clearQueue,

        lyrics,
        activeLyricIndex,

        playSong,
        playAll,
        togglePlay,
        nextSong,
        prevSong,
        seek,
        setVolume,
        toggleMute,
        cyclePlayMode,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
};

export function usePlayer(): PlayerContextType {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }
  return context;
}
