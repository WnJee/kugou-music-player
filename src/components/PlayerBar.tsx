/**
 * 底部播放控制条组件 (src/components/PlayerBar.tsx)
 * 桌面端/平板呈现固定底栏，移动端呈现底部悬浮 Mini 播放条
 */

import React, { useState } from 'react';
import {
  FastForward,
  ListMusic,
  Music,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Rewind,
  Shuffle,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { MobileLyricsModal } from './MobileLyricsModal';

function formatTime(secs: number): string {
  if (!secs || isNaN(secs)) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const PlayerBar: React.FC = () => {
  const [isQueueOpen, setIsQueueOpen] = useState(false);
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
    audioSourceInfo,
    activePlaylist,
    playSong,
  } = usePlayer();

  const [isMobileModalOpen, setIsMobileModalOpen] = useState(false);

  if (!currentSong) return null;

  return (
    <>
      {/* 1. 移动端悬浮 Mini 播放条 (< md 断点) */}
      <div
        onClick={() => setIsMobileModalOpen(true)}
        className="lg:hidden fixed bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-3 right-3 z-30 flex items-center justify-between p-2.5 rounded-2xl bg-zinc-900/95 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-black/80 cursor-pointer active:scale-[0.99] transition-transform select-none"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1 mr-3">
          <div className="relative w-10 h-10 rounded-xl overflow-hidden shrink-0 bg-zinc-800 border border-white/10">
            {currentSong.coverUrl ? (
              <img
                src={currentSong.coverUrl}
                alt={currentSong.songName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-zinc-500">
                <Music className="w-5 h-5" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h4 className="text-xs font-semibold text-white truncate">{currentSong.songName}</h4>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="text-[11px] text-zinc-400 truncate">{currentSong.singerName}</span>
              {audioSourceInfo?.source === 'fallback' && (
                <span className="px-1.5 py-0.2 rounded text-[9px] bg-amber-500/20 text-amber-300">
                  备轨
                </span>
              )}
            </div>
          </div>
        </div>

        {/* 移动端快捷播放控制 */}
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={togglePlay}
            className="w-9 h-9 rounded-full bg-cyan-500 text-white flex items-center justify-center shadow-lg shadow-cyan-500/30 active:scale-95 transition-transform"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-white" />
            ) : (
              <Play className="w-4 h-4 fill-white ml-0.5" />
            )}
          </button>
          <button
            onClick={nextSong}
            className="p-2 text-zinc-400 hover:text-white active:scale-95 transition-transform"
          >
            <FastForward className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* 2. 桌面端 / 平板底部固定全功能播放栏 (>= md 断点) */}
      <footer className="hidden lg:flex items-center justify-between h-20 px-6 bg-zinc-950/80 backdrop-blur-2xl border-t border-white/10 shrink-0 z-30 select-none">
        {/* 左侧：曲目信息与音轨标识 */}
        <div className="flex items-center gap-3.5 w-1/4 min-w-[200px]">
          <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-zinc-800 border border-white/10 shadow-md">
            {currentSong.coverUrl ? (
              <img
                src={currentSong.coverUrl}
                alt={currentSong.songName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-zinc-600">
                <Music className="w-6 h-6" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h4 className="text-xs font-semibold text-white truncate">{currentSong.songName}</h4>
            <p className="text-[11px] text-zinc-400 truncate mt-0.5">{currentSong.singerName}</p>
            <div className="mt-1">
              {audioSourceInfo?.source === 'primary' ? (
                <span className="inline-block px-1.5 py-0.2 rounded text-[9px] bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-medium">
                  官方主轨 ({audioSourceInfo.bitrate || 128}k)
                </span>
              ) : audioSourceInfo?.source === 'fallback' ? (
                <span className="inline-block px-1.5 py-0.2 rounded text-[9px] bg-amber-500/10 border border-amber-500/20 text-amber-400 font-medium">
                  备轨 Fallback
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* 中间：播放主控制区与进度条 */}
        <div className="flex flex-col items-center justify-center w-2/4 max-w-xl px-4">
          {/* 控制按钮组 */}
          <div className="flex items-center gap-5 mb-1.5">
            <button
              onClick={cyclePlayMode}
              title={`当前模式: ${playMode}`}
              className="p-1.5 text-zinc-400 hover:text-white transition-colors"
            >
              {playMode === 'loop' && <Repeat className="w-4 h-4 text-cyan-400" />}
              {playMode === 'single' && <Repeat1 className="w-4 h-4 text-cyan-400" />}
              {playMode === 'random' && <Shuffle className="w-4 h-4 text-cyan-400" />}
              {playMode === 'sequence' && <Repeat className="w-4 h-4 text-zinc-500" />}
            </button>

            <button
              onClick={prevSong}
              className="p-1.5 text-zinc-300 hover:text-white active:scale-95 transition-transform"
            >
              <Rewind className="w-4 h-4 fill-current" />
            </button>

            <button
              onClick={togglePlay}
              className="w-10 h-10 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 text-white flex items-center justify-center shadow-lg shadow-cyan-500/25 active:scale-95 transition-transform"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-white" />
              ) : (
                <Play className="w-4 h-4 fill-white ml-0.5" />
              )}
            </button>

            <button
              onClick={nextSong}
              className="p-1.5 text-zinc-300 hover:text-white active:scale-95 transition-transform"
            >
              <FastForward className="w-4 h-4 fill-current" />
            </button>
          </div>

          {/* 进度拖拽条与时间戳 */}
          <div className="w-full flex items-center gap-3">
            <span className="text-[11px] font-mono text-zinc-400 shrink-0 w-9 text-right">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={(e) => seek(Number(e.target.value))}
              className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none"
            />
            <span className="text-[11px] font-mono text-zinc-400 shrink-0 w-9">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* 右侧：音量与辅助工具 */}
        <div className="flex items-center justify-end gap-3 w-1/4 min-w-[160px]">
          <button onClick={toggleMute} className="text-zinc-400 hover:text-white transition-colors">
            {isMuted || volume === 0 ? (
              <VolumeX className="w-4 h-4 text-red-400" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={isMuted ? 0 : volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            className="w-20 h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-cyan-400 focus:outline-none"
          />
          <button
            onClick={() => setIsQueueOpen((v) => !v)}
            title="播放列表"
            className={`p-1.5 rounded-lg transition-colors ${
              isQueueOpen ? 'bg-cyan-500/15 text-cyan-400' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <ListMusic className="w-4 h-4" />
          </button>
        </div>
      </footer>

      {/* 播放列表面板 */}
      {isQueueOpen && (
        <div className="hidden lg:flex flex-col absolute right-4 bottom-24 w-96 max-h-[60vh] z-40 rounded-2xl bg-zinc-900/95 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-black/80 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <ListMusic className="w-4 h-4 text-cyan-400 shrink-0" />
              <h3 className="text-xs font-bold text-white truncate">
                {activePlaylist ? activePlaylist.name : '播放列表'}
              </h3>
              <span className="text-[11px] text-zinc-500 shrink-0">
                {activePlaylist?.songs.length || 0} 首
              </span>
            </div>
            <button
              onClick={() => setIsQueueOpen(false)}
              className="text-zinc-500 hover:text-white text-xs shrink-0"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {!activePlaylist || activePlaylist.songs.length === 0 ? (
              <div className="py-10 text-center text-xs text-zinc-500">播放列表为空</div>
            ) : (
              activePlaylist.songs.map((song, idx) => {
                const isCur = currentSong?.hash === song.hash;
                return (
                  <div
                    key={`${song.hash}-${idx}`}
                    onClick={() => playSong(song)}
                    className={`flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors ${
                      isCur
                        ? 'bg-cyan-500/10 text-cyan-300'
                        : 'text-zinc-400 hover:bg-white/[0.05] hover:text-white'
                    }`}
                  >
                    <span className="w-5 text-[11px] font-mono tabular-nums text-zinc-600 shrink-0 text-right">
                      {idx + 1}
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
      )}

      {/* 移动端全屏弹窗 */}
      <MobileLyricsModal isOpen={isMobileModalOpen} onClose={() => setIsMobileModalOpen(false)} />
    </>
  );
};
