/**
 * 全局播放器状态管理上下文 (src/context/PlayerContext.tsx)
 */

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { AudioSourceResult, KuGouPlaylist, KuGouSong, LyricLine, PlayMode, UserSettings } from '../types/music';
import {
  fetchConceptVipStatus,
  getUserSettings,
  resolveAudioSource,
  tryAutoCheckin,
  keepTokenAlive,
} from '../services/audioSource';
import {
  deleteLocalPlaylist,
  getLocalPlaylists,
  saveAllPlaylistsToStorage,
  fetchUserCloudPlaylists,
  fetchUserCloudPlaylistTracks,
  addSongToUserCloudPlaylist,
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

  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [activeLyricIndex, setActiveLyricIndex] = useState<number>(-1);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playRequestIdRef = useRef(0);
  // 恢复上次播放进度时暂存的目标位置，待音频元数据加载完成后定位
  const pendingSeekRef = useRef<number | null>(null);
  // 初始化 Audio 实例
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    audio.volume = volume;

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };

    const onDurationChange = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setIsLoadingAudio(true);
    const onPlaying = () => setIsLoadingAudio(false);
    // 恢复上次播放进度：待元数据加载完成后定位
    const onLoadedMetadata = () => {
      if (pendingSeekRef.current != null) {
        const target = pendingSeekRef.current;
        pendingSeekRef.current = null;
        if (isFinite(audio.duration) && target < audio.duration) {
          audio.currentTime = target;
          setCurrentTime(target);
        }
      }
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.pause();
    };
  }, []);

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
  const playSong = async (song: KuGouSong, opts?: { insertFront?: boolean }) => {
    const requestId = ++playRequestIdRef.current;

    // 维护独立播放队列：队列中不存在时按需插入
    // （搜索结果插到最前面，其余场景追加到末尾；已存在则直接播放不重复添加）
    setQueue((prev) => {
      if (prev.some((s) => s.hash && s.hash === song.hash)) return prev;
      return opts?.insertFront ? [song, ...prev] : [...prev, song];
    });

    // 先停掉并卸载旧音源，避免新歌解析失败时继续播放上一首。
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }

    setCurrentSong(song);
    setErrorMsg(null);
    setIsLoadingAudio(true);
    setAudioSourceInfo(null);
    setCurrentTime(0);
    setDuration(0);
    setLyrics([]);

    // 异步拉取歌词
    fetchSongLyrics(song).then((lines) => setLyrics(lines));

    try {
      const sourceResult = await resolveAudioSource(song);
      if (playRequestIdRef.current !== requestId) return;
      setAudioSourceInfo(sourceResult);

      if (audioRef.current) {
        audioRef.current.src = sourceResult.url;
        await audioRef.current.play().then(() => {
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
    } finally {
      setIsLoadingAudio(false);
    }
  };

  const togglePlay = () => {
    if (!audioRef.current || !currentSong) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play().catch((e) => console.warn('播放恢复受阻:', e));
    }
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

  // 监听歌曲自然播放结束
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onEnded = () => {
      if (playMode === 'single') {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      } else {
        nextSong();
      }
    };

    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [playMode, nextSong]);

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

    const updatedSongs = [song, ...target.songs];
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
      ms.setActionHandler('seekbackward', () => seek(Math.max(0, currentTime - 10)));
      ms.setActionHandler('seekforward', () => seek(Math.min(duration || 0, currentTime + 10)));
    } catch {
      // 当前平台不支持的 action 忽略
    }
  }, [currentSong, togglePlay, prevSong, nextSong, seek, currentTime, duration]);

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
