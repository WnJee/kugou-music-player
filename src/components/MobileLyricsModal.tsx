/**
 * 移动端全屏歌词与播放弹窗 (src/components/MobileLyricsModal.tsx)
 * 点击移动端底部 Mini 播放条弹出全屏沉浸式页面
 */

import React, { useState } from 'react';
import {
  ChevronDown,
  Disc3,
  FastForward,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Rewind,
  Shuffle,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { LyricsScroller } from './LyricsScroller';

interface MobileLyricsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatTime(secs: number): string {
  if (!secs || isNaN(secs)) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const MobileLyricsModal: React.FC<MobileLyricsModalProps> = ({ isOpen, onClose }) => {
  const {
    currentSong,
    isPlaying,
    currentTime,
    duration,
    togglePlay,
    nextSong,
    prevSong,
    seek,
    volume,
    setVolume,
    isMuted,
    toggleMute,
    playMode,
    cyclePlayMode,
    lyrics,
    activeLyricIndex,
    audioSourceInfo,
    errorMsg,
    activePlaylist,
    playSong,
    queueSongs,
    clearQueue,
  } = usePlayer();

  // 播放列表面板（与桌面版队列功能对齐）
  const [isQueueOpen, setIsQueueOpen] = useState(false);

  if (!isOpen || !currentSong) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950/95 backdrop-blur-3xl text-white select-none animate-in fade-in slide-in-from-bottom duration-200">
      {/* 顶部收起栏 */}
      <div className="flex items-center justify-between px-5 pt-[calc(1rem+env(safe-area-inset-top))] pb-2 shrink-0">
        <button
          onClick={onClose}
          className="p-2 -ml-2 rounded-full hover:bg-white/10 active:scale-95 transition-transform"
        >
          <ChevronDown className="w-6 h-6 text-zinc-400" />
        </button>

        <div className="text-center flex-1 mx-4 min-w-0">
          <span className="text-[11px] font-medium text-cyan-400 uppercase tracking-widest block">
            正在播放
          </span>
          <span className="text-xs text-zinc-400 truncate block mt-0.5">
            {currentSong.singerName}
          </span>
        </div>

        <button
          onClick={() => setIsQueueOpen((v) => !v)}
          title="播放列表"
          className={`p-2 rounded-full transition-colors ${isQueueOpen ? 'text-cyan-400 bg-white/10' : 'text-zinc-400 hover:bg-white/10'}`}
        >
          <ListMusic className="w-6 h-6" />
        </button>
      </div>

      {/* 中部旋转黑胶与歌词 */}
      <div className="flex-1 flex flex-col items-center justify-between px-6 py-4 overflow-hidden">
        {/* 封面黑胶 */}
        <div className="relative w-44 h-44 rounded-full p-2 bg-gradient-to-tr from-zinc-900 to-black border border-white/10 shadow-2xl flex items-center justify-center shrink-0 my-2">
          <div
            className={`w-28 h-28 rounded-full overflow-hidden shadow-inner ${
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
              <div className="w-full h-full bg-zinc-800 flex items-center justify-center">
                <Disc3 className="w-12 h-12 text-zinc-600" />
              </div>
            )}
          </div>
          <div className="absolute w-4 h-4 rounded-full bg-zinc-950 border-2 border-white/30" />
        </div>

        {/* 歌曲信息与音源标识 */}
        <div className="text-center my-2">
          <h2 className="text-lg font-bold text-white truncate max-w-xs">{currentSong.songName}</h2>
          <div className="mt-1">
            {audioSourceInfo?.source === 'primary' ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-semibold">
                官方 VIP 主轨
              </span>
            ) : audioSourceInfo?.source === 'fallback' ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-semibold">
                备轨 Fallback
              </span>
            ) : null}
          </div>
          {(errorMsg || audioSourceInfo?.msg) && (
            <p
              className={`mt-2 max-w-xs text-[11px] leading-5 line-clamp-2 ${
                errorMsg ? 'text-red-400' : 'text-amber-300/90'
              }`}
            >
              {errorMsg || audioSourceInfo?.msg}
            </p>
          )}
        </div>

        {/* 滚动歌词区域（transform 位移滚动，丝滑无回弹） */}
        <LyricsScroller
          containerClassName="w-full flex-1 px-4 py-6 mask-gradient"
          lyrics={lyrics}
          activeIndex={activeLyricIndex}
          onSeek={seek}
          activeClassName="text-[15px] leading-7 font-bold text-cyan-300 scale-110 drop-shadow-[0_0_12px_rgba(34,211,238,0.6)]"
          idleClassName="text-[15px] leading-7 text-zinc-500"
        />
      </div>

      {/* 底部播放进度条与大控制按钮 */}
      <div className="px-6 pt-2 shrink-0 bg-zinc-950/80 pb-[max(2rem,env(safe-area-inset-bottom))]">
        {/* 进度条 */}
        <div className="mb-4">
          <input
            type="range"
            min={0}
            max={duration || 100}
            value={currentTime}
            onChange={(e) => seek(Number(e.target.value))}
            className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none"
          />
          <div className="flex justify-between text-[11px] font-mono text-zinc-400 mt-1">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* 播放控制按钮 */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={cyclePlayMode} className="p-2 text-zinc-400 hover:text-white">
            {playMode === 'loop' && <Repeat className="w-5 h-5 text-cyan-400" />}
            {playMode === 'single' && <Repeat1 className="w-5 h-5 text-cyan-400" />}
            {playMode === 'random' && <Shuffle className="w-5 h-5 text-cyan-400" />}
            {playMode === 'sequence' && <Repeat className="w-5 h-5 text-zinc-500" />}
          </button>

          <div className="flex items-center gap-6">
            <button
              onClick={prevSong}
              className="p-3 text-zinc-300 hover:text-white active:scale-95 transition-transform"
            >
              <Rewind className="w-6 h-6 fill-current" />
            </button>

            <button
              onClick={togglePlay}
              className="w-14 h-14 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 text-white flex items-center justify-center shadow-xl shadow-cyan-500/25 active:scale-90 transition-transform"
            >
              {isPlaying ? (
                <Pause className="w-6 h-6 fill-current" />
              ) : (
                <Play className="w-6 h-6 fill-current ml-0.5" />
              )}
            </button>

            <button
              onClick={nextSong}
              className="p-3 text-zinc-300 hover:text-white active:scale-95 transition-transform"
            >
              <FastForward className="w-6 h-6 fill-current" />
            </button>
          </div>

          <button onClick={toggleMute} className="p-2 text-zinc-400 hover:text-white">
            {isMuted || volume === 0 ? (
              <VolumeX className="w-5 h-5 text-red-400" />
            ) : (
              <Volume2 className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>

      {/* 播放列表面板（底部抽屉） */}
      {isQueueOpen && (
        <div className="fixed inset-0 z-60" onClick={() => setIsQueueOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            onClick={(e) => e.stopPropagation()}
            className="absolute left-0 right-0 bottom-0 max-h-[65vh] bg-zinc-900 border-t border-white/10 rounded-t-2xl flex flex-col animate-in slide-in-from-bottom duration-200 pb-[env(safe-area-inset-bottom)]"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <ListMusic className="w-4 h-4 text-cyan-400 shrink-0" />
                <h3 className="text-sm font-bold text-white truncate">
                  {activePlaylist ? activePlaylist.name : '播放列表'}
                </h3>
                <span className="text-[11px] text-zinc-500 shrink-0">
                  {queueSongs.length} 首
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={clearQueue}
                  disabled={queueSongs.length === 0}
                  title="清空播放列表"
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-white/[0.04] hover:bg-red-500/15 hover:text-red-300 disabled:opacity-40 disabled:hover:bg-white/[0.04] text-[11px] text-zinc-400 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>清空</span>
                </button>
                <button
                  onClick={() => setIsQueueOpen(false)}
                  className="text-zinc-500 hover:text-white text-xs p-1"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {queueSongs.length === 0 ? (
                <div className="py-10 text-center text-xs text-zinc-500">播放列表为空</div>
              ) : (
                queueSongs.map((song, idx) => {
                  const isCur = currentSong?.hash === song.hash;
                  return (
                    <div
                      key={`${song.hash}-${idx}`}
                      onClick={() => playSong(song, activePlaylist || undefined)}
                      className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                        isCur
                          ? 'bg-cyan-500/10 text-cyan-300'
                          : 'text-zinc-400 active:bg-white/[0.06]'
                      }`}
                    >
                      <span className="w-5 text-[11px] font-mono tabular-nums text-zinc-600 shrink-0 text-right">
                        {isCur && isPlaying ? '♪' : idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h4 className={`text-xs truncate ${isCur ? 'text-cyan-400 font-semibold' : ''}`}>
                          {song.songName}
                        </h4>
                        <p className="text-[10px] text-zinc-500 truncate">{song.singerName}</p>
                      </div>
                      <span className="text-[10px] font-mono text-zinc-600 shrink-0 tabular-nums">
                        {formatTime(song.duration)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
