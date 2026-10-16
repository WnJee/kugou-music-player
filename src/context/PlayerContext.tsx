/**
 * 全局播放器状态管理上下文 (src/context/PlayerContext.tsx)
 */

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { AudioSourceResult, KuGouPlaylist, KuGouSong, LyricLine, PlayMode, UserSettings } from '../types/music';
import { getUserSettings, resolveAudioSource, tryAutoCheckin } from '../services/audioSource';
import {
  deleteLocalPlaylist,
  getLocalPlaylists,
  saveAllPlaylistsToStorage,
  fetchUserCloudPlaylists,
  fetchUserCloudPlaylistTracks,
  addSongToUserCloudPlaylist,
} from '../services/kugouPlaylist';
import { fetchSongLyrics } from '../services/lyrics';

interface PlayerContextType {
  // 用户设置与登录态
  userSettings: UserSettings | null;
  refreshUserSettings: () => Promise<void>;

  // 歌单状态
  playlists: KuGouPlaylist[];
  activePlaylist: KuGouPlaylist | null;
  selectPlaylist: (playlist: KuGouPlaylist) => Promise<void>;
  deletePlaylistById: (id: string) => Promise<void>;
  refreshPlaylists: () => Promise<void>;
  isSyncingCloud: boolean;
  syncCloudPlaylists: () => Promise<void>;
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

  // 歌词状态
  lyrics: LyricLine[];
  activeLyricIndex: number;

  // 控制动作
  playSong: (song: KuGouSong, playlist?: KuGouPlaylist) => Promise<void>;
  togglePlay: () => void;
  nextSong: () => void;
  prevSong: () => void;
  seek: (time: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  cyclePlayMode: () => void;
}

const PlayerContext = createContext<PlayerContextType | null>(null);

export const PlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [playlists, setPlaylists] = useState<KuGouPlaylist[]>([]);
  const [activePlaylist, setActivePlaylist] = useState<KuGouPlaylist | null>(null);

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

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.pause();
    };
  }, []);

  // 刷新用户配置状态
  const refreshUserSettings = useCallback(async () => {
    const settings = await getUserSettings();
    setUserSettings(settings);
  }, []);

  const [isSyncingCloud, setIsSyncingCloud] = useState<boolean>(false);

  // 刷新本地歌单列表
  const refreshPlaylists = useCallback(async () => {
    const list = await getLocalPlaylists();
    setPlaylists(list);
    if (!activePlaylist && list.length > 0) {
      setActivePlaylist(list[0]);
    } else if (activePlaylist) {
      const updated = list.find((p) => p.id === activePlaylist.id);
      if (updated) setActivePlaylist(updated);
    }
  }, [activePlaylist]);

  // 同步用户账号下的云端歌单
  const syncCloudPlaylists = useCallback(async () => {
    const settings = await getUserSettings();
    if (!settings.kugouToken || !settings.kugouUserId) return;

    setIsSyncingCloud(true);
    try {
      const cloudLists = await fetchUserCloudPlaylists(settings.kugouToken, settings.kugouUserId);
      if (cloudLists.length > 0) {
        const localList = await getLocalPlaylists();
        const importedOnly = localList.filter((p) => !p.isUserOwned);

        const mergedCloud = cloudLists.map((cloudP) => {
          const cached = localList.find((p) => p.id === cloudP.id);
          if (cached && cached.songs.length > 0) {
            return {
              ...cloudP,
              songs: cached.songs,
              totalSongs: cached.songs.length || cloudP.totalSongs,
            };
          }
          return cloudP;
        });

        const all = [...mergedCloud, ...importedOnly];
        await saveAllPlaylistsToStorage(all);
        setPlaylists(all);

        if (!activePlaylist && all.length > 0) {
          setActivePlaylist(all[0]);
        }
      }
    } catch (err) {
      console.error('[syncCloudPlaylists] 同步失败:', err);
    } finally {
      setIsSyncingCloud(false);
    }
  }, [activePlaylist]);

  // 应用启动时拉取歌单与用户配置，并自动同步云端歌单
  useEffect(() => {
    refreshPlaylists();
    refreshUserSettings().then(async () => {
      const settings = await getUserSettings();
      if (settings.kugouToken && settings.kugouUserId) {
        syncCloudPlaylists();
      }
    });
    tryAutoCheckin().catch(() => {});
  }, [refreshPlaylists, refreshUserSettings, syncCloudPlaylists]);

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
  const playSong = async (song: KuGouSong, playlist?: KuGouPlaylist) => {
    const targetPlaylist = playlist || activePlaylist;
    if (targetPlaylist && (!activePlaylist || activePlaylist.id !== targetPlaylist.id)) {
      setActivePlaylist(targetPlaylist);
    }

    setCurrentSong(song);
    setErrorMsg(null);
    setIsLoadingAudio(true);
    setAudioSourceInfo(null);
    setCurrentTime(0);

    // 异步拉取歌词
    fetchSongLyrics(song).then((lines) => setLyrics(lines));

    try {
      const sourceResult = await resolveAudioSource(song);
      setAudioSourceInfo(sourceResult);

      if (audioRef.current) {
        audioRef.current.src = sourceResult.url;
        await audioRef.current.play();
        setIsPlaying(true);
      }
    } catch (err: unknown) {
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

  // 获取下一曲索引
  const getNextSongIndex = useCallback((): number => {
    if (!activePlaylist || activePlaylist.songs.length === 0 || !currentSong) return -1;
    const currentIndex = activePlaylist.songs.findIndex((s) => s.hash === currentSong.hash);
    const total = activePlaylist.songs.length;

    if (playMode === 'random') {
      let rand = Math.floor(Math.random() * total);
      if (rand === currentIndex && total > 1) {
        rand = (rand + 1) % total;
      }
      return rand;
    }
    return (currentIndex + 1) % total;
  }, [activePlaylist, currentSong, playMode]);

  // 下一曲
  const nextSong = useCallback(() => {
    if (!activePlaylist || activePlaylist.songs.length === 0) return;
    const nextIdx = getNextSongIndex();
    if (nextIdx >= 0) {
      playSong(activePlaylist.songs[nextIdx]);
    }
  }, [activePlaylist, getNextSongIndex]);

  // 上一曲
  const prevSong = () => {
    if (!activePlaylist || activePlaylist.songs.length === 0 || !currentSong) return;
    const currentIndex = activePlaylist.songs.findIndex((s) => s.hash === currentSong.hash);
    const total = activePlaylist.songs.length;
    const prevIdx = (currentIndex - 1 + total) % total;
    playSong(activePlaylist.songs[prevIdx]);
  };

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
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
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
      playlist.songs.length === 0 &&
      userSettings?.kugouToken &&
      userSettings?.kugouUserId
    ) {
      try {
        const tracks = await fetchUserCloudPlaylistTracks(
          playlist.listId,
          userSettings.kugouToken,
          userSettings.kugouUserId
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
        userSettings.kugouUserId
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

  return (
    <PlayerContext.Provider
      value={{
        userSettings,
        refreshUserSettings,

        playlists,
        activePlaylist,
        selectPlaylist,
        deletePlaylistById,
        refreshPlaylists,
        isSyncingCloud,
        syncCloudPlaylists,
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

        lyrics,
        activeLyricIndex,

        playSong,
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
