/**
 * 播放进度（当前位置 / 总时长）独立上下文 (src/context/PlaybackProgress.tsx)
 *
 * 进度是每秒更新数次的高频数据。若它与播放器主状态放在同一个 Context 里，
 * 每次 timeupdate 都会让所有 usePlayer() 消费者重渲染，因此拆成独立的最小 store + 嵌套 Provider：
 * - PlayerProvider 只负责把媒体元素的时间变化写进 store（纯函数调用，不触发自身重渲染）
 * - 需要进度的组件通过 usePlaybackProgress() 订阅，只重渲染自己
 */

import React, { createContext, useContext, useMemo, useSyncExternalStore } from 'react';

export interface PlaybackProgressSnapshot {
  /** 当前播放位置（秒） */
  currentTime: number;
  /** 当前音轨总时长（秒），未知时为 0 */
  duration: number;
}

export interface PlaybackProgressValue extends PlaybackProgressSnapshot {
  /** 跳转到指定位置（秒），复用播放器主流程的拖进度逻辑 */
  seek: (time: number) => void;
}

const EMPTY: PlaybackProgressSnapshot = { currentTime: 0, duration: 0 };

/** 快照对象整体替换，引用不变即数据不变，可直接作为 useSyncExternalStore 的 getSnapshot */
let snapshot: PlaybackProgressSnapshot = EMPTY;
const listeners = new Set<() => void>();

function emit(next: PlaybackProgressSnapshot) {
  if (next.currentTime === snapshot.currentTime && next.duration === snapshot.duration) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

export const playbackProgress = {
  /** 读取最新进度快照（不订阅，适合在事件回调里取值） */
  getSnapshot: (): PlaybackProgressSnapshot => snapshot,
  /** 订阅进度变化，返回取消订阅函数 */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** 局部更新进度：只传变化的字段 */
  update(patch: Partial<PlaybackProgressSnapshot>) {
    emit({ ...snapshot, ...patch });
  },
  /** 切歌 / 清空队列时归零 */
  reset() {
    emit(EMPTY);
  },
};

const PlaybackProgressContext = createContext<PlaybackProgressValue | null>(null);

export const PlaybackProgressProvider: React.FC<{
  /** 与主 Provider 共用同一个 seek 实现（稳定引用） */
  seek: (time: number) => void;
  children: React.ReactNode;
}> = ({ seek, children }) => {
  const current = useSyncExternalStore(
    playbackProgress.subscribe,
    playbackProgress.getSnapshot,
    playbackProgress.getSnapshot
  );
  const value = useMemo<PlaybackProgressValue>(
    () => ({ currentTime: current.currentTime, duration: current.duration, seek }),
    [current, seek]
  );
  return (
    <PlaybackProgressContext.Provider value={value}>{children}</PlaybackProgressContext.Provider>
  );
};

export function usePlaybackProgress(): PlaybackProgressValue {
  const context = useContext(PlaybackProgressContext);
  if (!context) {
    throw new Error('usePlaybackProgress must be used within a PlayerProvider');
  }
  return context;
}
