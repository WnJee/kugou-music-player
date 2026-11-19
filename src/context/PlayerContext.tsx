/**
 * 全局播放器状态管理上下文 (src/context/PlayerContext.tsx)
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
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
  fetchUserCloudPlaylistTracksFull,
  addSongToUserCloudPlaylist,
  removeSongFromUserCloudPlaylist,
} from '../services/kugouPlaylist';
import { fetchSongLyrics } from '../services/lyrics';
import { Store } from '@tauri-apps/plugin-store';
import { PlaybackProgressProvider, playbackProgress } from './PlaybackProgress';

// 高频进度走独立 hook，对外契约：{ currentTime, duration, seek }
export { usePlaybackProgress } from './PlaybackProgress';
export type { PlaybackProgressValue } from './PlaybackProgress';

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

const PLAYBACK_STORE_FILE = 'kugou_playback.json';

/** 播放进度落盘间隔：桌面关窗只是隐藏、托盘退出直接 app.exit、安卓被杀，都拿不到 beforeunload */
const PROGRESS_SAVE_INTERVAL_MS = 5000;

/** 整队列都播不了时不能无限轮转，连续失败攒够上限就停在这里 */
const AUTO_SKIP_LIMIT = 5;

interface PersistedPlayback {
  volume?: number;
  /** 是否静音（静音是用户主动选择，必须和音量一起记住） */
  muted?: boolean;
  playMode?: PlayMode;
  playlistId?: string | null;
  song?: KuGouSong | null;
  position?: number;
  /** 独立播放队列（重启后恢复） */
  queue?: KuGouSong[] | null;
}

interface PlaySongOptions {
  insertFront?: boolean;
  reload?: { startAt: number; autoplay: boolean };
}

/** 键盘 / MediaSession / 媒体元素回调统一从这张动作表取最新实现，监听只绑一次 */
interface PlayerActions {
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  /** 相对当前位置快进 / 快退（秒） */
  seekBy: (delta: number) => void;
  /** 相对当前音量加减 */
  nudgeVolume: (delta: number) => void;
}

function sameSong(a: KuGouSong | null | undefined, b: KuGouSong | null | undefined): boolean {
  return Boolean(a && b && a.hash && a.hash === b.hash);
}

/**
 * play() 被 pause() / 换源顶掉时以 AbortError 拒绝，自动播放被系统拦截时是 NotAllowedError：
 * 这两种与音源好坏无关，不能算作「坏音源」
 */
function isInterruptionError(err: unknown): boolean {
  const name = (err as { name?: string } | null | undefined)?.name;
  return name === 'AbortError' || name === 'NotAllowedError';
}

