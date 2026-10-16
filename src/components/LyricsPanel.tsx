/**
 * 实时滚动歌词面板 (src/components/LyricsPanel.tsx)
 * 适配平板横屏与桌面端右侧区域，展示黑胶动效、主备音轨标识与自动滚动歌词
 */

import React from 'react';
import { Disc3, Music } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { LyricsScroller } from './LyricsScroller';

export const LyricsPanel: React.FC = () => {
  const { currentSong, isPlaying, lyrics, activeLyricIndex, seek, audioSourceInfo } = usePlayer();

  if (!currentSong) {
    return (
      <aside className="hidden lg:flex flex-col w-80 h-full bg-zinc-900/40 backdrop-blur-2xl border-l border-white/10 p-6 shrink-0 items-center justify-center text-center select-none">
        <Disc3 className="w-16 h-16 text-zinc-700 mb-3 animate-spin-slow stroke-[1]" />
        <h3 className="text-sm font-medium text-zinc-400">暂无曲目播放</h3>
        <p className="text-xs text-zinc-600 mt-1">从歌单中选择歌曲开启听歌体验</p>
      </aside>
    );
  }

  return (
    <aside className="hidden lg:flex flex-col w-80 xl:w-96 h-full bg-zinc-900/40 backdrop-blur-2xl border-l border-white/10 p-6 shrink-0 select-none overflow-hidden">
      {/* 顶部黑胶唱片视觉 */}
      <div className="flex flex-col items-center mb-6 shrink-0">
        <div className="relative w-36 h-36 rounded-full p-2 bg-gradient-to-tr from-zinc-900 via-black to-zinc-800 shadow-2xl shadow-cyan-500/10 border border-white/10 flex items-center justify-center mb-4">
          {/* 黑胶螺纹线条背景 */}
          <div className="absolute inset-3 rounded-full border border-white/5" />
          <div className="absolute inset-6 rounded-full border border-white/5" />

          {/* 旋转唱片芯 */}
          <div
            className={`w-20 h-20 rounded-full overflow-hidden shadow-inner ${
              isPlaying ? 'animate-spin-slow' : ''
            }`}
          >
            {currentSong.coverUrl ? (
              <img
                src={currentSong.coverUrl}
                alt={currentSong.songName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-zinc-800 flex items-center justify-center text-zinc-600">
                <Music className="w-8 h-8" />
              </div>
            )}
          </div>

          {/* 中心唱针小孔 */}
          <div className="absolute w-4 h-4 rounded-full bg-zinc-900 border-2 border-white/20" />
        </div>

        {/* 歌曲信息与双轨音源标识 */}
        <h2 className="text-sm font-bold text-white truncate max-w-[240px]">
          {currentSong.songName}
        </h2>
        <p className="text-xs text-zinc-400 truncate max-w-[200px] mt-0.5">
          {currentSong.singerName}
        </p>

        {/* 音轨标识徽章 */}
        <div className="mt-2.5">
          {audioSourceInfo?.source === 'primary' ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              酷狗官方 VIP 主轨 ({audioSourceInfo.bitrate || 128}k)
            </span>
          ) : audioSourceInfo?.source === 'fallback' ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              免登录备轨 Fallback
            </span>
          ) : null}
        </div>
      </div>

      {/* 实时滚动歌词区域（transform 位移滚动，丝滑无回弹） */}
      <LyricsScroller
        containerClassName="flex-1 px-2 py-8 mask-gradient"
        lyrics={lyrics}
        activeIndex={activeLyricIndex}
        onSeek={seek}
        activeClassName="text-[13px] leading-6 font-bold text-cyan-300 scale-110 drop-shadow-[0_0_12px_rgba(34,211,238,0.5)]"
        idleClassName="text-[13px] leading-6 text-zinc-500 hover:text-zinc-300"
      />
    </aside>
  );
};
