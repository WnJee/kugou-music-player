/**
 * 应用程序根组件 (src/App.tsx)
 * 组织深色毛玻璃响应式三栏架构：左侧歌单边栏 + 中部曲目详情 + 右侧动效歌词 + 底部播放控制条
 */

import React, { useState } from 'react';
import { PlayerProvider } from './context/PlayerContext';
import { Sidebar } from './components/Sidebar';
import { SongList } from './components/SongList';
import { LyricsPanel } from './components/LyricsPanel';
import { PlayerBar } from './components/PlayerBar';
import { ImportModal } from './components/ImportModal';
import { SettingsModal } from './components/SettingsModal';

const AppContent: React.FC = () => {
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-gradient-to-br from-zinc-950 via-zinc-900 to-black text-zinc-100 select-none relative">
      {/* 背景动态毛玻璃氛围晕光 */}
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-cyan-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute top-1/3 -right-32 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 left-1/3 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* 主界面三栏布局 */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        {/* 左侧边栏（平板/桌面端可见） */}
        <Sidebar
          onOpenImport={() => setIsImportOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />

        {/* 中间歌曲列表（多端通用） */}
        <SongList
          onOpenImport={() => setIsImportOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
        />

        {/* 右侧歌词面板（桌面端/宽屏可见） */}
        <LyricsPanel />
      </div>

      {/* 底部播放条（桌面固定底栏 + 移动端悬浮条） */}
      <PlayerBar />

      {/* 全局导入与设置弹窗 */}
      <ImportModal isOpen={isImportOpen} onClose={() => setIsImportOpen(false)} />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
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
