/**
 * 应用程序根组件 (src/App.tsx)
 * 非对称三栏：236px 歌单栏 · 自适应主区 · 384px 歌词栏
 * 视觉口径见 DESIGN.md：暖墨底 + 赭橙单一主色 + 发丝线分区
 */

import React, { useState } from 'react';
import { PlayerProvider } from './context/PlayerContext';
import { Sidebar } from './components/Sidebar';
import { SongList } from './components/SongList';
import { LyricsPanel } from './components/LyricsPanel';
import { PlayerBar } from './components/PlayerBar';
import { ImportModal } from './components/ImportModal';
import { SettingsModal } from './components/SettingsModal';
import { UpdateModal } from './components/UpdateModal';

const AppContent: React.FC = () => {
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // 更新弹窗：0 = 未打开（启动静默检查），>0 = 打开并触发一次检查
  const [updateCheckSignal, setUpdateCheckSignal] = useState(0);
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);

  const openUpdateModal = () => {
    setUpdateCheckSignal((n) => n + 1);
    setIsUpdateOpen(true);
  };

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
      {/* 应用更新弹窗（启动静默检查 + 手动检查） */}
      {isUpdateOpen && (
        <UpdateModal checkSignal={updateCheckSignal} onClose={() => setIsUpdateOpen(false)} />
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
