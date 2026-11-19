/**
 * 歌单 / 搜索结果行 (src/components/SongRow.tsx)
 *
 * 抽出成 React.memo 的独立行：播放进度每秒刷新多次，行内容与进度无关，
 * 只要 hash、序号、播放态不变就不重渲染，整表因此不再跟着 timeupdate 抖。
 * 事件回调全部由父组件 useCallback 提供，保持引用稳定。
 */

import React from 'react';
import { Play, Plus, Trash2 } from 'lucide-react';
import { formatTime } from './playbackTime';
import type { KuGouSong } from '../types/music';

const coverStyle: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 'var(--r-1)',
  objectFit: 'cover',
  flexShrink: 0,
  background: 'var(--lift)',
};

/** 封面缺图时显示曲名首字，比通用音符图标更有信息量 */
const SongCover: React.FC<{ song: KuGouSong }> = ({ song }) =>
  song.coverUrl ? (
    <img src={song.coverUrl} alt="" className="row-cover" loading="lazy" />
  ) : (
    <span className="cover-ph" data-size="md" style={coverStyle} aria-hidden>
      {song.songName.trim().charAt(0) || '·'}
    </span>
  );

export interface SongRowProps {
  song: KuGouSong;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  /** playlist：歌单内曲目（有色行 + 移除键）；search：全网搜索结果（带序号列宽） */
  variant?: 'playlist' | 'search';
  onPlay: (song: KuGouSong) => void;
  onAdd: (song: KuGouSong) => void;
  onRemove?: (song: KuGouSong) => void;
}

const SongRowInner: React.FC<SongRowProps> = ({
  song,
  index,
  isCurrent,
  isPlaying,
  variant = 'playlist',
  onPlay,
  onAdd,
  onRemove,
}) => {
  const playing = isCurrent && isPlaying;
  const ordinal = String(index + 1).padStart(2, '0');

  if (variant === 'search') {
    return (
      <div
        data-song-hash={song.hash}
        data-playing={isCurrent}
        onClick={() => onPlay(song)}
        className="row"
        style={{ gridTemplateColumns: '30px minmax(0,1fr) 74px 72px' }}
      >
        <span className="row-idx">
          {playing ? (
            <span className="bars">
              <i />
              <i />
              <i />
            </span>
          ) : (
            <span className="mono">{ordinal}</span>
          )}
        </span>

        <span className="min-w-0">
          <span className="flex items-center gap-2.5">
            <SongCover song={song} />
            <span className="min-w-0 flex-1">
              <span className="row-title block">{song.songName}</span>
              <span className="row-sub block">{song.singerName}</span>
            </span>
          </span>
        </span>

        <span className="row-time">{formatTime(song.duration, '--:--')}</span>

        <span className="row-actions">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAdd(song);
            }}
            className="icon-btn"
            style={{ width: 26, height: 26 }}
            title="加入歌单"
          >
            <Plus size={14} strokeWidth={1.8} />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div
      data-song-hash={song.hash}
      data-playing={isCurrent}
      onClick={() => onPlay(song)}
      className="row group"
    >
      <span className="row-idx">
        {playing ? (
          <span className="bars">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <span className="mono block group-hover:hidden">{ordinal}</span>
        )}
        {!playing && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlay(song);
            }}
            className="hidden group-hover:block"
            title="播放"
            style={{ color: 'var(--ink-0)' }}
          >
            <Play size={11} strokeWidth={2} fill="currentColor" />
          </button>
        )}
      </span>

      <span className="flex items-center gap-2.5 min-w-0">
        <SongCover song={song} />
        <span className="min-w-0 flex-1">
          <span className="row-title block">{song.songName}</span>
          <span className="row-sub block xl:hidden">{song.singerName}</span>
        </span>
      </span>

      <span className="row-artist">{song.singerName}</span>
      <span className="row-time">{formatTime(song.duration, '--:--')}</span>

      <span className="row-actions">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onAdd(song);
          }}
          className="icon-btn opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
          style={{ width: 26, height: 26 }}
          title="加入其他歌单"
        >
          <Plus size={14} strokeWidth={1.8} />
        </button>
        {onRemove && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(song);
            }}
            className="icon-btn opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
            style={{ width: 26, height: 26 }}
            title="从歌单移除"
          >
            <Trash2 size={14} strokeWidth={1.8} />
          </button>
        )}
      </span>
    </div>
  );
};

export const SongRow = React.memo(SongRowInner, (prev, next) => {
  const a = prev.song;
  const b = next.song;
  return (
    a.hash === b.hash &&
    a.songName === b.songName &&
    a.singerName === b.singerName &&
    a.coverUrl === b.coverUrl &&
    a.duration === b.duration &&
    prev.index === next.index &&
    prev.isCurrent === next.isCurrent &&
    prev.isPlaying === next.isPlaying &&
    prev.variant === next.variant &&
    prev.onPlay === next.onPlay &&
    prev.onAdd === next.onAdd &&
    prev.onRemove === next.onRemove
  );
});