/** 在「除当前曲之外」的曲目里等概率挑一首：撞到自己就 +1 会让后一首概率翻倍 */
function pickRandomOtherIndex(total: number, currentIndex: number): number {
  if (total <= 1) return 0;
  const rand = Math.floor(Math.random() * (total - 1));
  return currentIndex >= 0 && rand >= currentIndex ? rand + 1 : rand;
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
  // 恢复完成门闩：恢复结束前一律不落盘，否则会把「还没读出来」的空状态覆盖存档
  const [isRestored, setIsRestored] = useState<boolean>(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playRequestIdRef = useRef(0);
  // 歌词请求序号：快速切歌时挡掉晚到的旧歌词
  const lyricsRequestIdRef = useRef(0);
  // 恢复 / 拖进度时暂存的目标位置，待音频元数据加载完成后定位
  const pendingSeekRef = useRef<number | null>(null);
  // 音源异常后自动跳过的触发口
  const skipBrokenRef = useRef<(reason: unknown) => void>(() => {});
  // 地址疑似失效时「原地重解析当前曲目」的触发口
  const recoverAudioRef = useRef<(reason: unknown) => void>(() => {});
  // 成功出声后的回调：清失败记录、放行下一次重解析
  const onPlayableRef = useRef<() => void>(() => {});
  // 媒体元素的 ended 事件走这里，避免与 nextSong 的声明顺序互相牵扯
  const nextSongRef = useRef<() => void>(() => {});
  const playSongRef = useRef<(song: KuGouSong, opts?: PlaySongOptions) => Promise<void>>(
    async () => {}
  );
  const playModeRef = useRef<PlayMode>('sequence');
  const volumeRef = useRef<number>(0.8);
  const isMutedRef = useRef<boolean>(false);
  // 音效处理链：绑定到某个 <audio> 后无法迁移，换元素时必须一并丢弃
  const effectChainRef = useRef<AudioEffectChain | null>(null);
  // 解析音源、挂音效这些异步流程里要读最新档位，不能等下一次渲染
  const audioQualityRef = useRef<AudioQuality>(DEFAULT_AUDIO_QUALITY);
  const audioEffectRef = useRef<AudioEffectId>('off');
  // 媒体事件 / 键盘 / MediaSession 回调里要读最新播放状态，用 ref 镜像避免闭包过期
  const currentSongRef = useRef<KuGouSong | null>(null);
  const isPlayingRef = useRef<boolean>(false);
  const audioSourceInfoRef = useRef<AudioSourceResult | null>(null);
  const playlistsRef = useRef<KuGouPlaylist[]>([]);
  const lyricsRef = useRef<LyricLine[]>([]);
  // 地址失效只重解析一次：重解析出来的新地址再报错就直接认定坏音源（成功出声后复位）
  const relinkRef = useRef<{ hash: string; used: boolean } | null>(null);
  // 本模块在媒体元素上绑的监听按元素隔离，换元素时整体 abort
  const elementAbortRef = useRef(new WeakMap<HTMLAudioElement, AbortController>());
  // 上一轮连续失败的歌：同一首会同时抛 media error 和 play() 拒绝，只处理第一次
  const autoSkipRef = useRef<Set<string>>(new Set());
  const actionsRef = useRef<PlayerActions>({
    play: () => {},
    pause: () => {},
    togglePlay: () => {},
    next: () => {},
    prev: () => {},
    seekBy: () => {},
    nudgeVolume: () => {},
  });

  currentSongRef.current = currentSong;
  isPlayingRef.current = isPlaying;
  audioSourceInfoRef.current = audioSourceInfo;
  playlistsRef.current = playlists;
  lyricsRef.current = lyrics;
  audioQualityRef.current = audioQuality;
  audioEffectRef.current = audioEffect;
  volumeRef.current = volume;
  isMutedRef.current = isMuted;
  playModeRef.current = playMode;

  /** 释放媒体元素：解绑本模块绑的监听，并断开底层解码资源 */
  const disposeMediaElement = useCallback((element: HTMLAudioElement | null) => {
    if (!element) return;
    elementAbortRef.current.get(element)?.abort();
    elementAbortRef.current.delete(element);
    element.pause();
    element.removeAttribute('src');
    element.load();
  }, []);

  /**
   * 媒体元素工厂
   * 音效要把元素接进 Web Audio，而 MediaElementSource 一旦建立就无法解绑：
   * 遇到不支持 CORS 的音源只能整个换掉 <audio>，所以创建与事件绑定必须可重复执行。
   */
  const createMediaElement = useCallback((): HTMLAudioElement => {
    const audio = new Audio();
    audio.volume = isMutedRef.current ? 0 : volumeRef.current;

    // 用 AbortController 统一解绑本元素上的全部监听
    const controller = new AbortController();
    elementAbortRef.current.set(audio, controller);
    const listenerOptions = { signal: controller.signal };

    // 进度只写进独立的 progress store，主 Provider 不随每帧重渲染
    audio.addEventListener(
      'timeupdate',
      () => playbackProgress.update({ currentTime: audio.currentTime }),
      listenerOptions
    );
    audio.addEventListener(
      'durationchange',
      () => {
        if (audio.duration && isFinite(audio.duration)) {
          playbackProgress.update({ duration: audio.duration });
        }
      },
      listenerOptions
    );
    audio.addEventListener('play', () => setIsPlaying(true), listenerOptions);
    audio.addEventListener('pause', () => setIsPlaying(false), listenerOptions);
    audio.addEventListener('waiting', () => setIsLoadingAudio(true), listenerOptions);
    audio.addEventListener(
      'playing',
      () => {
        setIsLoadingAudio(false);
        onPlayableRef.current();
      },
      listenerOptions
    );
    // 地址解析成功但流本身不可用（404 / 换源 / 解码失败）时 media 元素只抛 error，不会自己往下走
    audio.addEventListener(
      'error',
      () => {
        if (!audio.src) return;
        const code = audio.error?.code;
        setErrorMsg(audio.error?.message || `音源错误${code ? ` (${code})` : ''}`);
        setIsPlaying(false);
        setIsLoadingAudio(false);
        // 链接过期 / 源站换链都走这里：先原地重解析一次，仍失败才判定坏音源
        recoverAudioRef.current(audio.error ?? 'media error');
      },
      listenerOptions
    );
    // 恢复上次播放进度：待元数据加载完成后定位
    audio.addEventListener(
      'loadedmetadata',
      () => {
        if (pendingSeekRef.current == null) return;
        const target = pendingSeekRef.current;
        pendingSeekRef.current = null;
        if (isFinite(audio.duration) && target < audio.duration) {
          audio.currentTime = target;
          playbackProgress.update({ currentTime: target });
        }
      },
      listenerOptions
    );
    audio.addEventListener(
      'ended',
      () => {
        if (playModeRef.current === 'single') {
          audio.currentTime = 0;
          void audio.play().catch(() => {});
          return;
        }
        // 顺序模式播到队尾时 nextSong 自己会停下，不会回绕
        nextSongRef.current();
      },
      listenerOptions
    );

    return audio;
  }, []);

  // 初始化 Audio 实例
  useEffect(() => {
    const audio = createMediaElement();
    audioRef.current = audio;
    return () => {
      // 换过元素后 audioRef 才指向当前在用的那个，清理必须走它而不是首次创建的元素
      disposeMediaElement(audioRef.current);
      audioRef.current = null;
      effectChainRef.current?.dispose();
      effectChainRef.current = null;
    };
  }, [createMediaElement, disposeMediaElement]);

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

      // 旧元素必须彻底释放：只 pause + 清 src 会让它继续派发事件、占着解码资源
      disposeMediaElement(prev);

      if (src) {
        if (at > 0) pendingSeekRef.current = at;
        next.src = src;
        if (wasPlaying) void next.play().catch(() => {});
      }
      return next;
    },
    [createMediaElement, disposeMediaElement]
  );

  // ===== 记忆播放状态：音量 / 播放模式 / 上次播放的歌单、歌曲与进度 =====
  // 写入串行化：savePlaybackPrefs 是「读 - 改 - 写」，并发执行会互相覆盖补丁
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const savePlaybackPrefs = useCallback((patch: PersistedPlayback): Promise<void> => {
    const run = async () => {
      try {
        if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
        const store = await Store.load(PLAYBACK_STORE_FILE);
        const prev = (await store.get<PersistedPlayback>('last')) || {};
        await store.set('last', { ...prev, ...patch, savedAt: Date.now() });
        await store.save();
      } catch (e) {
        console.warn('[PlaybackStore] 保存播放状态失败:', e);
      }
    };
    saveChainRef.current = saveChainRef.current.then(run);
    return saveChainRef.current;
  }, []);

  // 启动时恢复上次播放状态（不自动播放，仅定位到上次进度）
  const restorePlayback = useCallback(async () => {
    try {
      if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;
      const store = await Store.load(PLAYBACK_STORE_FILE);
      const saved = await store.get<PersistedPlayback>('last');
      if (!saved) return;

      // 音量 0 也是合法存档（用户主动拉到 0），不能当成「没有记录」
      if (typeof saved.volume === 'number') {
        setVolumeState(saved.volume);
        if (audioRef.current) audioRef.current.volume = saved.muted ? 0 : saved.volume;
      }
      if (saved.muted) setIsMuted(true);
      if (saved.playMode) setPlayMode(saved.playMode);

      if (saved.song) {
        setCurrentSong(saved.song);
        if (saved.position && saved.position > 1) {
          pendingSeekRef.current = saved.position;
          // 同时把进度同步给 UI：否则保存 effect 会在未播放状态下用 0 覆盖存档
          playbackProgress.update({
            currentTime: saved.position,
            duration: saved.song.duration || 0,
          });
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
    } finally {
      // 无论成功、失败还是非 Tauri 环境提前返回，都必须放行落盘
      setIsRestored(true);
    }
  }, []);

  // 音量 / 静音 / 播放模式 / 当前歌曲变化时持久化（防抖）
  useEffect(() => {
    if (!isRestored) return;
    const t = setTimeout(() => {
      void savePlaybackPrefs({
        volume,
        muted: isMuted,
        playMode,
        playlistId: activePlaylist?.id ?? null,
        song: currentSong,
        queue,
      });
    }, 500);
    return () => clearTimeout(t);
  }, [isRestored, volume, isMuted, playMode, activePlaylist, currentSong, queue, savePlaybackPrefs]);

  // 播放进度落盘：暂停时存一次、退出前再存一次、播放中每 5 秒存一次
  useEffect(() => {
    if (!isRestored) return;
    const save = () => {
      if (!currentSong) return;
      const audio = audioRef.current;
      // 还没载入音源时 audio.currentTime 恒为 0，必须回落到恢复出来的进度，别把存档抹平
      const position = audio?.src ? audio.currentTime : playbackProgress.getSnapshot().currentTime;
      void savePlaybackPrefs({ position });
    };
    if (!isPlaying) save();
    window.addEventListener('beforeunload', save);
    const timer = isPlaying ? setInterval(save, PROGRESS_SAVE_INTERVAL_MS) : undefined;
    return () => {
      window.removeEventListener('beforeunload', save);
      if (timer) clearInterval(timer);
    };
  }, [isRestored, isPlaying, currentSong, savePlaybackPrefs]);

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
        const mergedCloud: KuGouPlaylist[] = [];
        const failedNames: string[] = [];

        for (const cloudPlaylist of cloudLists) {
          const cached = localList.find((p) => p.id === cloudPlaylist.id);
          const cachedCount = cached?.songs.length ?? 0;
          const listId = cloudPlaylist.listId;
          // 曲目数必须与云端总数严格相等才复用缓存：云端删歌或增删相抵都会让数量不等，
          // 过去「本地 >= 云端就复用 + Math.max」会让删除永远同步不下来
          if (cachedCount === cloudPlaylist.totalSongs || !listId) {
            mergedCloud.push(cached ? { ...cloudPlaylist, songs: cached.songs } : cloudPlaylist);
            continue;
          }
          try {
            const tracksResult = await fetchUserCloudPlaylistTracksFull(
              listId,
              settings.kugouToken,
              settings.kugouUserId,
              settings.kugouAppId
            );
            mergedCloud.push({
              ...cloudPlaylist,
              songs: tracksResult.songs,
              totalSongs: tracksResult.totalSongs,
            });
          } catch (err) {
            // 分页在重试耗尽后会直接抛错：此时保留缓存，绝不写入残缺曲目列表
            console.warn('[syncCloudPlaylists] 曲目拉取失败，保留本地缓存:', err);
            failedNames.push(cloudPlaylist.name);
            // 有缓存就整表沿用；连缓存都没有时宁可不展示，也不写「总数 N、实际 0 首」的残表
            if (cached) {
              mergedCloud.push({
                ...cloudPlaylist,
                songs: cached.songs,
                totalSongs: cached.songs.length,
              });
            }
          }
        }

        const all = [...mergedCloud, ...importedOnly];
        await saveAllPlaylistsToStorage(all);
        setPlaylists(all);

        setActivePlaylist((prev) => {
          if (!prev) return all.length > 0 ? all[0] : null;
          return all.find((p) => p.id === prev.id) ?? prev;
        });

        if (failedNames.length > 0) {
          setCloudSyncError(`${failedNames.join('、')} 曲目同步失败，已保留本地缓存`);
        }
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
      } catch (err) {
        // 请求 URL 里带 token，异常信息可能包含它，只记录错误类型
        console.warn('[TokenKeepAlive] 保活请求异常，下个周期重试:', err instanceof Error ? err.name : typeof err);
      }
    };
    const timer = setInterval(ping, 6 * 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  // 根据当前播放时间定位歌词行：进度来自独立 store，
  // 且只在行号变化时才 setState —— 主 Provider 不会随每帧进度重渲染
  useEffect(() => {
    const syncActiveLine = () => {
      const lines = lyricsRef.current;
      let idx = -1;
      if (lines.length > 0) {
        const time = playbackProgress.getSnapshot().currentTime;
        for (let i = 0; i < lines.length; i++) {
          if (time >= lines[i].time) {
            idx = i;
          } else {
            break;
          }
        }
      }
      setActiveLyricIndex((prev) => (prev === idx ? prev : idx));
    };
    syncActiveLine();
    return playbackProgress.subscribe(syncActiveLine);
  }, [lyrics]);

  // 播放单曲核心逻辑
  // reload：同一首歌换音源（切音质 / 重挂音效），不动队列、歌词与播放进度
  const playSong = async (song: KuGouSong, opts?: PlaySongOptions) => {
    const requestId = ++playRequestIdRef.current;
    const reload = opts?.reload;

    if (!reload) {
      // 冷启动恢复后点播放其实还是同一首：此时保留 pendingSeekRef / 进度快照，
      // 否则恢复出来的进度会被这里清掉，「记住上次进度」等于没做
      const continuing = Boolean(
        currentSongRef.current?.hash && currentSongRef.current.hash === song.hash
      );

      if (!continuing) {
        // 换歌必须清掉上一首遗留的定位目标，否则新歌的 loadedmetadata 会被拖到旧位置
        pendingSeekRef.current = null;
        relinkRef.current = null;
      }

      // 维护独立播放队列：队列中不存在时按需插入
      // （搜索结果插到最前面，其余场景追加到末尾；已存在则直接播放不重复添加）
      setQueue((prev) => {
        if (prev.some((s) => s.hash && s.hash === song.hash)) return prev;
        return opts?.insertFront ? [song, ...prev] : [...prev, song];
      });

      setCurrentSong(song);
      currentSongRef.current = song;
      if (!continuing) {
        setAudioSourceInfo(null);
        audioSourceInfoRef.current = null;
        playbackProgress.reset();
        setLyrics([]);
        lyricsRef.current = [];
        setActiveLyricIndex(-1);
      }

      // 同一首歌重播（冷启动续播 / single 循环）不必再拉一次歌词
      if (!continuing) {
        // 快速切歌时旧请求会晚到：用序号挡掉过期歌词
        const lyricsRequestId = ++lyricsRequestIdRef.current;
        fetchSongLyrics(song)
          .then((lines) => {
            if (lyricsRequestIdRef.current !== lyricsRequestId) return;
            setLyrics(lines);
          })
          .catch((err) => {
            if (lyricsRequestIdRef.current !== lyricsRequestId) return;
            console.warn('[PlayerContext] 歌词拉取失败:', err);
          });
      }
    }

    // 先停掉并卸载旧音源，避免新歌解析失败时继续播放上一首。
    const stale = audioRef.current;
    if (stale) {
      stale.pause();
      stale.removeAttribute('src');
      stale.load();
    }

    setErrorMsg(null);
    setIsLoadingAudio(true);

    /** 解析音源：切音质 / 重挂音效时链接换了，失败先原地重试一次再判定坏音源 */
    const resolveWithRetry = async (): Promise<AudioSourceResult> => {
      try {
        return await resolveAudioSource(song);
      } catch (err) {
        if (!reload) throw err;
        console.warn('[PlayerContext] 重解析音源失败，重试一次:', err);
        return resolveAudioSource(song);
      }
    };

    try {
      const sourceResult = await resolveWithRetry();
      if (playRequestIdRef.current !== requestId) return;
      setAudioSourceInfo(sourceResult);
      audioSourceInfoRef.current = sourceResult;

      // 音效要走 Web Audio：跨域未放行的资源接进音频图只会输出静音，
      // 所以挂链前先探一次 CORS；已绑过图的元素遇到不支持的音源只能整个换掉。
      const effectId = audioEffectRef.current;
      let effectOn = false;
      if (effectId !== 'off') {
        const allowed = await checkAudioCors(sourceResult.url);
        if (playRequestIdRef.current !== requestId) return;
        setEffectBlocked(!allowed);
        if (allowed) {
          if (audioRef.current) audioRef.current.crossOrigin = 'anonymous';
          effectOn = true;
        } else if (effectChainRef.current) {
          swapMediaElement(false);
        }
      } else {
        setEffectBlocked(false);
      }

      const audio = audioRef.current;
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
        return;
      }

      try {
        await audio.play();
      } catch (err) {
        if (playRequestIdRef.current !== requestId) return;
        // 打断（被 pause / 换源顶掉、自动播放被系统拦截）不代表音源坏
        if (isInterruptionError(err)) return;
        // 地址过期 / 源站换链：先原地重解析一次，仍失败才跳下一首
        console.warn('[PlayerContext] 播放被拒绝，尝试重解析音源:', err);
        recoverAudioRef.current(err);
        return;
      }
      if (playRequestIdRef.current !== requestId) audioRef.current?.pause();
    } catch (err: unknown) {
      if (playRequestIdRef.current !== requestId) return;
      console.error('[PlayerContext] 音源解析失败:', err);
      setErrorMsg(err instanceof Error ? err.message : '播放失败');
      setIsPlaying(false);
      skipBrokenRef.current(err);
    } finally {
      // 只有最新一次请求才有权收尾，过期请求不能盖掉新请求的 loading 状态
      if (playRequestIdRef.current === requestId) setIsLoadingAudio(false);
    }
  };

  playSongRef.current = playSong;

  /**
   * 音源出问题时先尝试「原地重解析当前曲目」，仍不行才交给自动跳过：
   * 长暂停后链接过期、源站换链都属于这一类，直接跳下一首会误杀好歌
   */
  recoverAudioRef.current = (reason) => {
    const song = currentSongRef.current;
    const audio = audioRef.current;
    const alreadyRetried = relinkRef.current?.hash === song?.hash && relinkRef.current?.used;
    if (!song || !audio || alreadyRetried) {
      skipBrokenRef.current(reason);
      return;
    }
    relinkRef.current = { hash: song.hash, used: true };
    console.warn('[PlayerContext] 音源地址疑似失效，重解析当前曲目:', reason);
    void playSongRef.current(song, {
      reload: { startAt: audio.currentTime, autoplay: true },
    });
  };

  // 成功出声说明音源可用：清掉失败记录，长会话不会累计误停
  onPlayableRef.current = () => {
    autoSkipRef.current.clear();
    relinkRef.current = null;
  };

  // 解析不出地址 / 媒体元素报错时自动跳下一首，不让播放停在这首上
  skipBrokenRef.current = (reason) => {
    console.warn('[PlayerContext] 音源异常，自动跳过:', reason);
    const hash = currentSongRef.current?.hash ?? '';
    const failed = autoSkipRef.current;
    // 同一首坏音源会同时抛 media error 和 play() 拒绝，只处理第一次
    if (failed.has(hash)) return;
    // 整队列都播不了时不能无限轮转，连续失败攒够上限就停在这里
    if (failed.size >= AUTO_SKIP_LIMIT) {
      setErrorMsg('队列中没有可播放的音源');
      return;
    }
    failed.add(hash);
    nextSongRef.current();
  };

  /** 播放（不依赖闭包里的播放状态，媒体键 / MediaSession 也能安全调用） */
  const play = useCallback(() => {
    const audio = audioRef.current;
    const song = currentSongRef.current;
    if (!audio || !song) return;
    // 冷启动恢复的只是「上次播放的歌」这个记录，音源还没解析、audio 没有 src，
    // 此时直接 play() 会被浏览器拒绝、表现为点了没反应，所以走一次完整解析。
    if (!audioSourceInfoRef.current) {
      void playSongRef.current(song);
      return;
    }
    // 已解析过但地址已失效（签名过期 / 源站换链）时 play() 同样会被拒
    void audio.play().catch((err) => {
      if (isInterruptionError(err)) return;
      console.warn('播放恢复受阻:', err);
      recoverAudioRef.current(err);
    });
  }, []);

  /** 暂停：独立语义，避免 play/pause 共用 toggle 时因状态过期反向 */
  const pause = useCallback(() => {
    audioRef.current?.pause();
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlayingRef.current) pause();
    else play();
  }, [play, pause]);

  // 获取下一曲索引（基于独立播放队列）
  const getNextSongIndex = useCallback((): number => {
    const total = queue.length;
    if (total === 0) return -1;
    const currentIndex = currentSong ? queue.findIndex((s) => sameSong(s, currentSong)) : -1;

    if (playMode === 'random') return pickRandomOtherIndex(total, currentIndex);
    // 顺序播放到队尾就停（-1），只有单曲循环 / 列表循环才回绕
    if (playMode === 'sequence' && currentIndex === total - 1) return -1;
    return currentIndex + 1 < total ? currentIndex + 1 : 0;
  }, [queue, currentSong, playMode]);

  // 下一曲
  const nextSong = () => {
    const nextIdx = getNextSongIndex();
    if (nextIdx < 0) {
      // 顺序模式播到队尾：停在最后一首，不回绕
      setIsPlaying(false);
      return;
    }
    void playSong(queue[nextIdx]);
  };

  nextSongRef.current = nextSong;

  // 上一曲：随机模式挑另一首；当前曲不在队列或已是第一首时回绕到队尾
  const prevSong = () => {
    const total = queue.length;
    if (total === 0) return;
    const currentIndex = currentSong ? queue.findIndex((s) => sameSong(s, currentSong)) : -1;
    let prevIdx: number;
    if (playMode === 'random') {
      prevIdx = pickRandomOtherIndex(total, currentIndex);
    } else {
      prevIdx = currentIndex <= 0 ? total - 1 : currentIndex - 1;
    }
    void playSong(queue[prevIdx]);
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
    lyricsRequestIdRef.current += 1;
    pendingSeekRef.current = null;
    relinkRef.current = null;

    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setCurrentSong(null);
    currentSongRef.current = null;
    setAudioSourceInfo(null);
    audioSourceInfoRef.current = null;
    playbackProgress.reset();
    setLyrics([]);
    lyricsRef.current = [];
    setActiveLyricIndex(-1);
    setErrorMsg(null);
    setIsPlaying(false);
    setIsLoadingAudio(false);
    setQueue([]);
    // 清空队列时同步移除“上次播放”的恢复记录
    await savePlaybackPrefs({ song: null, position: 0, queue: [] });
  }, [savePlaybackPrefs]);

  // 用户换了队列（播放全部 / 清空 / 插入新歌）就当作新一轮，失败记录作废
  useEffect(() => {
    autoSkipRef.current = new Set();
  }, [queue]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    // 音频尚未加载（如刚恢复播放状态还没点播放）时，设置 currentTime 会抛 InvalidStateError
    // 此时先记住目标位置，待元数据加载完成后再定位
    if (!audio.src || audio.readyState === 0) {
      pendingSeekRef.current = time;
      playbackProgress.update({ currentTime: time });
      return;
    }

    try {
      audio.currentTime = time;
      playbackProgress.update({ currentTime: time });
    } catch (e) {
      console.warn('[PlayerContext] seek 失败，稍后重试定位:', e);
      pendingSeekRef.current = time;
    }
  }, []);

  const setVolume = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(1, val));
    setVolumeState(clamped);
    volumeRef.current = clamped;
    if (audioRef.current) {
      audioRef.current.volume = isMutedRef.current ? 0 : clamped;
    }
  }, []);

  const toggleMute = useCallback(() => {
    const next = !isMutedRef.current;
    isMutedRef.current = next;
    setIsMuted(next);
    if (audioRef.current) {
      audioRef.current.volume = next ? 0 : volumeRef.current;
    }
  }, []);

  const cyclePlayMode = useCallback(() => {
    const modes: PlayMode[] = ['sequence', 'loop', 'single', 'random'];
    const next = modes[(modes.indexOf(playModeRef.current) + 1) % modes.length];
    playModeRef.current = next;
    setPlayMode(next);
  }, []);

  // 切音质：先落盘再重解析当前曲目（解析器是从 store 现读档位的，早于落盘重解析会拿到旧值），
  // 进度与播放状态原样接续
  const setAudioQuality = (quality: AudioQuality) => {
    if (quality === audioQualityRef.current) return;
    audioQualityRef.current = quality;
    setAudioQualityState(quality);

    void (async () => {
      setUserSettings(await saveUserSettings({ audioQuality: quality }));
      const audio = audioRef.current;
      const song = currentSongRef.current;
      if (song && audioSourceInfoRef.current && audio) {
        await playSong(song, {
          reload: { startAt: audio.currentTime, autoplay: isPlayingRef.current },
        });
      }
    })();
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

  // 先点 A 再点 B 时，A 的慢请求可能后到并把视图抢回 A：用序号挡掉过期结果
  const selectSeqRef = useRef(0);
  const selectPlaylist = async (playlist: KuGouPlaylist) => {
    const seq = ++selectSeqRef.current;
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
        if (selectSeqRef.current !== seq) return;
        if (tracks.length > 0) {
          const updated: KuGouPlaylist = {
            ...playlist,
            songs: tracks,
            totalSongs: tracks.length,
            coverUrl: playlist.coverUrl || tracks[0]?.coverUrl || '',
          };
          setActivePlaylist(updated);
          // 落盘必须放在 updater 外面：StrictMode 下 updater 会执行两次，副作用会重复触发
          const nextPlaylists = playlistsRef.current.map((p) =>
            p.id === playlist.id ? updated : p
          );
          setPlaylists(nextPlaylists);
          playlistsRef.current = nextPlaylists;
          void saveAllPlaylistsToStorage(nextPlaylists);
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
    const target = playlistsRef.current.find((p) => p.id === playlistId);
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
      // 云端失败就不能只写本地：下次同步会把它冲掉，变成幽灵歌曲
      if (!cloudRes.success) {
        return { success: false, message: `云端加入失败: ${cloudRes.message}` };
      }
      cloudNotice = '，并已成功同步至酷狗账号！';
    }

    // 列表按倒序展示（最新在前），新歌追加到数组末尾才会出现在第一位
    const updatedSongs = [...target.songs, song];
    const updatedPlaylist: KuGouPlaylist = {
      ...target,
      songs: updatedSongs,
      totalSongs: updatedSongs.length,
      coverUrl: target.coverUrl || song.coverUrl,
    };

    const nextPlaylists = playlistsRef.current.map((p) =>
      p.id === playlistId ? updatedPlaylist : p
    );
    setPlaylists(nextPlaylists);
    playlistsRef.current = nextPlaylists;
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
    const target = playlistsRef.current.find((p) => p.id === playlistId);
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

    const nextPlaylists = playlistsRef.current.map((p) =>
      p.id === playlistId ? updatedPlaylist : p
    );
    setPlaylists(nextPlaylists);
    playlistsRef.current = nextPlaylists;
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
    selectSeqRef.current += 1;
    await deleteLocalPlaylist(id);
    await refreshPlaylists();
    if (activePlaylist?.id === id) {
      const remaining = playlistsRef.current.filter((p) => p.id !== id);
      setActivePlaylist(remaining.length > 0 ? remaining[0] : null);
    }
  };

  // ===== 键盘快捷键：空格 播放/暂停，←→ 快退/快进 5s，↑↓ 音量 =====
  // 另支持标准媒体键（车机方向盘 / 蓝牙媒体按键 / 部分键盘）：
  // MediaPlayPause / MediaTrackNext / MediaTrackPrevious / MediaStop
  // 监听只绑一次，具体动作从 actionsRef 取最新实现，进度从 store 现取，不会每帧解绑重绑
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // 焦点在输入类/可交互控件时不拦截按键：否则空格会同时触发按钮 click 和播放暂停
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.tagName === 'BUTTON' ||
          target.tagName === 'A' ||
          target.isContentEditable)
      ) {
        return;
      }
      // 长按重复事件与带修饰键的组合键（⌘/Ctrl/Alt）交给浏览器和系统
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;

      const actions = actionsRef.current;
      // 弹层打开时只让路给媒体键，空格/方向键交给弹层自己处理（overlayStack 会打这个标记）
      const overlayOpen = document.body.dataset.modal === '1';

      // 标准媒体键：不受「是否有当前歌曲」限制，切歌/清空队列后仍可响应
      switch (e.key) {
        case 'MediaPlayPause':
          e.preventDefault();
          actions.togglePlay();
          return;
        case 'MediaPlay':
          e.preventDefault();
          actions.play();
          return;
        case 'MediaPause':
          e.preventDefault();
          actions.pause();
          return;
        case 'MediaTrackNext':
          e.preventDefault();
          actions.next();
          return;
        case 'MediaTrackPrevious':
          e.preventDefault();
          actions.prev();
          return;
        case 'MediaStop':
          e.preventDefault();
          actions.pause();
          return;
      }

      if (!currentSongRef.current || overlayOpen) return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          actions.togglePlay();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          actions.seekBy(-5);
          break;
        case 'ArrowRight':
          e.preventDefault();
          actions.seekBy(5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          actions.nudgeVolume(0.05);
          break;
        case 'ArrowDown':
          e.preventDefault();
          actions.nudgeVolume(-0.05);
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
      // play / pause 各走各的语义：都调 togglePlay 会依赖闭包里的播放状态而反向
      ms.setActionHandler('play', () => actionsRef.current.play());
      ms.setActionHandler('pause', () => actionsRef.current.pause());
      ms.setActionHandler('stop', () => actionsRef.current.pause());
      ms.setActionHandler('previoustrack', () => actionsRef.current.prev());
      ms.setActionHandler('nexttrack', () => actionsRef.current.next());
      ms.setActionHandler('seekto', (d) => {
        if (d.seekTime != null) seek(d.seekTime);
      });
      // 不要注册 seekbackward / seekforward：macOS 控制中心会拿这对「快进快退」挤掉
      // 上一首 / 下一首，按钮位置变成两个圆弧箭头。
    } catch {
      // 当前平台不支持的 action 忽略
    }
  }, [seek]);

  // 渲染期安装动作表：上面绑定一次的监听都从这里取最新实现
  actionsRef.current = {
    play,
    pause,
    togglePlay,
    next: nextSong,
    prev: prevSong,
    seekBy: (delta: number) => {
      const { currentTime, duration } = playbackProgress.getSnapshot();
      const target = currentTime + delta;
      seek(delta < 0 ? Math.max(0, target) : duration > 0 ? Math.min(duration, target) : target);
    },
    // 调大音量时顺带解静音，否则静音状态下按 ↑ 毫无反应
    nudgeVolume: (delta: number) => {
      if (delta > 0 && isMutedRef.current) toggleMute();
      setVolume((isMutedRef.current ? 0 : volumeRef.current) + delta);
    },
  };

  // 高频进度不进主 Context：订阅请用 usePlaybackProgress()（嵌套 Provider 提供）
  return (
    <PlaybackProgressProvider seek={seek}>
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
    </PlaybackProgressProvider>
  );
};

export function usePlayer(): PlayerContextType {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error('usePlayer must be used within a PlayerProvider');
  }
  return context;
}
