/**
 * 添加歌曲至歌单弹窗 (src/components/AddToPlaylistModal.tsx)
 * 列表式选择项：序号/封面 + 名称 + 曲目数。没有彩色 icon 分组标题。
 */

import React, { useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import type { KuGouPlaylist, KuGouSong } from '../types/music';

interface AddToPlaylistModalProps {
  isOpen: boolean;
  song: KuGouSong | null;
  onClose: () => void;
}

const PickRow: React.FC<{
  playlist: KuGouPlaylist;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}> = ({ playlist, busy, disabled, onClick }) => (
  <button type="button" className="pick" disabled={disabled} onClick={onClick}>
    {playlist.coverUrl ? (
      <img
        src={playlist.coverUrl}
        alt=""
        className="shrink-0 object-cover"
        style={{ width: 32, height: 32, borderRadius: 'var(--r-1)' }}
        loading="lazy"
      />
    ) : (
      <span
        className="cover-ph"
        data-size="sm" style={{ width: 32, height: 32, borderRadius: 'var(--r-1)' }}
        aria-hidden
      >
        {playlist.name.trim().charAt(0) || '·'}
      </span>
    )}
    <span className="min-w-0 flex-1">
      <span className="block truncate" style={{ fontSize: 'var(--fs-3)', color: 'var(--ink-0)' }}>
        {playlist.name}
      </span>
      <span className="mono block" style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
        {String(playlist.totalSongs).padStart(2, '0')} 首
        {playlist.isUserOwned ? ' · 同步云端' : ''}
      </span>
    </span>
    {busy && <Loader2 size={14} className="spin shrink-0" style={{ color: 'var(--accent-ink)' }} />}
  </button>
);

export const AddToPlaylistModal: React.FC<AddToPlaylistModalProps> = ({
  isOpen,
  song,
  onClose,
}) => {
  const { playlists, addSongToPlaylist } = usePlayer();
  const [addingPlaylistId, setAddingPlaylistId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  if (!isOpen || !song) return null;

  const userOwnedPlaylists = playlists.filter((p) => p.isUserOwned);
  const importedPlaylists = playlists.filter((p) => !p.isUserOwned);

  const handleSelectPlaylist = async (playlist: KuGouPlaylist) => {
    setAddingPlaylistId(playlist.id);
    setToastMsg(null);
    try {
      const res = await addSongToPlaylist(song, playlist.id);
      setToastMsg(res.message);
      setTimeout(() => {
        setAddingPlaylistId(null);
        setToastMsg(null);
        onClose();
      }, 1200);
    } catch {
      setToastMsg('添加失败，请重试');
      setAddingPlaylistId(null);
    }
  };

  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        className="sheet"
        style={{ maxWidth: 400 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="添加到歌单"
      >
        <div className="sheet-head-row">
          <div className="min-w-0 flex-1">
            <h2 className="sheet-title">加入歌单</h2>
            <p className="sheet-sub truncate">
              {song.singerName} — {song.songName}
            </p>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" title="关闭">
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        <div className="sheet-body">
          {toastMsg && (
            <div className="notice mb-3" data-tone="ok">
              <Check size={13} strokeWidth={2.2} className="mt-0.5 shrink-0" />
              <span>{toastMsg}</span>
            </div>
          )}

          {playlists.length === 0 ? (
            <div className="empty" style={{ padding: '24px 0', maxWidth: 'none' }}>
              <p className="empty-title" style={{ fontSize: 'var(--fs-4)' }}>
                还没有可用的歌单
              </p>
              <p className="empty-body" style={{ marginTop: 6 }}>
                先在左侧导入一个歌单，或扫码登录同步账号歌单。
              </p>
            </div>
          ) : (
            <>
              {userOwnedPlaylists.length > 0 && (
                <section>
                  <p className="microcaps" style={{ marginBottom: 4 }}>
                    账号歌单
                  </p>
                  {userOwnedPlaylists.map((pl) => (
                    <PickRow
                      key={pl.id}
                      playlist={pl}
                      busy={addingPlaylistId === pl.id}
                      disabled={Boolean(addingPlaylistId)}
                      onClick={() => handleSelectPlaylist(pl)}
                    />
                  ))}
                </section>
              )}

              {importedPlaylists.length > 0 && (
                <section
                  style={{
                    marginTop: userOwnedPlaylists.length > 0 ? 14 : 0,
                    paddingTop: userOwnedPlaylists.length > 0 ? 12 : 0,
                    borderTop: userOwnedPlaylists.length > 0 ? '1px solid var(--line-soft)' : 0,
                  }}
                >
                  <p className="microcaps" style={{ marginBottom: 4 }}>
                    本地导入
                  </p>
                  {importedPlaylists.map((pl) => (
                    <PickRow
                      key={pl.id}
                      playlist={pl}
                      busy={addingPlaylistId === pl.id}
                      disabled={Boolean(addingPlaylistId)}
                      onClick={() => handleSelectPlaylist(pl)}
                    />
                  ))}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
