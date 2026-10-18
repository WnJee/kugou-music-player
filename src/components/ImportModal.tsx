/**
 * 歌单导入弹窗 (src/components/ImportModal.tsx)
 * 单一输入 → 单一主操作。示例格式收进发丝线分区块，不用彩色 icon 卡堆叠。
 */

import React, { useState } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';
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
    if (!inputText.trim() || isLoading) return;
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
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        className="sheet"
        style={{ maxWidth: 460 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="导入酷狗歌单"
      >
        <div className="sheet-head-row">
          <div className="min-w-0 flex-1">
            <h2 className="sheet-title">导入歌单</h2>
            <p className="sheet-sub">粘贴分享链接、酷狗码，或直接输入歌单 ID</p>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" title="关闭">
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        <div className="sheet-body">
          <textarea
            rows={3}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleImport();
            }}
            placeholder={'https://t1.kugou.com/xxxx\n或 ￥abc123￥\n或 3280341'}
            className="field field-area"
            style={{ fontSize: 'var(--fs-2)' }}
            aria-label="歌单链接或酷狗码"
            autoFocus
          />

          {errorMsg && (
            <div className="notice mt-3" data-tone="bad" role="alert">
              <AlertCircle size={13} strokeWidth={1.8} className="mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line-soft)' }}>
            <p className="microcaps" style={{ marginBottom: 8 }}>
              支持的三种输入
            </p>
            <ol
              style={{
                margin: 0,
                padding: 0,
                listStyle: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 7,
              }}
            >
              {[
                ['01', '手机 App 分享短链', 't1.kugou.com/… 或 m.kugou.com/…'],
                ['02', '酷狗码 / 口令', '带 ￥ 符号的整段口令也可以'],
                ['03', '纯数字歌单 ID', '或网页版专辑 URL'],
              ].map(([no, title, hint]) => (
                <li key={no} className="flex items-baseline gap-2.5">
                  <span
                    className="mono shrink-0"
                    style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-4)' }}
                  >
                    {no}
                  </span>
                  <span style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-1)' }}>
                    {title}
                    <span style={{ color: 'var(--ink-3)' }}> — {hint}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <div className="sheet-foot">
          <button type="button" onClick={onClose} className="btn btn-quiet">
            取消
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={isLoading || !inputText.trim()}
            className="btn btn-primary"
          >
            {isLoading ? (
              <>
                <Loader2 size={13} className="spin" strokeWidth={2} />
                正在解析…
              </>
            ) : (
              '开始导入'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
