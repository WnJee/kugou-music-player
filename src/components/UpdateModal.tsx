/**
 * 应用更新提示弹窗 (src/components/UpdateModal.tsx)
 *
 * 配合 src/services/updater.ts 使用：
 *   - 启动后静默检查 GitHub 新版本，发现更新时弹出本弹窗
 *   - 展示新版本号与更新说明，点击「立即更新」显示下载进度
 *   - 下载安装完成后自动重启进入新版
 */

import React, { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw, X, CheckCircle2, AlertCircle } from 'lucide-react';
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
        setMessage('当前已是最新版本 🎉');
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
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={downloading ? undefined : onClose}
    >
      <div
        className="w-[90%] max-w-sm rounded-2xl bg-zinc-900 border border-white/10 shadow-2xl p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {failed ? (
              <AlertCircle className="w-5 h-5 text-red-400" />
            ) : (
              <Download className="w-5 h-5 text-cyan-400" />
            )}
            <h3 className="text-sm font-bold text-white">
              {result?.available ? `发现新版本 v${result.version}` : '软件更新'}
            </h3>
          </div>
          {!downloading && (
            <button onClick={onClose} className="text-zinc-500 hover:text-white text-xs">
              ✕
            </button>
          )}
        </div>

        {result?.available && result.notes && !downloading && (
          <div className="max-h-32 overflow-y-auto custom-scrollbar rounded-xl bg-white/[0.03] border border-white/5 p-3">
            <p className="text-[11px] text-zinc-400 whitespace-pre-wrap break-words leading-relaxed">
              {result.notes.slice(0, 500)}
            </p>
          </div>
        )}

        {downloading ? (
          <div className="space-y-2">
            <div className="flex justify-between text-[11px] text-zinc-400">
              <span>正在下载更新...</span>
              <span className="font-mono tabular-nums">
                {progress.total > 0
                  ? `${formatMB(progress.downloaded)} / ${formatMB(progress.total)}`
                  : formatMB(progress.downloaded)}
              </span>
            </div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-[10px] text-zinc-500 text-center">
              下载完成后将自动安装并重启应用
            </p>
          </div>
        ) : (
          <>
            {message && (
              <div className="flex items-center gap-2 text-xs text-zinc-300">
                {!failed && message.includes('最新') && (
                  <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                )}
                <span>{message}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={runCheck}
                disabled={checking}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 text-xs transition-colors disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
                检查更新
              </button>
              {result?.available && (
                <button
                  onClick={handleUpdate}
                  disabled={checking}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-medium shadow-lg shadow-cyan-500/20 transition-all disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  立即更新
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
