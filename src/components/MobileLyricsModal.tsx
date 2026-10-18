/**
 * 移动端全屏播放页 (src/components/MobileLyricsModal.tsx)
 *
 * 版式决定：
 * - 不再用大面积封面占位。封面退成顶栏里的一枚小方图（28px），
 *   把整屏高度让给歌词——这是「播放详情」而不是「专辑封面展示页」。
 * - 歌词居中、按距当前行的距离逐级缩放（见 index.css 的 .lyric-line--center），
 *   当前行最大最亮，上下逐渐缩小变暗，形成明确的纵深。
 * - 主播放键靠右（拇指可达），底部留安全区。
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
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
import { LyricsScroller } from './LyricsScroller';
import type { PlayMode } from '../types/music';

interface MobileLyricsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

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

const ModeIcon: React.FC<{ mode: PlayMode; size?: number }> = ({ mode, size = 19 }) => {
  const common = { size, strokeWidth: 1.7 };
  if (mode === 'single') return <Repeat1 {...common} />;
  if (mode === 'random') return <Shuffle {...common} />;
  return <Repeat {...common} />;
};

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
    isMuted,
    toggleMute,
    playMode,
    cyclePlayMode,
    lyrics,
    activeLyricIndex,
    audioSourceInfo,
    errorMsg,
    playSong,
    queueSongs,
    clearQueue,
  } = usePlayer();

  const [isQueueOpen, setIsQueueOpen] = useState(false);

  if (!isOpen || !currentSong) return null;

  const VolIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const remaining = Math.max(0, (duration || 0) - currentTime);
  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className="mnp">
      {/* 顶栏：小方图 + 曲名，左对齐；不再占用大块封面区 */}
      <div
        className="mnp-top relative shrink-0"
        style={{ paddingTop: 'calc(10px + env(safe-area-inset-top))' }}
      >
        <button type="button" onClick={onClose} className="icon-btn" aria-label="收起">
          <ChevronDown size={20} strokeWidth={1.8} />
        </button>

        <div className="mnp-thumb" aria-hidden>
          {currentSong.coverUrl ? (
            <img src={currentSong.coverUrl} alt="" />
          ) : (
            <span className="cover-ph" data-size="sm" style={{ width: '100%', height: '100%' }}>
              {currentSong.songName.trim().charAt(0) || '·'}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h1 className="mnp-title truncate">{currentSong.songName}</h1>
          <p className="mnp-sub truncate">{currentSong.singerName}</p>
        </div>

        <button
          type="button"
          onClick={() => setIsQueueOpen(true)}
          className="icon-btn"
          data-on={isQueueOpen}
          aria-label="播放队列"
        >
          <ListMusic size={19} strokeWidth={1.8} />
        </button>
      </div>

      {/* 音源提示：只在异常或备用轨时出现，正常主轨不占一行 */}
      {(errorMsg || (audioSourceInfo?.source && audioSourceInfo.source !== 'primary')) && (
        <div className="shrink-0" style={{ padding: '0 20px' }}>
          <div className="now-src" data-tone={errorMsg ? 'bad' : undefined} style={{ marginTop: 4 }}>
            <span className="dot" data-tone={errorMsg ? 'bad' : 'warn'} />
            <span className="truncate">
              {errorMsg || '备用音轨'}
            </span>
          </div>
        </div>
      )}

      {/* 歌词主体：居中 + 距离缩放，占据整屏剩余高度 */}
      <LyricsScroller
        variant="center"
        containerClassName="flex-1 mask-fade"
        contentClassName="px-5 py-10"
        lyrics={lyrics}
        activeIndex={activeLyricIndex}
        onSeek={seek}
        emptyNode={
          <p
            style={{
              fontSize: 'var(--fs-3)',
              lineHeight: 'var(--lh-body)',
              color: 'var(--ink-3)',
              textAlign: 'center',
              maxWidth: '22ch',
            }}
          >
            {isPlaying ? '这首歌暂时没有歌词。' : '暂无歌词。'}
          </p>
        }
      />

      {/* 底部控制：进度 + 传输键（播放键靠右） */}
      <div
        className="relative shrink-0"
        style={{ padding: '0 22px', paddingBottom: 'max(18px, env(safe-area-inset-bottom))' }}
      >
        <div className="seek seek-lg">
          <div className="seek-track" aria-hidden>
            <div className="seek-fill" style={{ width: `${pct}%` }} />
          </div>
          <input
            type="range"
            min={0}
            max={duration > 0 ? duration : 100}
            step={0.1}
            value={Math.min(currentTime, duration || 100)}
            onChange={(e) => seek(Number(e.target.value))}
            className="seek-input"
            aria-label="播放进度"
          />
        </div>
        <div className="flex items-center justify-between" style={{ marginTop: 2 }}>
          <span className="bar-times">{formatTime(currentTime)}</span>
          <span className="bar-times">−{formatTime(remaining)}</span>
        </div>

        <div className="flex items-center" style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={cyclePlayMode}
            className="icon-btn"
            data-on={playMode !== 'sequence'}
            aria-label={`播放模式：${MODE_LABEL[playMode]}`}
            title={MODE_LABEL[playMode]}
          >
            <ModeIcon mode={playMode} />
          </button>

          <button type="button" onClick={prevSong} className="icon-btn" aria-label="上一首">
            <SkipBack size={20} strokeWidth={1.7} fill="currentColor" />
          </button>

          <button type="button" onClick={nextSong} className="icon-btn" aria-label="下一首">
            <SkipForward size={20} strokeWidth={1.7} fill="currentColor" />
          </button>

          {/* 主键靠右：单手握持时拇指更容易够到 */}
          <div className="flex-1" />

          <button type="button" onClick={toggleMute} className="icon-btn" aria-label="静音">
            <VolIcon size={19} strokeWidth={1.7} />
          </button>

          <button
            type="button"
            onClick={togglePlay}
            className="btn-play btn-play-lg"
            style={{ marginLeft: 8 }}
            aria-label={isPlaying ? '暂停' : '播放'}
          >
            {isPlaying ? (
              <Pause size={21} strokeWidth={2} fill="currentColor" />
            ) : (
              <Play size={21} strokeWidth={2} fill="currentColor" style={{ marginLeft: 3 }} />
            )}
          </button>
        </div>
      </div>

      {/* 队列抽屉：portal 挂到 body，避免被 .mnp 的层叠上下文压在遮罩之下 */}
      {isQueueOpen &&
        createPortal(
          <div>
            <div className="drawer-mask" onClick={() => setIsQueueOpen(false)} />
            <div className="drawer">
              <div className="drawer-head">
                <div className="min-w-0 flex-1">
                  <span
                    className="block truncate"
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 'var(--fs-4)',
                      color: 'var(--ink-0)',
                    }}
                  >
                    播放列表
                  </span>
                  <span className="mono" style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
                    {String(queueSongs.length).padStart(2, '0')} 首
                  </span>
                </div>
                <button
                  type="button"
                  onClick={clearQueue}
                  disabled={queueSongs.length === 0}
                  className="btn btn-quiet"
                  style={{ height: 32, padding: '0 9px', fontSize: 'var(--fs-1)' }}
                >
                  <Trash2 size={13} strokeWidth={1.7} />
                  清空
                </button>
                <button
                  type="button"
                  onClick={() => setIsQueueOpen(false)}
                  className="icon-btn"
                  title="关闭"
                >
                  <X size={17} strokeWidth={1.8} />
                </button>
              </div>

              <div className="drawer-scroll">
                {queueSongs.length === 0 ? (
                  <p
                    className="rail-empty"
                    style={{ borderTop: 0, borderBottom: 0, padding: '26px 16px' }}
                  >
                    队列是空的。
                  </p>
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
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
