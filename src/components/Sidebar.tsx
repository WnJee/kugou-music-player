/**
 * 侧边栏组件 (src/components/Sidebar.tsx)
 * 结构：衬线品牌名 + 单行操作条 + 两段歌单列表。
 * 选中态用 2px 赭橙竖条，不用整块彩色填充。
 */

import React, { useState } from 'react';
import { FolderPlus, Loader2, QrCode, RefreshCw, Trash2 } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import type { KuGouPlaylist } from '../types/music';

interface SidebarProps {
  onOpenImport: () => void;
  onOpenSettings: () => void;
}

/** 封面缺图时用歌单首字，避免一面通用的音符图标 */
const CoverFallback: React.FC<{ name: string; size: number }> = ({ name, size }) => (
  <span
    className="cover-ph"
    style={{ width: size, height: size, borderRadius: 'var(--r-1)', fontSize: size * 0.42 }}
    aria-hidden
  >
    {name.trim().charAt(0) || '·'}
  </span>
);

const PlaylistItem: React.FC<{
  playlist: KuGouPlaylist;
  isActive: boolean;
  isPlayingSong: boolean;
  isPlaying: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}> = ({ playlist, isActive, isPlayingSong, isPlaying, onSelect, onDelete }) => (
  <button
    type="button"
    onClick={onSelect}
    className="rail-item group"
    data-active={isActive}
    aria-current={isActive ? 'true' : undefined}
  >
    <span className="relative shrink-0" style={{ lineHeight: 0 }}>
      {playlist.coverUrl ? (
        <img
          src={playlist.coverUrl}
          alt=""
          className="row-cover"
          style={{ width: 32, height: 32, borderRadius: 'var(--r-1)' }}
          loading="lazy"
        />
      ) : (
        <CoverFallback name={playlist.name} size={32} />
      )}
      {isActive && isPlayingSong && (
        <span
          className="bars absolute inset-0 m-auto"
          data-paused={!isPlaying}
          style={{ width: 9, justifyContent: 'center' }}
        />
      )}
    </span>

    <span className="min-w-0 flex-1">
      <span className="name block">{playlist.name}</span>
      <span className="sub block mono">
        {String(playlist.totalSongs).padStart(2, '0')} 首
      </span>
    </span>

    {onDelete && (
      <span
        role="button"
        tabIndex={0}
        title="移除歌单"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            onDelete();
          }
        }}
        className="icon-btn opacity-0 transition-opacity group-hover:opacity-100"
        style={{ width: 24, height: 24 }}
      >
        <Trash2 size={13} strokeWidth={1.6} />
      </span>
    )}
  </button>
);

