/**
 * 侧边栏组件 (src/components/Sidebar.tsx)
 * 适配平板横屏与桌面端，提供歌单切换、导入与扫码登录入口，并区分自建云端歌单与本地导入歌单
 */

import React from 'react';
import {
  Disc3,
  FolderPlus,
  Music2,
  QrCode,
  RefreshCw,
  Trash2,
  User,
} from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import type { KuGouPlaylist } from '../types/music';

interface SidebarProps {
  onOpenImport: () => void;
  onOpenSettings: () => void;
}

/**
 * 歌单列表项组件（复用逻辑，避免重复代码）
 */
const PlaylistItem: React.FC<{
  playlist: KuGouPlaylist;
  isActive: boolean;
  isPlayingSong: boolean;
  onSelect: () => void;
  onDelete?: () => void;
}> = ({ playlist, isActive, isPlayingSong, onSelect, onDelete }) => (
  <div
    onClick={onSelect}
    className={`group relative flex items-center gap-3 p-2 rounded-xl cursor-pointer border transition-all duration-200 ${
      isActive
        ? 'bg-cyan-500/10 border-cyan-500/30 text-white shadow-sm shadow-cyan-500/10'
        : 'bg-white/[0.02] hover:bg-white/[0.06] border-transparent text-zinc-400 hover:text-zinc-200'
    }`}
  >
    {/* 封面图 */}
    <div className="relative w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-zinc-800">
      {playlist.coverUrl ? (
        <img
          src={playlist.coverUrl}
          alt={playlist.name}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-zinc-800 text-zinc-500">
          <Music2 className="w-4 h-4" />
        </div>
      )}

      {/* 正在播放动态指示器 */}
      {isActive && isPlayingSong && (
        <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-0.5">
          <span className="w-1 h-3 bg-cyan-400 rounded-full animate-pulse" />
          <span className="w-1 h-4 bg-cyan-400 rounded-full animate-pulse delay-75" />
          <span className="w-1 h-2 bg-cyan-400 rounded-full animate-pulse delay-150" />
        </div>
      )}
    </div>

    {/* 歌单名称与曲目数 */}
    <div className="flex-1 min-w-0">
      <h3 className="text-xs font-medium truncate">{playlist.name}</h3>
      <p className="text-[11px] text-zinc-500 mt-0.5 truncate">
        {playlist.totalSongs} 首单曲
      </p>
    </div>

    {/* 删除按钮（仅本地导入歌单显示） */}
    {onDelete && (
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="移除歌单"
        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-all duration-150"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    )}
  </div>
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
    isSyncingCloud,
    syncCloudPlaylists,
  } = usePlayer();

  // 区分酷狗账号自建/收藏歌单 与 本地额外导入歌单
  const userOwnedPlaylists = playlists.filter((p) => p.isUserOwned);
  const importedPlaylists = playlists.filter((p) => !p.isUserOwned);

  return (
    <aside className="hidden md:flex flex-col w-64 lg:w-72 h-full bg-zinc-900/60 backdrop-blur-2xl border-r border-white/10 p-4 shrink-0 select-none">
      {/* 品牌 Logo 与标题 */}
      <div className="flex items-center gap-3 px-2 py-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
          <Music2 className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="font-bold text-base tracking-wide bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">
            酷狗无损播放器
          </h1>
          <span className="text-[11px] text-cyan-400/80 font-medium tracking-wider uppercase">
            Pure Client · Tauri v2
          </span>
        </div>
      </div>

      {/* 快捷操作区：导入歌单 与 扫码授权（样式完全统一，无冗余说明） */}
      <div className="grid grid-cols-2 gap-2 mb-5">
        <button
          onClick={onOpenImport}
          className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-white font-medium text-xs shadow-sm active:scale-[0.98] transition-all"
        >
          <FolderPlus className="w-4 h-4 text-cyan-400 shrink-0" />
          <span className="truncate">导入歌单</span>
        </button>

        <button
          onClick={onOpenSettings}
          className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/10 text-white font-medium text-xs shadow-sm active:scale-[0.98] transition-all"
        >
          {userSettings?.kugouToken ? (
            <>
              {userSettings.avatar ? (
                <img
                  src={userSettings.avatar}
                  alt={userSettings.nickname}
                  className="w-4 h-4 rounded-full object-cover shrink-0"
                />
              ) : (
                <User className="w-4 h-4 text-emerald-400 shrink-0" />
              )}
              <span className="truncate">{userSettings.nickname || '已授权'}</span>
            </>
          ) : (
            <>
              <QrCode className="w-4 h-4 text-cyan-400 shrink-0" />
              <span className="truncate">扫码授权</span>
            </>
          )}
        </button>
      </div>

      {/* 歌单列表滚动区域 */}
      <div className="flex-1 overflow-y-auto space-y-5 pr-1 -mr-1 custom-scrollbar">
        {/* 分区 1：酷狗账号歌单 */}
        <div>
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              酷狗账号歌单 ({userOwnedPlaylists.length})
            </span>
            {userSettings?.kugouToken && (
              <button
                onClick={() => syncCloudPlaylists()}
                disabled={isSyncingCloud}
                title="重新同步云端歌单"
                className="p-1 rounded hover:bg-white/10 text-zinc-500 hover:text-cyan-400 transition-colors"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isSyncingCloud ? 'animate-spin text-cyan-400' : ''}`}
                />
              </button>
            )}
          </div>

          {!userSettings?.kugouToken ? (
            <div
              onClick={onOpenSettings}
              className="p-3 rounded-xl bg-white/[0.02] border border-dashed border-white/10 text-center cursor-pointer hover:bg-white/[0.05] transition-colors"
            >
              <p className="text-[11px] text-zinc-400">点击扫码授权同步账号歌单</p>
            </div>
          ) : userOwnedPlaylists.length === 0 ? (
            <div className="p-3 text-center text-xs text-zinc-500">
              {isSyncingCloud ? '正在同步账号歌单...' : '暂无云端歌单，可点击上方刷新同步'}
            </div>
          ) : (
            <div className="space-y-1">
              {userOwnedPlaylists.map((playlist) => (
                <PlaylistItem
                  key={playlist.id}
                  playlist={playlist}
                  isActive={activePlaylist?.id === playlist.id}
                  isPlayingSong={Boolean(currentSong && isPlaying)}
                  onSelect={() => selectPlaylist(playlist)}
                />
              ))}
            </div>
          )}
        </div>

        {/* 分区 2：本地导入歌单 */}
        <div>
          <div className="flex items-center justify-between px-2 mb-2">
            <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
              本地导入歌单 ({importedPlaylists.length})
            </span>
          </div>

          {importedPlaylists.length === 0 ? (
            <div
              onClick={onOpenImport}
              className="p-3 rounded-xl bg-white/[0.02] border border-dashed border-white/10 text-center cursor-pointer hover:bg-white/[0.05] transition-colors"
            >
              <Disc3 className="w-5 h-5 text-zinc-500 mx-auto mb-1 stroke-[1.5]" />
              <p className="text-[11px] text-zinc-400">暂无导入歌单，点击上方导入</p>
            </div>
          ) : (
            <div className="space-y-1">
              {importedPlaylists.map((playlist) => (
                <PlaylistItem
                  key={playlist.id}
                  playlist={playlist}
                  isActive={activePlaylist?.id === playlist.id}
                  isPlayingSong={Boolean(currentSong && isPlaying)}
                  onSelect={() => selectPlaylist(playlist)}
                  onDelete={() => {
                    if (confirm(`确定要移除歌单《${playlist.name}》吗？`)) {
                      deletePlaylistById(playlist.id);
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

