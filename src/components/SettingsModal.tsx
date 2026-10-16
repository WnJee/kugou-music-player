/**
 * 账号与扫码授权弹窗 (src/components/SettingsModal.tsx)
 * 纯二维码扫码登录（免手输 Token/UserID），展示用户头像、昵称及概念版每日打卡领 VIP
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  FolderSync,
  LogOut,
  QrCode,
  RefreshCw,
  Settings,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import { checkinConceptVip, getUserSettings, saveUserSettings } from '../services/audioSource';
import { checkLoginQrCode, createLoginQrCode } from '../services/kugouAuth';
import { usePlayer } from '../context/PlayerContext';
import type { UserSettings } from '../types/music';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const { refreshUserSettings, syncCloudPlaylists, vipStatus, refreshVipStatus } = usePlayer();
  const [settings, setSettings] = useState<UserSettings>({
    kugouToken: '',
    kugouUserId: '',
    autoCheckinVip: true,
    lastCheckinDate: '',
    customFallbackApi: '',
  });

  // 二维码状态
  const [qrcodeKey, setQrcodeKey] = useState<string>('');
  const [qrcodeImg, setQrcodeImg] = useState<string>('');
  const [qrStatusText, setQrStatusText] = useState<string>('正在加载二维码...');
  const [isQrExpired, setIsQrExpired] = useState<boolean>(false);
  const [isQrLoading, setIsQrLoading] = useState<boolean>(false);

  // 签到状态
  const [isCheckinLoading, setIsCheckinLoading] = useState(false);
  const [checkinMessage, setCheckinMessage] = useState<string | null>(null);
  // 退出登录二次确认（Tauri WebView 不支持原生 window.confirm，改用内联确认）
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  // 手机端手动授权（手机无法扫描自己屏幕上的二维码）
  const [showManualAuth, setShowManualAuth] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [manualAuthMsg, setManualAuthMsg] = useState<string | null>(null);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  // 防风控：扫码轮询次数上限（150 次 × 2s ≈ 5 分钟，正常二维码在此之前就会过期）
  const MAX_POLL_ATTEMPTS = 150;
  const pollAttemptsRef = useRef(0);

  // 1. 获取登录二维码
  const loadNewQrCode = async () => {
    setIsQrLoading(true);
    setIsQrExpired(false);
    pollAttemptsRef.current = 0;
    setQrStatusText('正在加载二维码...');
    try {
      const res = await createLoginQrCode();
      setQrcodeKey(res.qrcode);
      setQrcodeImg(res.qrcodeImg);
      setQrStatusText('请使用手机酷狗音乐 App 扫一扫');
    } catch (e) {
      console.error('[SettingsModal] 生成二维码失败:', e);
      setQrStatusText('二维码生成失败，请点击刷新重试');
      setIsQrExpired(true);
    } finally {
      setIsQrLoading(false);
    }
  };

  // 2. 轮询二维码扫码状态
  useEffect(() => {
    if (!isOpen || !qrcodeKey || settings.kugouToken) {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      return;
    }

    const checkStatus = async () => {
      try {
        const checkRes = await checkLoginQrCode(qrcodeKey);

        pollAttemptsRef.current += 1;
        if (pollAttemptsRef.current > MAX_POLL_ATTEMPTS) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setIsQrExpired(true);
          setQrStatusText('二维码长时间未扫码，请点击刷新重试');
          return;
        }
        if (checkRes.status === 1) {
          setQrStatusText('请使用手机酷狗音乐 App 扫一扫');
        } else if (checkRes.status === 2) {
          setQrStatusText('已扫码！请在手机上点击“确认登录”');
        } else if (checkRes.status === 4 && checkRes.token) {
          // 登录成功！
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setQrStatusText('登录授权成功！正在同步...');
          const updated = await saveUserSettings({
            kugouToken: checkRes.token,
            kugouUserId: checkRes.userid || '',
            nickname: checkRes.nickname || '酷狗音乐用户',
            avatar: checkRes.avatar || '',
          });
          setSettings(updated);

          // 立即更新全局状态并同步用户账号下的云端歌单
          await refreshUserSettings();
          await syncCloudPlaylists(true);

          // 自动触发一次概念版 VIP 打卡
          if (updated.kugouToken && updated.kugouUserId) {
            checkinConceptVip(updated.kugouToken, updated.kugouUserId).then((r) => {
              setCheckinMessage(r.message);
              // 打卡后刷新 VIP 实时状态标识
              refreshVipStatus();
            });
          }
        } else if (checkRes.status === 5) {
          setIsQrExpired(true);
          setQrStatusText('二维码已失效，请点击刷新');
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        }
      } catch (err) {
        console.warn('[checkStatus] 轮询异常:', err);
      }
    };

    pollTimerRef.current = setInterval(checkStatus, 2000);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [isOpen, qrcodeKey, settings.kugouToken]);

  // 打开弹窗初始化
  useEffect(() => {
    if (isOpen) {
      setShowLogoutConfirm(false);
      getUserSettings().then((s) => {
        setSettings(s);
        if (!s.kugouToken) {
          loadNewQrCode();
        } else {
          // 已登录：打开弹窗即刷新 VIP 实时状态标识
          refreshVipStatus();
        }
      });
      setCheckinMessage(null);
    } else {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // 退出登录（清除本地登录态，回到扫码界面）
  const handleLogout = async () => {
    const updated = await saveUserSettings({
      kugouToken: '',
      kugouUserId: '',
      nickname: '',
      avatar: '',
    });
    setSettings(updated);
    setShowLogoutConfirm(false);
    await refreshUserSettings();
    setCheckinMessage(null);
    loadNewQrCode();
  };

  // 手动打卡领 VIP
  const handleManualCheckin = async () => {
    if (!settings.kugouToken || !settings.kugouUserId) return;
    setIsCheckinLoading(true);
    setCheckinMessage(null);
    try {
      const res = await checkinConceptVip(settings.kugouToken, settings.kugouUserId);
      setCheckinMessage(res.message);
      // 打卡后立即刷新 VIP 实时状态标识
      await refreshVipStatus();
      const updated = await getUserSettings();
      setSettings(updated);
    } finally {
      setIsCheckinLoading(false);
    }
  };

  // 手机端手动授权：单文本框粘贴凭据，自动解析 JSON / token:userid / 纯 Token
  const handleManualAuth = async () => {
    const raw = manualToken.trim();
    if (!raw) {
      setManualAuthMsg('请先粘贴授权凭据');
      return;
    }

    let token = '';
    let userid = '';

    try {
      if (raw.startsWith('{')) {
        // JSON 格式：{"token":"...","userid":"..."}
        const parsed = JSON.parse(raw);
        token = String(parsed.token || '');
        userid = String(parsed.userid || '');
      } else {
        // token:userid 组合格式（token 长度固定 64 位十六进制）
        const m = raw.match(/([a-f0-9]{64})\D*(\d{4,})/i);
        if (m) {
          token = m[1];
          userid = m[2];
        } else {
          token = raw.replace(/\s/g, '');
        }
      }
    } catch {
      setManualAuthMsg('粘贴内容不是有效的凭据 JSON');
      return;
    }

    if (!token || !userid) {
      setManualAuthMsg(token ? '凭据中缺少 UserID（请粘贴完整的 JSON 凭据）' : '未识别到有效 Token');
      return;
    }
    try {
      const updated = await saveUserSettings({
        kugouToken: token,
        kugouUserId: userid,
        nickname: settings.nickname || '酷狗用户',
      });
      setSettings(updated);
      setManualAuthMsg(null);
      setShowManualAuth(false);
      await refreshUserSettings();
      await syncCloudPlaylists(true);
      refreshVipStatus();
    } catch (err) {
      setManualAuthMsg(err instanceof Error ? err.message : '保存失败，请重试');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in select-none">
      <div className="w-full max-w-md rounded-2xl bg-zinc-900 border border-white/10 p-6 shadow-2xl text-white relative max-h-[92vh] overflow-y-auto custom-scrollbar">
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* 标题 */}
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center">
            <QrCode className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold">酷狗账号扫码授权</h2>
            <p className="text-xs text-zinc-400">免手动抓包输入，手机扫一扫即可绑定</p>
          </div>
        </div>

        {/* 1. 若未登录：显示二维码扫码卡片 */}
        {!settings.kugouToken ? (
          <div className="flex flex-col items-center justify-center p-5 rounded-2xl bg-white/[0.02] border border-white/10 mb-5">
            <div className="relative w-48 h-48 rounded-xl overflow-hidden bg-white p-2 shadow-xl shadow-black/60 flex items-center justify-center mb-3">
              {qrcodeImg ? (
                <img src={qrcodeImg} alt="登录二维码" className="w-full h-full object-contain" />
              ) : (
                <RefreshCw className="w-8 h-8 text-zinc-400 animate-spin" />
              )}

              {/* 过期或加载蒙版 */}
              {(isQrExpired || isQrLoading) && (
                <div
                  onClick={loadNewQrCode}
                  className="absolute inset-0 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center cursor-pointer p-2 text-center"
                >
                  <RefreshCw className="w-7 h-7 text-cyan-400 mb-2" />
                  <span className="text-xs text-white font-medium">二维码已失效</span>
                  <span className="text-[10px] text-zinc-400 mt-0.5">点击刷新重试</span>
                </div>
              )}
            </div>

            <p className="text-xs font-medium text-cyan-400 mb-1">{qrStatusText}</p>
            <p className="text-[11px] text-zinc-500 text-center leading-relaxed">
              打开手机“酷狗音乐”或“酷狗概念版” App，进入【扫一扫】即可授权登录并同步会员权益
            </p>

            <button
              onClick={loadNewQrCode}
              disabled={isQrLoading}
              className="mt-3 inline-flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white py-1 px-3 rounded-lg hover:bg-white/5 transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isQrLoading ? 'animate-spin' : ''}`} />
              <span>刷新二维码</span>
            </button>

            {/* 手机端无法扫描自己屏幕上的二维码：提供手动授权 */}
            <button
              onClick={() => setShowManualAuth((v) => !v)}
              className="mt-2 text-[11px] text-cyan-400/80 hover:text-cyan-300 underline underline-offset-4"
            >
              在手机上？点此手动授权 →
            </button>

            {showManualAuth && (
              <div className="mt-3 w-full text-left p-3 rounded-xl bg-black/30 border border-white/10 space-y-2">
                <p className="text-[10px] text-zinc-400 leading-relaxed">
                  在电脑版登录后点「复制凭据」，把复制的内容粘贴到下方（支持 JSON 或仅 Token）；<br />
                  也可以长按上方二维码保存后，用其他设备扫码。
                </p>
                <textarea
                  value={manualToken}
                  onChange={(e) => setManualToken(e.target.value)}
                  placeholder={'粘贴授权凭据，例如：\n{"token":"...","userid":"700121683"}\n或直接粘贴 Token 字符串'}
                  rows={4}
                  className="w-full px-3 py-2 rounded-lg bg-white/[0.05] border border-white/10 text-[11px] text-white placeholder-zinc-500 focus:outline-none focus:border-cyan-500/50 font-mono resize-none"
                />
                {manualAuthMsg && <p className="text-[10px] text-red-400">{manualAuthMsg}</p>}
                <button
                  onClick={handleManualAuth}
                  className="w-full py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-white text-xs font-medium transition-colors"
                >
                  保存并登录
                </button>
              </div>
            )}
          </div>
        ) : (
          /* 2. 若已登录：显示用户信息卡片与打卡面板 */
          <div className="p-4 rounded-2xl bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-transparent border border-cyan-500/20 mb-5">
            <div className="flex items-center justify-between mb-3.5">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl overflow-hidden bg-zinc-800 border border-white/10 shrink-0">
                  {settings.avatar ? (
                    <img
                      src={settings.avatar}
                      alt={settings.nickname}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-zinc-400">
                      <User className="w-6 h-6" />
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5 flex-wrap">
                    <span>{settings.nickname || '酷狗用户'}</span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] bg-emerald-500/20 text-emerald-300 font-medium">
                      已授权
                    </span>
                    {/* 概念版 VIP 实时状态标识 */}
                    {vipStatus?.isVip ? (
                      <span
                        title={vipStatus.vipEndTime ? `概念版 VIP 到期：${vipStatus.vipEndTime}` : '概念版 VIP 生效中'}
                        className="px-1.5 py-0.2 rounded text-[9px] bg-gradient-to-r from-amber-500/30 to-yellow-500/30 text-amber-300 border border-amber-500/40 font-medium whitespace-nowrap"
                      >
                        ★ 概念版 VIP{vipStatus.vipEndTime ? ` · ${vipStatus.vipEndTime.slice(5, 10)}` : ''}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.2 rounded text-[9px] bg-zinc-700/50 text-zinc-400 font-medium">
                        非 VIP
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-zinc-400 font-mono mt-0.5 flex items-center gap-2">
                    <span>UID: {settings.kugouUserId}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard
                          .writeText(JSON.stringify({ token: settings.kugouToken, userid: settings.kugouUserId }))
                          .then(() => setCheckinMessage('已复制授权凭据，可在手机端「手动授权」中粘贴登录'));
                      }}
                      title="复制授权凭据（用于手机端手动授权）"
                      className="text-[10px] not-italic font-sans px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/15 text-zinc-300 hover:text-white transition-colors"
                    >
                      复制凭据
                    </button>
                  </p>
                </div>
              </div>

              <button
                onClick={() => setShowLogoutConfirm(true)}
                title="退出并切换账号"
                className="p-2 rounded-xl bg-white/5 hover:bg-red-500/10 text-zinc-400 hover:text-red-400 transition-colors"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>

            {/* 退出登录内联确认条 */}
            {showLogoutConfirm && (
              <div className="mb-3 p-3 rounded-xl bg-red-500/10 border border-red-500/25 flex items-center justify-between gap-3">
                <span className="text-[11px] text-red-200 leading-relaxed">
                  确定退出当前酷狗账号？退出后需重新扫码授权。
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => setShowLogoutConfirm(false)}
                    className="px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 text-[11px] transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleLogout}
                    className="px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-300 text-[11px] font-medium transition-colors"
                  >
                    退出登录
                  </button>
                </div>
              </div>
            )}

            {/* 概念版自动打卡与打卡记录 */}
            <div className="pt-3 border-t border-white/5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-medium text-white">App 启动时自动签到领 VIP</h4>
                  <p className="text-[11px] text-zinc-400">每日启动自动打卡领取概念版会员时长</p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.autoCheckinVip}
                  onChange={(e) => {
                    const next = e.target.checked;
                    setSettings({ ...settings, autoCheckinVip: next });
                    saveUserSettings({ autoCheckinVip: next });
                  }}
                  className="w-4 h-4 rounded accent-cyan-400 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-[11px] text-zinc-400">
                  今日状态: {settings.lastCheckinDate ? `已打卡 (${settings.lastCheckinDate})` : '尚未打卡'}
                </span>
                <button
                  type="button"
                  onClick={handleManualCheckin}
                  disabled={isCheckinLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25 text-emerald-400 text-xs font-medium transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{isCheckinLoading ? '打卡中...' : '立即打卡领 VIP'}</span>
                </button>
              </div>

              {checkinMessage && (
                <p className="text-xs text-cyan-300 bg-cyan-500/10 p-2 rounded-lg border border-cyan-500/20">
                  {checkinMessage}
                </p>
              )}
            </div>
          </div>
        )}

        {/* 备轨 Fallback 设置 */}
        <div className="p-3.5 rounded-xl bg-white/[0.02] border border-white/5 mb-6">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400 mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            <span>备用音源（免登录 Fallback）</span>
          </div>
          <p className="text-[11px] text-zinc-400 leading-relaxed mb-2">
            主轨未配置或试听片段时，自动启用全网无损检索，自动比对时长误差在 ±3 秒内的完整版本。
          </p>
          <input
            type="text"
            value={settings.customFallbackApi}
            onChange={(e) => {
              const val = e.target.value.trim();
              setSettings({ ...settings, customFallbackApi: val });
              saveUserSettings({ customFallbackApi: val });
            }}
            placeholder="自定义接口模板(选填): https://api.example.com?name={name}&artist={artist}"
            className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500/50 font-mono"
          />
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white text-xs font-medium transition-colors"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
