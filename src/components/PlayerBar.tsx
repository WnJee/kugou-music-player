/**
 * 底部播放控制条 (src/components/PlayerBar.tsx)
 * 桌面：三区底栏（曲目资料 / 主控 / 音量与队列），主键用墨底反白而不是彩色渐变
 * 移动：单张卡片式 Mini 条，热区 ≥44px，避开底部安全区
 */

import React, { useState } from 'react';
import {
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { MobileLyricsModal } from './MobileLyricsModal';
import type { PlayMode } from '../types/music';

function formatTime(secs: number): string {
  if (!secs || isNaN(secs)) return '0:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const MODE_LABEL: Record<PlayMode, string> = {
  sequence: '顺序播放',
  loop: '列表循环',
  single: '单曲循环',
  random: '随机播放',
};

const ModeIcon: React.FC<{ mode: PlayMode; size?: number }> = ({ mode, size = 15 }) => {
  const common = { size, strokeWidth: 1.7 };
  if (mode === 'single') return <Repeat1 {...common} />;
  if (mode === 'random') return <Shuffle {...common} />;
  return <Repeat {...common} />;
};

/**
 * 播放进度
 * 原生的 range 轨道伪元素在 WebKit 里无法稳定接收 CSS 变量做渐变填充，
 * 所以这里分离成「可见的轨道（自己画）+ 透明的原生 input（只负责交互）」。
 * 好处：填充、缓冲、hover 手柄都能精确控制，且完全不牺牲键盘与无障碍。
 */
const SeekBar: React.FC<{
  value: number;
  max: number;
  onChange: (v: number) => void;
  large?: boolean;
  label: string;
}> = ({ value, max, onChange, large, label }) => {
  const safeMax = max > 0 ? max : 100;
  const pct = Math.min(100, Math.max(0, (value / safeMax) * 100));
  return (
    <div className={`seek ${large ? 'seek-lg' : ''}`}>
      <div className="seek-track" aria-hidden>
        <div className="seek-fill" style={{ width: `${pct}%` }} />
      </div>
      <input
        type="range"
        min={0}
        max={safeMax}
        step={0.1}
        value={Math.min(value, safeMax)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="seek-input"
        aria-label={label}
      />
    </div>
  );
};

export const PlayerBar: React.FC = () => {
  const [isQueueOpen, setIsQueueOpen] = useState(false);
  const [isMobileModalOpen, setIsMobileModalOpen] = useState(false);
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
    errorMsg,
    playSong,
    queueSongs,
    clearQueue,
  } = usePlayer();

  if (!currentSong) return null;

  const VolIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  const queueList = (
    <div className="flex-1 overflow-y-auto">
      {queueSongs.length === 0 ? (
        <div className="empty" style={{ padding: '36px 18px', maxWidth: 'none' }}>
          <p className="empty-title" style={{ fontSize: 'var(--fs-4)' }}>
            队列是空的
          </p>
          <p className="empty-body" style={{ marginTop: 6, fontSize: 'var(--fs-2)' }}>
            从歌单里点任意一首歌就会填进来。
          </p>
        </div>
      ) : (
        queueSongs.map((song, idx) => {
          const isCur = currentSong?.hash === song.hash;
          return (
            <button
              key={`${song.hash}-${idx}`}
              type="button"
              onClick={() => playSong(song)}
              className="row"
              data-playing={isCur}
              style={{ gridTemplateColumns: '26px minmax(0,1fr) 46px', width: '100%' }}
            >
              <span className="row-idx">
                {isCur && isPlaying ? (
                  <span className="bars">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  <span className="mono">{String(idx + 1).padStart(2, '0')}</span>
                )}
              </span>
              <span className="min-w-0">
                <span className="row-title block">{song.songName}</span>
                <span className="row-sub block">{song.singerName}</span>
              </span>
              <span className="row-time">{formatTime(song.duration)}</span>
            </button>
          );
        })
      )}
    </div>
  );

  return (
    <>
      {/* ===== 1. 移动端 Mini 播放条 ===== */}
      <div className="bar-mobile-shell lg:hidden">
        <div className="bar-mobile">
          <button
            type="button"
            onClick={() => setIsMobileModalOpen(true)}
            className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            aria-label="打开播放页"
          >
            {currentSong.coverUrl ? (
              <img
                src={currentSong.coverUrl}
                alt=""
                className="shrink-0 object-cover"
                style={{ width: 42, height: 42, borderRadius: 'var(--r-1)' }}
              />
            ) : (
              <span
                className="cover-ph"
                data-size="md" style={{ width: 42, height: 42, borderRadius: 'var(--r-1)' }}
                aria-hidden
              >
                {currentSong.songName.trim().charAt(0) || '·'}
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="bar-title block">{currentSong.songName}</span>
              <span className="bar-sub block">
                {audioSourceInfo?.source === 'fallback' ? '备用音轨 · ' : ''}
                {currentSong.singerName}
              </span>
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={togglePlay}
              className="btn-play"
              style={{ width: 40, height: 40 }}
              aria-label={isPlaying ? '暂停' : '播放'}
            >
              {isPlaying ? (
                <Pause size={16} strokeWidth={2} fill="currentColor" />
              ) : (
                <Play size={16} strokeWidth={2} fill="currentColor" style={{ marginLeft: 2 }} />
              )}
            </button>
            <button
              type="button"
              onClick={nextSong}
              className="icon-btn"
              aria-label="下一首"
            >
              <SkipForward size={17} strokeWidth={1.7} fill="currentColor" />
            </button>
          </div>
        </div>
      </div>

      {/* ===== 2. 桌面 / 平板底栏 ===== */}
      <footer className="bar">
        <div className="bar-desk">
          {/* 左：曲目资料。与右侧等宽，保证主控区真正居中 */}
          <div className="flex min-w-0 items-center gap-3" style={{ width: 260 }}>
            {currentSong.coverUrl ? (
              <img
                src={currentSong.coverUrl}
                alt=""
                className="shrink-0 object-cover"
                style={{ width: 44, height: 44, borderRadius: 'var(--r-1)' }}
              />
            ) : (
              <span
                className="cover-ph"
                data-size="md" style={{ width: 44, height: 44, borderRadius: 'var(--r-1)' }}
                aria-hidden
              >
                {currentSong.songName.trim().charAt(0) || '·'}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="bar-title">{currentSong.songName}</div>
              <div className="bar-sub">{currentSong.singerName}</div>
              <div className="now-src" data-tone={errorMsg ? 'bad' : undefined} style={{ marginTop: 3 }}>
                {errorMsg ? (
                  <>
                    <span className="dot" data-tone="bad" />
                    <span className="truncate" title={errorMsg}>
                      音源异常
                    </span>
                  </>
                ) : audioSourceInfo?.source ? (
                  <>
                    <span
                      className="dot"
                      data-tone={audioSourceInfo.source === 'primary' ? 'ok' : 'warn'}
                    />
                    <span>
                      {audioSourceInfo.source === 'primary'
                        ? `官方主轨${audioSourceInfo.bitrate ? ` ${audioSourceInfo.bitrate}k` : ''}`
                        : '备用音轨'}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          {/* 中：主控 + 进度 */}
          <div className="flex min-w-0 flex-1 flex-col items-center">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={cyclePlayMode}
                className="icon-btn"
                data-on={playMode !== 'sequence'}
                title={MODE_LABEL[playMode]}
                aria-label={`播放模式：${MODE_LABEL[playMode]}`}
              >
                <ModeIcon mode={playMode} />
              </button>
              <button type="button" onClick={prevSong} className="icon-btn" aria-label="上一首">
                <SkipBack size={16} strokeWidth={1.7} fill="currentColor" />
              </button>
              <button
                type="button"
                onClick={togglePlay}
                className="btn-play"
                aria-label={isPlaying ? '暂停' : '播放'}
              >
                {isPlaying ? (
                  <Pause size={14} strokeWidth={2} fill="currentColor" />
                ) : (
                  <Play size={14} strokeWidth={2} fill="currentColor" style={{ marginLeft: 2 }} />
                )}
              </button>
              <button type="button" onClick={nextSong} className="icon-btn" aria-label="下一首">
                <SkipForward size={16} strokeWidth={1.7} fill="currentColor" />
              </button>
              <button
                type="button"
                onClick={() => setIsQueueOpen((v) => !v)}
                className="icon-btn"
                data-on={isQueueOpen}
                title="播放队列"
                aria-label="播放队列"
                aria-expanded={isQueueOpen}
              >
                <ListMusic size={15} strokeWidth={1.7} />
              </button>
            </div>

            <div className="mt-1 flex w-full max-w-[420px] items-center gap-2.5">
              <span className="bar-times" style={{ width: 34, textAlign: 'right' }}>
                {formatTime(currentTime)}
              </span>
              <SeekBar value={currentTime} max={duration} onChange={seek} label="播放进度" />
              <span className="bar-times" style={{ width: 34 }}>
                {formatTime(duration)}
              </span>
            </div>
          </div>

          {/* 右：音量 */}
          <div className="flex items-center justify-end gap-1" style={{ width: 260 }}>
            <button
              type="button"
              onClick={toggleMute}
              className="icon-btn"
              aria-label={isMuted ? '取消静音' : '静音'}
            >
              <VolIcon size={15} strokeWidth={1.7} />
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={isMuted ? 0 : volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="range"
              style={{ width: 72 }}
              aria-label="音量"
            />
          </div>
        </div>
      </footer>

      {/* ===== 3. 队列浮层（桌面） ===== */}
      {isQueueOpen && (
        <>
          <div
            className="fixed inset-0 z-40 hidden lg:block"
            onClick={() => setIsQueueOpen(false)}
            aria-hidden
          />
          <div
            className="sheet fixed z-50 hidden lg:flex"
            style={{ right: 18, bottom: 92, width: 340, maxHeight: '58vh' }}
            role="dialog"
            aria-label="播放队列"
          >
            <div className="sheet-head-row" style={{ padding: '13px 14px', alignItems: 'center' }}>
              <div className="min-w-0 flex-1">
                <h3 className="sheet-title truncate" style={{ fontSize: 'var(--fs-3)' }}>
                  播放列表
                </h3>
                <p className="sheet-sub mono" style={{ marginTop: 2, fontSize: 'var(--fs-1)' }}>
                  {String(queueSongs.length).padStart(2, '0')} 首
                </p>
              </div>
              <button
                type="button"
                onClick={clearQueue}
                disabled={queueSongs.length === 0}
                className="btn btn-quiet"
                style={{ height: 26, padding: '0 8px', fontSize: 'var(--fs-1)' }}
                title="清空队列"
              >
                <Trash2 size={12} strokeWidth={1.7} />
                清空
              </button>
              <button
                type="button"
                onClick={() => setIsQueueOpen(false)}
                className="icon-btn"
                style={{ width: 26, height: 26 }}
                title="关闭"
              >
                <X size={14} strokeWidth={1.8} />
              </button>
            </div>
            {queueList}
          </div>
        </>
      )}

      <MobileLyricsModal isOpen={isMobileModalOpen} onClose={() => setIsMobileModalOpen(false)} />
    </>
  );
};