export const Sidebar: React.FC<SidebarProps> = ({ onOpenImport, onOpenSettings }) => {
  const {
    playlists,
    activePlaylist,
    selectPlaylist,
    deletePlaylistById,
    currentSong,
    isPlaying,
    userSettings,
    vipStatus,
    isSyncingCloud,
    syncCloudPlaylists,
    cloudSyncError,
  } = usePlayer();

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const userOwnedPlaylists = playlists.filter((p) => p.isUserOwned);
  const importedPlaylists = playlists.filter((p) => !p.isUserOwned);

  return (
    <aside className="rail">
      {/* 品牌：衬线标题靠字重与字距立骨，不靠渐变块 */}
      <div className="brand">
        <div className="brand-mark">
          <span className="brand-name">酷狗播放器</span>
          {vipStatus?.isVip && (
            <span
              className="mono"
              title={vipStatus.vipEndTime ? `会员到期 ${vipStatus.vipEndTime}` : '会员生效中'}
              style={{ fontSize: 'var(--fs-1)', color: 'var(--accent-ink)', letterSpacing: '0.1em' }}
            >
              VIP
            </span>
          )}
        </div>
        <div className="brand-sub">无损 · 本地直连</div>
      </div>

      {/* 操作条：两个动作共用一条横向分隔，不各占一个圆角卡 */}
      <div className="rail-actions">
        <button type="button" onClick={onOpenImport} className="rail-action">
          <FolderPlus size={14} strokeWidth={1.6} className="shrink-0" />
          <span className="truncate">导入</span>
        </button>
        <button type="button" onClick={onOpenSettings} className="rail-action">
          {userSettings?.kugouToken ? (
            <>
              {userSettings.avatar ? (
                <img
                  src={userSettings.avatar}
                  alt=""
                  className="shrink-0 rounded-full object-cover"
                  style={{ width: 15, height: 15 }}
                />
              ) : (
                <span className="dot shrink-0" data-tone="ok" />
              )}
              <span className="truncate">{userSettings.nickname || '已授权'}</span>
            </>
          ) : (
            <>
              <QrCode size={14} strokeWidth={1.6} className="shrink-0" />
              <span className="truncate">扫码登录</span>
            </>
          )}
        </button>
      </div>

      <div className="rail-scroll">
        {/* 分区 1：云端歌单 */}
        <section className="rail-section">
          <div className="rail-head">
            <span>账号歌单</span>
            <span className="flex items-center gap-1">
              <span className="count">{String(userOwnedPlaylists.length).padStart(2, '0')}</span>
              {userSettings?.kugouToken && (
                <button
                  type="button"
                  onClick={() => syncCloudPlaylists(true)}
                  disabled={isSyncingCloud}
                  title="重新同步云端歌单"
                  className="icon-btn"
                  style={{ width: 20, height: 20, color: 'var(--ink-3)' }}
                >
                  {isSyncingCloud ? (
                    <Loader2 size={12} className="spin" strokeWidth={1.8} />
                  ) : (
                    <RefreshCw size={12} strokeWidth={1.6} />
                  )}
                </button>
              )}
            </span>
          </div>

          {!userSettings?.kugouToken ? (
            <button type="button" onClick={onOpenSettings} className="rail-empty">
              未登录。扫码后可同步账号歌单与会员权益 →
            </button>
          ) : userOwnedPlaylists.length === 0 ? (
            <p className="rail-empty">
              {isSyncingCloud ? (
                '正在同步账号歌单…'
              ) : cloudSyncError ? (
                <span style={{ color: 'var(--warn)' }}>同步失败：{cloudSyncError}</span>
              ) : (
                '账号下暂无歌单'
              )}
            </p>
          ) : (
            <div>
              {userOwnedPlaylists.map((playlist) => (
                <PlaylistItem
                  key={playlist.id}
                  playlist={playlist}
                  isActive={activePlaylist?.id === playlist.id}
                  isPlayingSong={Boolean(currentSong && isPlaying)}
                  isPlaying={isPlaying}
                  onSelect={() => selectPlaylist(playlist)}
                />
              ))}
            </div>
          )}
        </section>

        {/* 分区 2：本地歌单 */}
        <section className="rail-section">
          <div className="rail-head">
            <span>本地导入</span>
            <span className="count">{String(importedPlaylists.length).padStart(2, '0')}</span>
          </div>

          {importedPlaylists.length === 0 ? (
            <button type="button" onClick={onOpenImport} className="rail-empty">
              还没有导入歌单。粘贴分享链接或酷狗码 →
            </button>
          ) : (
            <div>
              {importedPlaylists.map((playlist) =>
                pendingDeleteId === playlist.id ? (
                  <div key={playlist.id} className="px-4 py-2.5" style={{ background: 'var(--lift)' }}>
                    <p
                      className="truncate"
                      style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-1)' }}
                    >
                      移除《{playlist.name}》？
                    </p>
                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPendingDeleteId(null)}
                        className="btn"
                        style={{ height: 26, padding: '0 9px', fontSize: 'var(--fs-1)' }}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPendingDeleteId(null);
                          deletePlaylistById(playlist.id);
                        }}
                        className="btn btn-danger"
                        style={{ height: 26, padding: '0 9px', fontSize: 'var(--fs-1)' }}
                      >
                        移除
                      </button>
                    </div>
                  </div>
                ) : (
                  <PlaylistItem
                    key={playlist.id}
                    playlist={playlist}
                    isActive={activePlaylist?.id === playlist.id}
                    isPlayingSong={Boolean(currentSong && isPlaying)}
                    isPlaying={isPlaying}
                    onSelect={() => selectPlaylist(playlist)}
                    onDelete={() => setPendingDeleteId(playlist.id)}
                  />
                )
              )}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
};
