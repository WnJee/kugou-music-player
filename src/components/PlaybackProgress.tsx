/**
 * 播放进度区 (src/components/PlaybackProgress.tsx)
 *
 * 全仓唯一订阅 usePlaybackProgress 的组件：timeupdate 每秒数次，
 * 只让这一小块跟着刷新，播放条、播放页、歌单列表都不再因进度重渲染。
 * variant="bar" 桌面底栏一行，variant="mobile" 移动端播放页的轨道 + 双侧时间。
 */

import React from 'react';
import { usePlaybackProgress } from '../context/PlayerContext';
import { SeekBar } from './SeekBar';
import { formatTime } from './playbackTime';

interface PlaybackProgressProps {
  variant?: 'bar' | 'mobile';
}

export const PlaybackProgress: React.FC<PlaybackProgressProps> = ({ variant = 'bar' }) => {
  const { currentTime, duration, seek } = usePlaybackProgress();

  if (variant === 'mobile') {
    const remaining = Math.max(0, (duration || 0) - currentTime);
    return (
      <>
        <SeekBar value={currentTime} max={duration} onChange={seek} large label="播放进度" />
        <div className="flex items-center justify-between" style={{ marginTop: 2 }}>
          <span className="bar-times">{formatTime(currentTime)}</span>
          <span className="bar-times">−{formatTime(remaining)}</span>
        </div>
      </>
    );
  }

  return (
    <div className="mt-1 flex w-full max-w-[420px] items-center gap-2.5">
      <span className="bar-times" style={{ width: 34, textAlign: 'right' }}>
        {formatTime(currentTime)}
      </span>
      <SeekBar value={currentTime} max={duration} onChange={seek} label="播放进度" />
      <span className="bar-times" style={{ width: 34 }}>
        {formatTime(duration)}
      </span>
    </div>
  );
};
