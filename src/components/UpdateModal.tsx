/**
 * 应用更新提示弹窗 (src/components/UpdateModal.tsx)
 *
 * 配合 src/services/updater.ts 使用：
 *   - 启动后静默检查 GitHub 新版本，发现更新时弹出本弹窗
 *   - 展示新版本号与更新说明，点击「立即更新」显示下载进度
 *   - 下载安装完成后自动重启进入新版
 *
 * 视觉口径见 DESIGN.md：与其余弹窗共用 .overlay/.sheet，主键用赭橙，
 * 进度条走自绘轨道（与播放进度同一套 .seek 组件）。
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, RefreshCw, X } from 'lucide-react';
import {
  checkForUpdate,
  downloadAndInstallUpdate,
  type UpdateCheckResult,
} from '../services/updater';

interface UpdateModalProps {
  /** 外部（设置弹窗等）触发立即检查 */
  checkSignal: number;
  onClose: () => void;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({ checkSignal, onClose }) => {
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState({ downloaded: 0, total: 0 });
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const startedRef = useRef(false);

  const runCheck = async () => {
    setChecking(true);
    setMessage(null);
    setFailed(false);
    try {
      const res = await checkForUpdate();
      setResult(res);
      if (res.ok && !res.available) {
        setMessage('当前已是最新版本');
      } else if (!res.ok) {
        setMessage('检查更新失败，请稍后重试');
        setFailed(true);
      }
    } finally {
      setChecking(false);
    }
  };

  // 启动静默检查 + 外部 checkSignal 触发检查
  useEffect(() => {
    // 初次挂载：3 秒后静默检查（等界面加载完），不弹「已是最新」提示
    if (checkSignal === 0) {
      const t = setTimeout(async () => {
        const res = await checkForUpdate();
        if (res.available) setResult(res);
      }, 3000);
      return () => clearTimeout(t);
    }
    void runCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkSignal]);

  const handleUpdate = async () => {
    if (startedRef.current) return;
    startedRef.current = true;
    setDownloading(true);
    setFailed(false);
    const res = await downloadAndInstallUpdate((p) => setProgress(p));
    if (!res.success) {
      // relaunch 成功时进程直接重启，不会走到这里
      setMessage(res.message);
      setFailed(true);
      setDownloading(false);
      startedRef.current = false;
    }
  };

  const formatMB = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const pct =
    progress.total > 0 ? Math.min(100, Math.round((progress.downloaded / progress.total) * 100)) : 0;

  return (
    <div className="overlay" onClick={downloading ? undefined : onClose} role="presentation">
      <div
        className="sheet"
        style={{ maxWidth: 420 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="应用更新"
      >
        <div className="sheet-head-row">
          <div className="min-w-0 flex-1">
            <h2 className="sheet-title">
              {result?.available ? `发现新版本 v${result.version}` : '软件更新'}
            </h2>
            <p className="sheet-sub">
              {downloading ? '正在下载，请勿关闭应用' : '从 GitHub Releases 获取最新版本'}
            </p>
          </div>
          {!downloading && (
            <button type="button" onClick={onClose} className="icon-btn" title="关闭">
              <X size={16} strokeWidth={1.8} />
            </button>
          )}
        </div>

        <div className="sheet-body">
          {/* 更新说明 */}
          {result?.available && result.notes && !downloading && (
            <div
              className="set-block"
              style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}
            >
              <p className="microcaps" style={{ marginBottom: 8 }}>
                更新内容
              </p>
              <p
                style={{
                  margin: 0,
                  maxHeight: 132,
                  overflowY: 'auto',
                  fontSize: 'var(--fs-2)',
                  lineHeight: 'var(--lh-body)',
                  color: 'var(--ink-2)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {result.notes.slice(0, 500)}
              </p>
            </div>
          )}

          {downloading ? (
            <div>
              <div className="flex items-baseline justify-between" style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 'var(--fs-2)', color: 'var(--ink-1)' }}>
                  正在下载更新
                </span>
                <span className="mono" style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
                  {progress.total > 0
                    ? `${formatMB(progress.downloaded)} / ${formatMB(progress.total)}`
                    : formatMB(progress.downloaded)}
                </span>
              </div>

              {/* 与播放进度共用自绘轨道 */}
              <div className="seek" aria-hidden>
                <div className="seek-track">
                  <div className="seek-fill" style={{ width: `${pct}%` }} />
                </div>
              </div>

              <p
                className="mono"
                style={{ marginTop: 10, fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}
                aria-live="polite"
              >
                {pct}% · 下载完成后将自动安装并重启
              </p>
            </div>
          ) : (
            <>
              {message && (
                <div className="notice" data-tone={failed ? 'bad' : 'ok'}>
                  {failed ? (
                    <AlertCircle size={13} strokeWidth={1.8} className="mt-0.5 shrink-0" />
                  ) : (
                    <CheckCircle2 size={13} strokeWidth={1.8} className="mt-0.5 shrink-0" />
                  )}
                  <span>{message}</span>
                </div>
              )}

              {result?.available && (
                <p
                  className="mono"
                  style={{ marginTop: 12, fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}
                >
                  当前版本 → v{result.version}
                </p>
              )}
            </>
          )}
        </div>

        {!downloading && (
          <div className="sheet-foot">
            <button type="button" onClick={runCheck} disabled={checking} className="btn">
              <RefreshCw size={12} strokeWidth={1.8} className={checking ? 'spin' : undefined} />
              检查更新
            </button>
            {result?.available && (
              <button
                type="button"
                onClick={handleUpdate}
                disabled={checking}
                className="btn btn-primary"
              >
                <Download size={12} strokeWidth={2} />
                立即更新
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
