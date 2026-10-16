/**
 * 歌单导入弹窗组件 (src/components/ImportModal.tsx)
 */

import React, { useState } from 'react';
import { FolderPlus, Loader2, Sparkles, X } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { importKuGouPlaylist } from '../services/kugouPlaylist';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({ isOpen, onClose }) => {
  const { refreshPlaylists, selectPlaylist } = usePlayer();
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleImport = async () => {
    if (!inputText.trim()) return;
    setIsLoading(true);
    setErrorMsg(null);

    try {
      const playlist = await importKuGouPlaylist(inputText.trim());
      await refreshPlaylists();
      selectPlaylist(playlist);
      setInputText('');
      onClose();
    } catch (err: unknown) {
      console.error('[ImportModal] 导入失败:', err);
      setErrorMsg(err instanceof Error ? err.message : '解析或导入失败，请检查输入格式');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in select-none">
      <div className="w-full max-w-md rounded-2xl bg-zinc-900 border border-white/10 p-6 shadow-2xl text-white relative">
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* 标题 */}
        <div className="flex items-center gap-2.5 mb-4">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center">
            <FolderPlus className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold">导入酷狗歌单</h2>
            <p className="text-xs text-zinc-400">支持短链、酷狗口令码或纯数字 ID</p>
          </div>
        </div>

        {/* 输入框 */}
        <div className="mb-4">
          <textarea
            rows={3}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="请在此粘贴酷狗分享文本或链接，例如：&#10;https://t1.kugou.com/xxxx 或 酷狗码 ￥abc123￥"
            className="w-full p-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 resize-none font-mono"
          />
        </div>

        {/* 错误提示 */}
        {errorMsg && (
          <div className="mb-4 p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
            {errorMsg}
          </div>
        )}

        {/* 示例提示 */}
        <div className="mb-6 p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-400">
            <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
            <span>输入格式支持</span>
          </div>
          <ul className="text-[11px] text-zinc-500 space-y-1 list-disc list-inside">
            <li>酷狗手机 App 分享短链（如 https://t1.kugou.com/...）</li>
            <li>酷狗码 / 复制口令（支持带 ￥ 符号的口令字符串）</li>
            <li>纯数字歌单 ID（如 3280341）或网页版专辑 URL</li>
          </ul>
        </div>

        {/* 提交按钮 */}
        <div className="flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-zinc-400 hover:text-white hover:bg-white/5 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleImport}
            disabled={isLoading || !inputText.trim()}
            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 disabled:opacity-50 text-white font-medium text-xs shadow-lg shadow-cyan-500/25 active:scale-95 transition-all"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>正在解析歌单...</span>
              </>
            ) : (
              <span>开始导入</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
