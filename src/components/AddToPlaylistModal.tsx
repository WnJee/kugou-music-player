/**
 * 添加歌曲至歌单弹窗 (src/components/AddToPlaylistModal.tsx)
 * 支持将搜索或正在播放的歌曲添加至酷狗云端账号歌单或本地导入歌单，并自动同步酷狗云端
 */

import React, { useState } from 'react';
import { Check, Cloud, Folder, FolderPlus, Loader2, Music2, X } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import type { KuGouPlaylist, KuGouSong } from '../types/music';

interface AddToPlaylistModalProps {
  isOpen: boolean;
  song: KuGouSong | null;
  onClose: () => void;
}

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in select-none">
      <div className="w-full max-w-sm rounded-2xl bg-zinc-900 border border-white/10 p-5 shadow-2xl text-white relative max-h-[85vh] flex flex-col">
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* 标题 */}
        <div className="flex items-center gap-2.5 mb-4 pr-6">
          <div className="w-8 h-8 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center shrink-0">
            <FolderPlus className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold truncate">添加到歌单</h2>
            <p className="text-[11px] text-zinc-400 truncate">
              {song.singerName} - {song.songName}
            </p>
          </div>
        </div>

        {/* 状态提示 */}
        {toastMsg && (
          <div className="mb-3 px-3 py-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs flex items-center gap-2 animate-in fade-in">
            <Check className="w-4 h-4 text-cyan-400 shrink-0" />
            <span className="truncate">{toastMsg}</span>
          </div>
        )}

        {/* 歌单选择列表 */}
        <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-1 -mr-1">
          {playlists.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              暂无可用歌单，请先在左侧导入或同步歌单
            </div>
          ) : (
            <>
              {/* 酷狗账号云端歌单 */}
              {userOwnedPlaylists.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 px-1 mb-2 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                    <Cloud className="w-3.5 h-3.5 text-cyan-400" />
                    <span>酷狗账号歌单 (自动同步云端)</span>
                  </div>
                  <div className="space-y-1">
                    {userOwnedPlaylists.map((pl) => (
                      <button
                        key={pl.id}
                        disabled={addingPlaylistId === pl.id}
                        onClick={() => handleSelectPlaylist(pl)}
                        className="w-full flex items-center gap-3 p-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.99] border border-transparent hover:border-cyan-500/30 text-left transition-all"
                      >
                        <div className="w-9 h-9 rounded-lg overflow-hidden bg-zinc-800 shrink-0 border border-white/5">
                          {pl.coverUrl ? (
                            <img
                              src={pl.coverUrl}
                              alt={pl.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-500">
                              <Music2 className="w-4 h-4" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-medium text-white truncate">{pl.name}</h4>
                          <p className="text-[10px] text-zinc-500 truncate mt-0.5">
                            {pl.totalSongs} 首单曲
                          </p>
                        </div>
                        {addingPlaylistId === pl.id && (
                          <Loader2 className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* 本地导入歌单 */}
              {importedPlaylists.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 px-1 mb-2 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                    <Folder className="w-3.5 h-3.5 text-blue-400" />
                    <span>本地导入歌单</span>
                  </div>
                  <div className="space-y-1">
                    {importedPlaylists.map((pl) => (
                      <button
                        key={pl.id}
                        disabled={addingPlaylistId === pl.id}
                        onClick={() => handleSelectPlaylist(pl)}
                        className="w-full flex items-center gap-3 p-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.08] active:scale-[0.99] border border-transparent hover:border-blue-500/30 text-left transition-all"
                      >
                        <div className="w-9 h-9 rounded-lg overflow-hidden bg-zinc-800 shrink-0 border border-white/5">
                          {pl.coverUrl ? (
                            <img
                              src={pl.coverUrl}
                              alt={pl.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-zinc-500">
                              <Music2 className="w-4 h-4" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="text-xs font-medium text-white truncate">{pl.name}</h4>
                          <p className="text-[10px] text-zinc-500 truncate mt-0.5">
                            {pl.totalSongs} 首单曲
                          </p>
                        </div>
                        {addingPlaylistId === pl.id && (
                          <Loader2 className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
