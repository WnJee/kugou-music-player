/**
 * 歌曲列表视图 (src/components/SongList.tsx)
 * 适配移动端及平板/桌面端，支持酷狗全网歌曲/歌手搜索、即时播放、以及加入歌单并同步云端
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  ArrowLeft,
  Clock,
  FolderPlus,
  Loader2,
  Music2,
  Play,
  Plus,
  Search,
  Settings,
  Sparkles,
  Volume2,
  X,
} from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { searchKuGouSongs } from '../services/kugouPlaylist';
import { AddToPlaylistModal } from './AddToPlaylistModal';
import type { KuGouSong } from '../types/music';

interface SongListProps {
  onOpenImport: () => void;
  onOpenSettings: () => void;
}

/**
 * 格式化秒数为 mm:ss
 */
function formatSeconds(secs: number): string {
  if (!secs || isNaN(secs)) return '00:00';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export const SongList: React.FC<SongListProps> = ({ onOpenImport, onOpenSettings }) => {
  const { activePlaylist, currentSong, isPlaying, playSong } = usePlayer();
  const [searchQuery, setSearchQuery] = useState('');

  // 全网搜索状态
  const [isGlobalSearching, setIsGlobalSearching] = useState(false);
  const [globalKeyword, setGlobalKeyword] = useState('');
  const [globalResults, setGlobalResults] = useState<KuGouSong[]>([]);
  const [isSearchLoading, setIsSearchLoading] = useState(false);

  // 添加到歌单弹窗控制
  const [selectedSongForAdd, setSelectedSongForAdd] = useState<KuGouSong | null>(null);

  // 触发酷狗全网搜索
  const handleTriggerGlobalSearch = async (kw?: string) => {
    const target = (kw !== undefined ? kw : searchQuery).trim();
    if (!target) return;

    setIsGlobalSearching(true);
    setGlobalKeyword(target);
    setIsSearchLoading(true);

    try {
      const results = await searchKuGouSongs(target);
      setGlobalResults(results);
    } catch (err) {
      console.error('[handleTriggerGlobalSearch] 搜索失败:', err);
    } finally {
      setIsSearchLoading(false);
    }
  };

  // 退出全网搜索返回歌单
  const handleExitGlobalSearch = () => {
    setIsGlobalSearching(false);
    setGlobalResults([]);
    setGlobalKeyword('');
  };

  // 歌单内搜索过滤
  const filteredPlaylistSongs = useMemo(() => {
    if (!activePlaylist?.songs) return [];
    // 倒序展示：最新添加的排在前面
    const reversed = [...activePlaylist.songs].reverse();
    if (!searchQuery.trim()) return reversed;
    const query = searchQuery.toLowerCase().trim();
    return reversed.filter(
      (s) =>
        s.songName.toLowerCase().includes(query) ||
        s.singerName.toLowerCase().includes(query)
    );
  }, [activePlaylist, searchQuery]);

  // 正在播放的歌曲自动滚动到可见区域
  const listContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!currentSong) return;
    const el = listContainerRef.current?.querySelector(
      `[data-song-hash="${currentSong.hash}"]`
    );
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentSong]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-zinc-950/40 relative">
      {/* 移动端顶部状态条（小屏可见） */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-zinc-900/60 backdrop-blur-xl border-b border-white/10 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <h1 className="font-bold text-sm bg-gradient-to-r from-white to-zinc-300 bg-clip-text text-transparent">
            酷狗播放器
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onOpenImport}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition-colors"
          >
            <FolderPlus className="w-4 h-4" />
            <span>导入</span>
          </button>
          <button
            onClick={onOpenSettings}
            className="p-2 rounded-xl bg-white/5 text-zinc-300 hover:bg-white/10 transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 顶部搜索操作栏 */}
      <div className="px-4 md:px-8 pt-4 pb-2 shrink-0">
        <div className="flex items-center gap-2 max-w-xl">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="搜索歌曲名称或歌手（回车或点击全网搜索）..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleTriggerGlobalSearch();
                }
              }}
              className="w-full pl-9 pr-9 py-2 bg-white/[0.04] border border-white/10 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            onClick={() => handleTriggerGlobalSearch()}
            disabled={!searchQuery.trim() || isSearchLoading}
            className="px-4 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 disabled:hover:bg-cyan-500 text-white font-medium text-xs shadow-sm transition-all shrink-0 flex items-center gap-1.5"
          >
            {isSearchLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Search className="w-3.5 h-3.5" />
            )}
            <span>全网搜索</span>
          </button>
        </div>
      </div>

      {/* 主展示滚动容器 */}
      <div ref={listContainerRef} className="flex-1 overflow-y-auto px-4 md:px-8 pb-8 pt-2 space-y-6 custom-scrollbar">
        {/* 模式 A：全网搜索结果视图 */}
        {isGlobalSearching ? (
          <div className="space-y-4">
            {/* 搜索结果头部工具栏 */}
            <div className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/10">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleExitGlobalSearch}
                  className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white flex items-center gap-1 text-xs transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>返回歌单</span>
                </button>
                <h2 className="text-sm font-bold text-white">
                  搜索结果: “{globalKeyword}”
                  <span className="text-xs text-zinc-400 font-normal ml-2">
                    (共 {globalResults.length} 首)
                  </span>
                </h2>
              </div>
            </div>

            {/* 搜索结果表格 */}
            <div className="rounded-2xl border border-white/5 bg-white/[0.01] overflow-hidden">
              <div className="hidden sm:grid grid-cols-[52px_minmax(96px,1fr)_64px_88px] xl:grid-cols-[52px_minmax(120px,1fr)_150px_64px_96px] gap-3 px-4 py-2.5 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider border-b border-white/5 bg-white/[0.02]">
                <div className="text-center">#</div>
                <div className="whitespace-nowrap">歌曲标题</div>
                <div className="hidden xl:block whitespace-nowrap">歌手</div>
                <div className="text-center whitespace-nowrap">时长</div>
                <div className="text-right pr-2 whitespace-nowrap">操作</div>
              </div>

              {isSearchLoading ? (
                <div className="py-20 flex flex-col items-center justify-center gap-3 text-zinc-400">
                  <Loader2 className="w-7 h-7 text-cyan-400 animate-spin" />
                  <p className="text-xs">正在搜索酷狗音乐全网音源...</p>
                </div>
              ) : globalResults.length === 0 ? (
                <div className="py-20 text-center text-xs text-zinc-500">
                  未找到与 “{globalKeyword}” 相关的歌曲
                </div>
              ) : (
                <div className="divide-y divide-white/[0.03]">
                  {globalResults.map((song, index) => {
                    const isCurrent = currentSong?.hash === song.hash;

                    return (
                      <div
                        key={`${song.hash}-${index}`}
                        data-song-hash={song.hash}
                        onClick={() => playSong(song)}
                        className={`group relative grid grid-cols-[40px_minmax(0,1fr)] sm:grid-cols-[52px_minmax(96px,1fr)_64px_88px] xl:grid-cols-[52px_minmax(120px,1fr)_150px_64px_96px] items-center gap-3 px-3 sm:px-4 py-2.5 transition-colors cursor-pointer ${
                          isCurrent
                            ? 'bg-cyan-500/10 text-cyan-300'
                            : 'hover:bg-white/[0.04] text-zinc-300 hover:text-white'
                        }`}
                      >
                        {/* 序号与播放 */}
                        <div className="flex items-center justify-center w-10 sm:w-[52px] h-6 shrink-0">
                          {isCurrent && isPlaying ? (
                            <Volume2 className="w-4 h-4 text-cyan-400 animate-bounce" />
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                playSong(song);
                              }}
                              className="w-7 h-7 sm:w-6 sm:h-6 rounded-full bg-white/10 group-hover:bg-cyan-500 text-zinc-300 group-hover:text-white flex items-center justify-center transition-all"
                            >
                              <Play className="w-3 h-3 fill-current ml-0.5" />
                            </button>
                          )}
                        </div>

                        {/* 封面与歌名 */}
                        <div className="flex items-center gap-3 min-w-0">
                          {song.coverUrl ? (
                            <img
                              src={song.coverUrl}
                              alt={song.songName}
                              className="w-10 h-10 rounded-lg object-cover bg-zinc-800 shrink-0 border border-white/5"
                              loading="lazy"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-500 shrink-0">
                              <Music2 className="w-4 h-4" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <h4
                              className={`text-xs sm:text-sm font-medium truncate ${
                                isCurrent ? 'text-cyan-400 font-semibold' : ''
                              }`}
                            >
                              {song.songName}
                            </h4>
                            <p className="sm:hidden text-[11px] text-zinc-400 truncate mt-0.5">
                              {song.singerName}
                            </p>
                          </div>
                        </div>

                        {/* 歌手 */}
                        <div className="hidden xl:block text-xs text-zinc-400 truncate">
                          {song.singerName}
                        </div>

                        {/* 时长 */}
                        <div className="hidden sm:block text-center text-xs text-zinc-500 font-mono">
                          {formatSeconds(song.duration)}
                        </div>

                        {/* 操作区：播放与加入歌单 */}
                        <div className="flex items-center justify-end gap-1.5 shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              playSong(song);
                            }}
                            title="立即播放"
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-cyan-500 hover:text-white text-zinc-400 transition-colors"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedSongForAdd(song);
                            }}
                            title="加入歌单并同步"
                            className="whitespace-nowrap p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-zinc-400 hover:text-cyan-400 transition-colors flex items-center gap-1 text-xs"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span className="hidden lg:inline text-[11px]">加入歌单</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : !activePlaylist ? (
          /* 模式 B：未选歌单且未搜索时的欢迎空状态 */
          <div className="flex flex-col items-center justify-center h-[55vh] text-center max-w-sm mx-auto">
            <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-4 shadow-xl shadow-cyan-500/10">
              <FolderPlus className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-bold text-white mb-2">欢迎使用酷狗无损播放器</h2>
            <p className="text-xs text-zinc-400 leading-relaxed mb-6">
              纯本地无服务运行，支持直接粘贴酷狗分享短链、酷狗码，或在上方直接搜索歌曲/歌手直接播放。
            </p>
            <div className="flex gap-3">
              <button
                onClick={onOpenImport}
                className="px-5 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white font-medium text-xs shadow-sm active:scale-95 transition-all"
              >
                导入酷狗歌单
              </button>
              <button
                onClick={onOpenSettings}
                className="px-5 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-white font-medium text-xs shadow-sm active:scale-95 transition-all"
              >
                扫码授权账号
              </button>
            </div>
          </div>
        ) : (
          /* 模式 C：当前活动歌单曲目列表 */
          <>
            {/* 歌单 Hero Banner 头部 */}
            <div className="flex flex-col sm:flex-row gap-5 items-start sm:items-center p-4 sm:p-6 rounded-2xl bg-gradient-to-br from-white/[0.04] to-white/[0.01] border border-white/10 backdrop-blur-xl shadow-xl">
              <div className="relative w-28 h-28 sm:w-36 sm:h-36 rounded-xl overflow-hidden shrink-0 shadow-2xl shadow-black/60 bg-zinc-800 border border-white/10">
                {activePlaylist.coverUrl ? (
                  <img
                    src={activePlaylist.coverUrl}
                    alt={activePlaylist.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-zinc-600">
                    <Sparkles className="w-10 h-10" />
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-[11px] font-medium mb-2">
                  <Sparkles className="w-3 h-3" />
                  <span>
                    {activePlaylist.isUserOwned
                      ? '酷狗账号云歌单'
                      : activePlaylist.sourceType === 'kugou_code'
                      ? '酷狗码导入'
                      : '本地导入歌单'}
                  </span>
                </div>

                <h1 className="text-xl sm:text-2xl font-bold text-white truncate mb-1.5">
                  {activePlaylist.name}
                </h1>

                {activePlaylist.intro && (
                  <p className="text-xs text-zinc-400 line-clamp-2 mb-3">
                    {activePlaylist.intro}
                  </p>
                )}

                <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-400">
                  <span>共 {activePlaylist.totalSongs} 首单曲</span>
                  <span>·</span>
                  <span>
                    导入于 {new Date(activePlaylist.importedAt).toLocaleDateString()}
                  </span>
                </div>

                {/* 快速播放全部按钮 */}
                {activePlaylist.songs.length > 0 && (
                  <div className="mt-4 flex items-center gap-3">
                    <button
                      onClick={() =>
                        playSong(activePlaylist.songs[activePlaylist.songs.length - 1])
                      }
                      className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-medium text-xs shadow-lg shadow-cyan-500/20 active:scale-95 transition-all"
                    >
                      <Play className="w-3.5 h-3.5 fill-white" />
                      <span>播放全部</span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* 歌单内列表统计与快速全网搜索提示 */}
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs text-zinc-400">
                当前歌单显示 {filteredPlaylistSongs.length} / {activePlaylist.songs.length} 首歌
              </span>

              {searchQuery.trim() && (
                <button
                  onClick={() => handleTriggerGlobalSearch()}
                  className="text-xs text-cyan-400 hover:text-cyan-300 underline underline-offset-4 flex items-center gap-1"
                >
                  <Search className="w-3 h-3" />
                  <span>找不到？在酷狗全网搜索 “{searchQuery}”</span>
                </button>
              )}
            </div>

            {/* 歌曲表格 */}
            <div className="rounded-2xl border border-white/5 bg-white/[0.01] overflow-hidden">
              <div className="hidden sm:grid grid-cols-[52px_minmax(96px,1fr)_64px_88px] xl:grid-cols-[52px_minmax(120px,1fr)_150px_64px_96px] gap-3 px-4 py-2.5 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider border-b border-white/5 bg-white/[0.02]">
                <div className="text-center">#</div>
                <div className="whitespace-nowrap">歌曲标题</div>
                <div className="hidden xl:block whitespace-nowrap">歌手</div>
                <div className="text-center whitespace-nowrap">时长</div>
                <div className="text-right pr-2 whitespace-nowrap">操作</div>
              </div>

              <div className="divide-y divide-white/[0.03]">
                {filteredPlaylistSongs.length === 0 ? (
                  <div className="py-12 text-center text-xs text-zinc-500">
                    {searchQuery ? `歌单内未找到与 “${searchQuery}” 相关的歌曲` : '歌单内暂无歌曲'}
                  </div>
                ) : (
                  filteredPlaylistSongs.map((song: KuGouSong, index: number) => {
                    const isCurrent = currentSong?.hash === song.hash;

                    return (
                      <div
                        key={`${song.hash}-${index}`}
                        data-song-hash={song.hash}
                        onClick={() => playSong(song)}
                        className={`group relative grid grid-cols-[40px_minmax(0,1fr)] sm:grid-cols-[52px_minmax(96px,1fr)_64px_88px] xl:grid-cols-[52px_minmax(120px,1fr)_150px_64px_96px] items-center gap-3 px-3 sm:px-4 py-2.5 transition-colors cursor-pointer ${
                          isCurrent
                            ? 'bg-cyan-500/10 text-cyan-300'
                            : 'hover:bg-white/[0.04] text-zinc-300 hover:text-white'
                        }`}
                      >
                        {/* 序号 / 播放按钮（悬停显示，标准播放器交互） */}
                        <div className="flex items-center justify-center w-10 sm:w-[52px] h-6">
                          {isCurrent && isPlaying ? (
                            <div className="flex items-end gap-[2px] h-3.5" aria-label="正在播放">
                              <span className="w-[3px] h-2 bg-cyan-400 rounded-sm animate-pulse" />
                              <span className="w-[3px] h-3.5 bg-cyan-400 rounded-sm animate-pulse [animation-delay:150ms]" />
                              <span className="w-[3px] h-2.5 bg-cyan-400 rounded-sm animate-pulse [animation-delay:300ms]" />
                            </div>
                          ) : (
                            <>
                              <span className="text-xs text-zinc-500 font-mono group-hover:hidden tabular-nums">
                                {index + 1}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  playSong(song);
                                }}
                                title="播放"
                                className="hidden group-hover:flex w-6 h-6 rounded-full bg-cyan-500 text-white items-center justify-center transition-all"
                              >
                                <Play className="w-3 h-3 fill-current ml-0.5" />
                              </button>
                            </>
                          )}
                        </div>
                        {/* 封面与标题 */}
                        <div className="flex items-center gap-3 min-w-0">
                          {song.coverUrl && (
                            <img
                              src={song.coverUrl}
                              alt={song.songName}
                              className="w-10 h-10 rounded-lg object-cover bg-zinc-800 shrink-0 border border-white/5"
                              loading="lazy"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <h4
                              className={`text-xs sm:text-sm font-medium truncate ${
                                isCurrent ? 'text-cyan-400 font-semibold' : ''
                              }`}
                            >
                              {song.songName}
                            </h4>
                            <p className="sm:hidden text-[11px] text-zinc-400 truncate mt-0.5">
                              {song.singerName}
                            </p>
                          </div>
                        </div>

                        {/* 歌手 */}
                        <div className="hidden xl:block text-xs text-zinc-400 truncate">
                          {song.singerName}
                        </div>
                        {/* 时长 */}
                        <div className="hidden sm:block text-center text-xs text-zinc-500 font-mono tabular-nums">
                          {formatSeconds(song.duration)}
                        </div>

                        {/* 操作区 */}
                        <div className="flex items-center justify-end gap-1.5 shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedSongForAdd(song);
                            }}
                            title="添加到其他歌单"
                            className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 bg-white/5 hover:bg-white/15 text-zinc-400 hover:text-cyan-400 transition-all flex items-center gap-1 text-xs"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span className="hidden lg:inline text-[11px]">收藏</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* 添加到歌单弹窗 */}
      <AddToPlaylistModal
        isOpen={Boolean(selectedSongForAdd)}
        song={selectedSongForAdd}
        onClose={() => setSelectedSongForAdd(null)}
      />
    </div>
  );
};

