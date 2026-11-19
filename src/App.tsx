/**
 * 应用程序根组件 (src/App.tsx)
 * 非对称三栏：236px 歌单栏 · 自适应主区 · 384px 歌词栏
 * 视觉口径见 DESIGN.md：暖墨底 + 赭橙单一主色 + 发丝线分区
 */

import React, { useEffect, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { PlayerProvider, usePlayer } from './context/PlayerContext';
import { Sidebar } from './components/Sidebar';
import { SongList } from './components/SongList';
import { LyricsPanel } from './components/LyricsPanel';
import { PlayerBar } from './components/PlayerBar';
import { ImportModal } from './components/ImportModal';
import { SettingsModal } from './components/SettingsModal';
import { UpdateModal } from './components/UpdateModal';
import { closeTopOverlay } from './components/overlayStack';
import { isTauriEnvironment } from './services/http';
import { checkForUpdate, type UpdateCheckResult } from './services/updater';

/** 打开更新弹窗时带入的结果：null 表示这次打开要现场检查一次 */
interface UpdateDialogState {
  initial: UpdateCheckResult | null;
}

const AppContent: React.FC = () => {
  const { currentSong, isPlaying, togglePlay, nextSong, prevSong } = usePlayer();
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [updateDialog, setUpdateDialog] = useState<UpdateDialogState | null>(null);
  // 手动检查一旦发生，迟到的启动静默结果直接丢弃，两边不互相覆盖
  const manualCheckedRef = useRef(false);

  // 播放动作未必是稳定引用，监听只注册一次，回调里现取
  const mediaRef = useRef({ togglePlay, nextSong, prevSong });
  mediaRef.current = { togglePlay, nextSong, prevSong };

  const openUpdateModal = () => {
    manualCheckedRef.current = true;
    setUpdateDialog({ initial: null });
  };

  // 启动静默检查：不打扰，也不提示「已是最新」，只有真发现新版本才开弹窗
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void checkForUpdate().then((res) => {
        if (cancelled || manualCheckedRef.current) return;
        if (!res.ok || !res.available) return;
        setUpdateDialog({ initial: res });
      });
    }, 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  // Android 物理返回键：有弹层就关最内层，没有就不接管，让原生决定是否退出。
  // 原生侧在派发事件后读取 window.__kugouBackHandled 判断是否需要吞掉这次返回键。
  useEffect(() => {
    const onBack = () => {
      const closed = closeTopOverlay();
      (window as Window & { __kugouBackHandled?: boolean }).__kugouBackHandled = closed;
    };
    document.addEventListener('app-back', onBack);
    return () => document.removeEventListener('app-back', onBack);
  }, []);

  // Android 前台服务保活：原生 onStop 时读取 window.__kugouPlaying 决定要不要 startForegroundService
  useEffect(() => {
    (window as Window & { __kugouPlaying?: boolean }).__kugouPlaying = isPlaying;
  }, [isPlaying]);

  // 菜单栏 / 托盘 / 蓝牙媒体键（仅 Tauri 桌面端有原生入口）
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen<string>('app:media-control', (event) => {
      const handlers = mediaRef.current;
      if (event.payload === 'toggle') handlers.togglePlay();
      else if (event.payload === 'next') handlers.nextSong();
      else if (event.payload === 'prev') handlers.prevSong();
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // 当前曲目变化时同步托盘文案（仅 Tauri 桌面端）
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    const label = currentSong ? `${currentSong.songName} - ${currentSong.singerName}` : '';
    void emit('tray:set-now-playing', label);
  }, [currentSong]);

  return (
    <div className="app-shell">
      {/* 主界面：侧栏 + 主区 + 歌词栏（三栏宽度刻意不等分） */}
      <div className="app-body">
        <Sidebar
          onOpenImport={() => setIsImportOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />

        <SongList
          onOpenImport={() => setIsImportOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />

        <LyricsPanel />
      </div>

      {/* 底部播放条：桌面固定底栏 / 移动端卡片式 Mini 条 */}
      <PlayerBar />

      {/* 全局弹窗 */}
      <ImportModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onOpenUpdate={openUpdateModal}
      />
      {/* 应用更新弹窗：启动静默检查发现新版本时自动打开，也可手动打开 */}
      {updateDialog && (
        <UpdateModal
          initialResult={updateDialog.initial}
          onClose={() => setUpdateDialog(null)}
        />
      )}
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <PlayerProvider>
      <AppContent />
    </PlayerProvider>
  );
};

export default App;
