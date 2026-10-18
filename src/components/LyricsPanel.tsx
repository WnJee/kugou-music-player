/**
 * 实时歌词面板 (src/components/LyricsPanel.tsx)
 * 桌面/平板右侧栏。资料块左对齐、方形封面、歌词行带 2px 赭橙竖条。
 * 刻意不做居中圆形黑胶：唱片是媒体播放器的时代残影，这里用"唱片内页"的排版逻辑。
 */

import React from 'react';
import { usePlayer } from '../context/PlayerContext';
import { LyricsScroller } from './LyricsScroller';

/** 音源标识：状态点 + 等宽小字，不用彩色整块 badge */
const SourceNote: React.FC<{ source?: string; bitrate?: number; msg?: string }> = ({
  source,
  bitrate,
  msg,
}) => {
  if (!source) return null;
  const isPrimary = source === 'primary';
  return (
    <div className="now-src" title={msg}>
      <span className="dot" data-tone={isPrimary ? 'ok' : 'warn'} />
      <span>{isPrimary ? '官方主轨' : '备用音轨'}</span>
      {isPrimary && bitrate ? (
        <>
          <span style={{ color: 'var(--ink-4)' }}>/</span>
          <span>{bitrate}k</span>
        </>
      ) : null}
    </div>
  );
};

export const LyricsPanel: React.FC = () => {
  const { currentSong, isPlaying, lyrics, activeLyricIndex, seek, audioSourceInfo, errorMsg } =
    usePlayer();

  if (!currentSong) {
    return (
      <aside className="lyrics-rail" aria-label="歌词">
        <div className="flex flex-col justify-end h-full" style={{ padding: '26px 24px 30px' }}>
          <p className="microcaps" style={{ marginBottom: 10 }}>
            歌词
          </p>
          <p
            className="display"
            style={{ fontSize: 'var(--fs-5)', color: 'var(--ink-2)', maxWidth: '16ch' }}
          >
            选一首歌，
            <br />
            歌词会在这里。
          </p>
          <p
            style={{
              marginTop: 12,
              maxWidth: '24ch',
              fontSize: 'var(--fs-2)',
              lineHeight: 'var(--lh-body)',
              color: 'var(--ink-3)',
            }}
          >
            点击任意一行歌词可以直接跳到那一句。
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="lyrics-rail" aria-label="歌词">
      {/* 曲目资料：小方图 + 曲名，把纵向空间让给歌词（与播放页同一套逻辑） */}
      <div className="rail-now" style={{ flexShrink: 0 }}>
        <div className="rail-thumb" aria-hidden>
          {currentSong.coverUrl ? (
            <img src={currentSong.coverUrl} alt="" />
          ) : (
            <span className="cover-ph" data-size="md" style={{ width: '100%', height: '100%' }}>
              {currentSong.songName.trim().charAt(0) || '·'}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="rail-now-title truncate">{currentSong.songName}</h2>
          <p className="rail-now-sub truncate">{currentSong.singerName}</p>

          <SourceNote
            source={audioSourceInfo?.source}
            bitrate={audioSourceInfo?.bitrate}
            msg={audioSourceInfo?.msg}
          />
        </div>
      </div>

      {errorMsg && (
        <p
          style={{
            margin: '0 24px 8px',
            fontSize: 'var(--fs-1)',
            lineHeight: 'var(--lh-body)',
            color: 'color-mix(in oklab, var(--danger) 70%, var(--ink-0))',
          }}
        >
          {errorMsg}
        </p>
      )}

      <div
        style={{ height: 1, background: 'var(--line-soft)', margin: '0 24px', flexShrink: 0 }}
      />

      <LyricsScroller
        variant="center"
        containerClassName="flex-1 mask-fade"
        contentClassName="px-6 py-10"
        lyrics={lyrics}
        activeIndex={activeLyricIndex}
        onSeek={seek}
        activeClassName="text-[var(--ink-0)]"
        idleClassName="text-[var(--ink-3)]"
        emptyNode={
          <p
            style={{
              fontSize: 'var(--fs-2)',
              lineHeight: 'var(--lh-body)',
              color: 'var(--ink-3)',
              textAlign: 'center',
            }}
          >
            {isPlaying ? '这首歌暂时没有歌词。' : '暂无歌词。'}
          </p>
        }
      />
    </aside>
  );
};
