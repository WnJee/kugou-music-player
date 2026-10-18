/**
 * 歌曲列表视图 (src/components/SongList.tsx)
 * 三种状态：全网搜索结果 / 未选歌单空态（左对齐）/ 歌单曲目列表
 * 视觉口径见 DESIGN.md：表头只出现一次、行分隔用发丝线、选中靠 2px 竖条
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  FolderPlus,
  Loader2,
  Plus,
  Play,
  Search,
  Settings,
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

function formatSeconds(secs: number): string {
  if (!secs || isNaN(secs)) return '--:--';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

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

export const SongList: React.FC<SongListProps> = ({ onOpenImport, onOpenSettings }) => {
  const { playlists, activePlaylist, selectPlaylist, currentSong, isPlaying, playSong, playAll } = usePlayer();
  const [searchQuery, setSearchQuery] = useState('');
  const [isPlaylistDrawerOpen, setIsPlaylistDrawerOpen] = useState(false);

  const [isGlobalSearching, setIsGlobalSearching] = useState(false);
  const [globalKeyword, setGlobalKeyword] = useState('');
  const [globalResults, setGlobalResults] = useState<KuGouSong[]>([]);
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [selectedSongForAdd, setSelectedSongForAdd] = useState<KuGouSong | null>(null);

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

  const handleExitGlobalSearch = () => {
    setIsGlobalSearching(false);
    setGlobalResults([]);
    setGlobalKeyword('');
  };

  const filteredPlaylistSongs = useMemo(() => {
    if (!activePlaylist?.songs) return [];
    const reversed = [...activePlaylist.songs].reverse();
    if (!searchQuery.trim()) return reversed;
    const query = searchQuery.toLowerCase().trim();
    return reversed.filter(
      (s) =>
        s.songName.toLowerCase().includes(query) ||
        s.singerName.toLowerCase().includes(query)
    );
  }, [activePlaylist, searchQuery]);

  const listContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!currentSong) return;
    const el = listContainerRef.current?.querySelector(
      `[data-song-hash="${currentSong.hash}"]`
    );
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentSong]);

  const totalSongs = activePlaylist?.songs.length ?? 0;
  const listCount = isGlobalSearching ? globalResults.length : filteredPlaylistSongs.length;

  return (
    <div className="main">
      {/* 移动端顶栏：左对齐的品牌 + 歌单，右侧两个动作 */}
      <div className="main-bar md:hidden">
        <button
          type="button"
          onClick={() => setIsPlaylistDrawerOpen(true)}
          className="min-w-0 flex-1 text-left"
        >
          <span
            className="mono block"
            style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)', letterSpacing: '0.1em' }}
          >
            歌单
          </span>
          <span
            className="block truncate"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 'var(--fs-4)',
              color: 'var(--ink-0)',
            }}
          >
            {activePlaylist?.name || '未选择'}
          </span>
        </button>
        <button type="button" onClick={onOpenImport} className="icon-btn" title="导入歌单">
          <FolderPlus size={17} strokeWidth={1.6} />
        </button>
        <button type="button" onClick={onOpenSettings} className="icon-btn" title="账号设置">
          <Settings size={17} strokeWidth={1.6} />
        </button>
      </div>

      {/* 桌面端搜索条 */}
      <div className="main-bar hidden md:flex">
        <div className="relative" style={{ width: 300 }}>
          <Search
            size={14}
            strokeWidth={1.8}
            className="pointer-events-none absolute"
            style={{ left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}
          />
          <input
            type="text"
            placeholder="搜索歌曲或歌手"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTriggerGlobalSearch();
            }}
            className="field"
            style={{ paddingLeft: 30, paddingRight: searchQuery ? 28 : 10 }}
            aria-label="搜索歌曲或歌手"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="icon-btn absolute"
              style={{ right: 2, top: '50%', transform: 'translateY(-50%)', width: 24, height: 24 }}
              title="清空"
            >
              <X size={13} strokeWidth={1.8} />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => handleTriggerGlobalSearch()}
          disabled={!searchQuery.trim() || isSearchLoading}
          className="btn"
        >
          {isSearchLoading ? (
            <Loader2 size={13} className="spin" strokeWidth={2} />
          ) : (
            <Search size={13} strokeWidth={1.8} />
          )}
          <span>全网搜索</span>
        </button>

        <div className="flex-1" />

        <button type="button" onClick={onOpenImport} className="btn" title="导入歌单">
          <FolderPlus size={13} strokeWidth={1.8} />
          <span>导入</span>
        </button>
      </div>

      {/* 移动端搜索条 */}
      <div className="main-bar md:hidden" style={{ paddingTop: 0 }}>
        <div className="relative flex-1">
          <Search
            size={14}
            strokeWidth={1.8}
            className="pointer-events-none absolute"
            style={{ left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }}
          />
          <input
            type="text"
            placeholder="搜索歌曲或歌手"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTriggerGlobalSearch();
            }}
            className="field"
            style={{ paddingLeft: 30, height: 38, paddingRight: searchQuery ? 30 : 10 }}
            aria-label="搜索歌曲或歌手"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="icon-btn absolute"
              style={{ right: 0, top: '50%', transform: 'translateY(-50%)' }}
              title="清空"
            >
              <X size={15} strokeWidth={1.8} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => handleTriggerGlobalSearch()}
          disabled={!searchQuery.trim() || isSearchLoading}
          className="btn"
          style={{ height: 38 }}
        >
          {isSearchLoading ? <Loader2 size={14} className="spin" /> : <span>搜索</span>}
        </button>
      </div>

      {/* 滚动区 */}
      <div ref={listContainerRef} className="main-scroll">
        <div className="main-inner">
          {isGlobalSearching ? (
            /* ===== A. 全网搜索结果 ===== */
            <>
              <div className="sheet-head" style={{ alignItems: 'center', paddingBottom: 16 }}>
                <button
                  type="button"
                  onClick={handleExitGlobalSearch}
                  className="icon-btn"
                  title="返回歌单"
                >
                  <ArrowLeft size={16} strokeWidth={1.8} />
                </button>
                <div className="min-w-0 flex-1">
                  <h1 className="sheet-title truncate" style={{ fontSize: 'var(--fs-5)' }}>
                    “{globalKeyword}”
                  </h1>
                  <p className="sheet-meta" style={{ marginTop: 6 }}>
                    <span>全网检索</span>
                    <span className="sep">/</span>
                    <span>{listCount} 个结果</span>
                  </p>
                </div>
              </div>

              {isSearchLoading ? (
                <div className="py-16" aria-busy="true" aria-label="正在搜索">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 py-3"
                      style={{ borderBottom: '1px solid var(--line-soft)', opacity: 1 - i * 0.15 }}
                    >
                      <div
                        className="skeleton"
                        style={{ width: 34, height: 34, borderRadius: 'var(--r-1)' }}
                      />
                      <div className="flex-1">
                        <div className="skeleton" style={{ width: `${58 - i * 6}%` }} />
                        <div className="skeleton mt-2" style={{ width: '26%', height: 8 }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : globalResults.length === 0 ? (
                <div className="empty">
                  <h2 className="empty-title">没有匹配的结果</h2>
                  <p className="empty-body">
                    换一个关键词，或只输入歌名的一部分。也可以直接粘贴酷狗分享链接触发导入。
                  </p>
                  <div className="empty-rule" />
                  <div className="empty-actions">
                    <button type="button" onClick={handleExitGlobalSearch} className="btn btn-lg">
                      返回歌单
                    </button>
                    <button type="button" onClick={onOpenImport} className="btn btn-quiet btn-lg">
                      导入分享链接
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ marginTop: 4 }}>
                  <div
                    className="list-head"
                    style={{ gridTemplateColumns: '30px minmax(0,1fr) 74px 72px' }}
                  >
                    <span>#</span>
                    <span>曲目</span>
                    <span>时长</span>
                    <span>操作</span>
                  </div>
                  {globalResults.map((song, index) => {
                    const isCurrent = currentSong?.hash === song.hash;
                    return (
                      <div
                        key={`${song.hash}-${index}`}
                        data-song-hash={song.hash}
                        data-playing={isCurrent}
                        onClick={() => playSong(song, { insertFront: true })}
                        className="row"
                        style={{ gridTemplateColumns: '30px minmax(0,1fr) 74px 72px' }}
                      >
                        <span className="row-idx">
                          {isCurrent && isPlaying ? (
                            <span className="bars">
                              <i />
                              <i />
                              <i />
                            </span>
                          ) : (
                            <span className="mono">{String(index + 1).padStart(2, '0')}</span>
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

                        <span className="row-time">{formatSeconds(song.duration)}</span>

                        <span className="row-actions">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedSongForAdd(song);
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
                  })}
                </div>
              )}
            </>
          ) : !activePlaylist ? (
            /* ===== B. 空态：左对齐，给一条可执行的路 ===== */
            <div className="empty" style={{ paddingTop: 64 }}>
              <h1 className="empty-title">
                你还没有
                <br />
                导入任何歌单。
              </h1>
              <p className="empty-body">
                这个播放器不经过任何服务器。粘贴酷狗分享短链、酷狗码，或直接在上方搜索全网音源即可开始。
              </p>
              <div className="empty-rule" />
              <div className="empty-actions">
                <button type="button" onClick={onOpenImport} className="btn btn-primary btn-lg">
                  <FolderPlus size={14} strokeWidth={1.8} />
                  导入歌单
                </button>
                <button type="button" onClick={onOpenSettings} className="btn btn-lg">
                  扫码登录
                </button>
              </div>
            </div>
          ) : (
            /* ===== C. 歌单曲目 ===== */
            <>
              <header className="sheet-head">
                {activePlaylist.coverUrl ? (
                  <img src={activePlaylist.coverUrl} alt="" className="sheet-cover" />
                ) : (
                  <span className="cover-ph sheet-cover" data-size="lg" aria-hidden>
                    {activePlaylist.name.trim().charAt(0) || '·'}
                  </span>
                )}

                <div className="min-w-0 flex-1">
                  <p className="microcaps" style={{ marginBottom: 7 }}>
                    {activePlaylist.isUserOwned
                      ? '账号歌单'
                      : activePlaylist.sourceType === 'kugou_code'
                      ? '酷狗码'
                      : '本地导入'}
                  </p>
                  <h1 className="sheet-title">{activePlaylist.name}</h1>

                  {activePlaylist.intro && <p className="sheet-intro">{activePlaylist.intro}</p>}

                  <div className="sheet-meta">
                    <span>{String(activePlaylist.totalSongs).padStart(2, '0')} 首</span>
                    <span className="sep">/</span>
                    <span>
                      {new Date(activePlaylist.importedAt).toLocaleDateString('zh-CN', {
                        year: 'numeric',
                        month: '2-digit',
                        day: '2-digit',
                      })}
                    </span>
                  </div>

                  {/* 播放全部：归属歌单，跟着歌单信息走（移动端也可见）。
                      有搜索过滤时只播筛选结果，符合「所见即所播」。 */}
                  {activePlaylist.songs.length > 0 && (
                    <div className="sheet-actions">
                      <button
                        type="button"
                        onClick={() =>
                          playAll(
                            filteredPlaylistSongs.length > 0
                              ? filteredPlaylistSongs
                              : [...activePlaylist.songs].reverse()
                          )
                        }
                        className="btn btn-primary"
                        title="从第一首开始播放"
                      >
                        <Play size={12} strokeWidth={2} fill="currentColor" />
                        <span>播放全部</span>
                      </button>
                      <span
                        className="mono"
                        style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}
                      >
                        {filteredPlaylistSongs.length === totalSongs
                          ? `${totalSongs} 首`
                          : `${filteredPlaylistSongs.length} / ${totalSongs} 首`}
                      </span>
                    </div>
                  )}
                </div>
              </header>

              <div
                className="flex items-center justify-between gap-3"
                style={{ padding: '14px 0 10px' }}
              >
                <span className="mono" style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
                  {filteredPlaylistSongs.length === totalSongs
                    ? `${totalSongs} 首`
                    : `${filteredPlaylistSongs.length} / ${totalSongs} 首`}
                </span>

                {searchQuery.trim() && (
                  <button
                    type="button"
                    onClick={() => handleTriggerGlobalSearch()}
                    className="btn btn-quiet"
                    style={{ height: 26, fontSize: 'var(--fs-1)' }}
                  >
                    <Search size={12} strokeWidth={1.8} />
                    在酷狗全网找「{searchQuery}」
                  </button>
                )}
              </div>

              <div className="list-head">
                <span>#</span>
                <span>曲目</span>
                <span>歌手</span>
                <span>时长</span>
                <span>操作</span>
              </div>

              {filteredPlaylistSongs.length === 0 ? (
                <div className="empty" style={{ paddingTop: 40 }}>
                  <h2 className="empty-title" style={{ fontSize: 'var(--fs-5)' }}>
                    {searchQuery ? `歌单内没有「${searchQuery}」` : '这个歌单还是空的'}
                  </h2>
                  <p className="empty-body">
                    {searchQuery
                      ? '换个关键词，或者去全网搜索里找同一首歌再收进歌单。'
                      : '从全网搜索结果里点「+」就能把歌收进来。'}
                  </p>
                </div>
              ) : (
                filteredPlaylistSongs.map((song: KuGouSong, index: number) => {
                  const isCurrent = currentSong?.hash === song.hash;
                  return (
                    <div
                      key={`${song.hash}-${index}`}
                      data-song-hash={song.hash}
                      data-playing={isCurrent}
                      onClick={() => playSong(song)}
                      className="row group"
                    >
                      <span className="row-idx">
                        {isCurrent && isPlaying ? (
                          <span className="bars">
                            <i />
                            <i />
                            <i />
                          </span>
                        ) : (
                          <span className="mono block group-hover:hidden">
                            {String(index + 1).padStart(2, '0')}
                          </span>
                        )}
                        {!(isCurrent && isPlaying) && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              playSong(song);
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
                      <span className="row-time">{formatSeconds(song.duration)}</span>

                      <span className="row-actions">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedSongForAdd(song);
                          }}
                          className="icon-btn opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                          style={{ width: 26, height: 26 }}
                          title="加入其他歌单"
                        >
                          <Plus size={14} strokeWidth={1.8} />
                        </button>
                      </span>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>

      {/* 移动端歌单抽屉：portal 挂到 body。
          不这样做的话，抽屉会落在 App 的层叠上下文里，被 z-index:60 的遮罩盖住，
          表现为"弹窗看不见 / 点不到 / 滚不动"。 */}
      {isPlaylistDrawerOpen &&
        createPortal(
          <div className="md:hidden">
            <div className="drawer-mask" onClick={() => setIsPlaylistDrawerOpen(false)} />
            <div className="drawer drawer-left">
              <div className="drawer-head">
                <span
                  className="min-w-0 flex-1 truncate"
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 'var(--fs-4)',
                    color: 'var(--ink-0)',
                  }}
                >
                  我的歌单
                </span>
                <span
                  className="mono shrink-0"
                  style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}
                >
                  {String(playlists.length).padStart(2, '0')}
                </span>
                <button
                  type="button"
                  onClick={() => setIsPlaylistDrawerOpen(false)}
                  className="icon-btn"
                  title="关闭"
                >
                  <X size={16} strokeWidth={1.8} />
                </button>
              </div>

              <div className="drawer-scroll" style={{ padding: '6px 0 12px' }}>
                {playlists.length === 0 ? (
                  <p className="rail-empty" style={{ borderTop: 0 }}>
                    还没有歌单。先导入一个 →
                  </p>
                ) : (
                  playlists.map((p) => {
                    const isActive = activePlaylist?.id === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          void selectPlaylist(p);
                          setIsPlaylistDrawerOpen(false);
                        }}
                        className="rail-item"
                        data-active={isActive}
                      >
                        {p.coverUrl ? (
                          <img
                            src={p.coverUrl}
                            alt=""
                            className="shrink-0 object-cover"
                            style={{ width: 34, height: 34, borderRadius: 'var(--r-1)' }}
                            loading="lazy"
                          />
                        ) : (
                          <span
                            className="cover-ph"
                            data-size="md"
                            style={{ width: 34, height: 34, borderRadius: 'var(--r-1)' }}
                            aria-hidden
                          >
                            {p.name.trim().charAt(0) || '·'}
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="name block" style={{ fontSize: 'var(--fs-3)' }}>
                            {p.name}
                          </span>
                          <span className="sub block mono">
                            {String(p.totalSongs).padStart(2, '0')} 首
                          </span>
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>,
          document.body
        )}

      <AddToPlaylistModal
        isOpen={Boolean(selectedSongForAdd)}
        song={selectedSongForAdd}
        onClose={() => setSelectedSongForAdd(null)}
      />
    </div>
  );
};
