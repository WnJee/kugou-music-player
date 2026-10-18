/**
 * 账号与扫码授权弹窗 (src/components/SettingsModal.tsx)
 * 纯二维码扫码登录；已登录时展示账号卡片与概念版打卡。
 * 版式：分区靠发丝线，不靠彩色卡片；状态用状态点 + 等宽小字。
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Download,
  Loader2,
  LogOut,
  QrCode,
  RefreshCw,
  User,
  X,
} from 'lucide-react';
import { checkinConceptVip, fetchUserProfile, getUserSettings, saveUserSettings } from '../services/audioSource';
import { checkLoginQrCode, createLoginQrCode } from '../services/kugouAuth';
import { usePlayer } from '../context/PlayerContext';
import type { UserSettings } from '../types/music';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 打开应用更新弹窗（App.tsx 提供） */
  onOpenUpdate?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, onOpenUpdate }) => {
  const { refreshUserSettings, syncCloudPlaylists, vipStatus, refreshVipStatus } = usePlayer();
  const [settings, setSettings] = useState<UserSettings>({
    kugouToken: '',
    kugouUserId: '',
    autoCheckinVip: true,
    lastCheckinDate: '',
    customFallbackApi: '',
  });

  const [qrcodeKey, setQrcodeKey] = useState<string>('');
  const [qrcodeImg, setQrcodeImg] = useState<string>('');
  const [qrStatusText, setQrStatusText] = useState<string>('正在加载二维码…');
  const [isQrExpired, setIsQrExpired] = useState<boolean>(false);
  const [isQrLoading, setIsQrLoading] = useState<boolean>(false);

  const [isCheckinLoading, setIsCheckinLoading] = useState(false);
  const [checkinMessage, setCheckinMessage] = useState<string | null>(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [showManualAuth, setShowManualAuth] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [manualAuthMsg, setManualAuthMsg] = useState<string | null>(null);

  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const MAX_POLL_ATTEMPTS = 150;
  const pollAttemptsRef = useRef(0);

  const loadNewQrCode = async () => {
    setIsQrLoading(true);
    setIsQrExpired(false);
    pollAttemptsRef.current = 0;
    setQrStatusText('正在加载二维码…');
    try {
      const res = await createLoginQrCode();
      setQrcodeKey(res.qrcode);
      setQrcodeImg(res.qrcodeImg);
      setQrStatusText('使用手机酷狗 App 扫一扫');
    } catch (e) {
      console.error('[SettingsModal] 生成二维码失败:', e);
      setQrStatusText('二维码生成失败，点击刷新重试');
      setIsQrExpired(true);
    } finally {
      setIsQrLoading(false);
    }
  };

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
          setQrStatusText('二维码长时间未扫码，请刷新重试');
          return;
        }
        if (checkRes.status === 1) {
          setQrStatusText('使用手机酷狗 App 扫一扫');
        } else if (checkRes.status === 2) {
          setQrStatusText('已扫码，请在手机上确认登录');
        } else if (checkRes.status === 4 && checkRes.token) {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          setQrStatusText('授权成功，正在同步…');
          const updated = await saveUserSettings({
            kugouToken: checkRes.token,
            kugouUserId: checkRes.userid || '',
            nickname: checkRes.nickname || '酷狗音乐用户',
            avatar: checkRes.avatar || '',
            kugouAppId: 3116, // 概念版平台登录，token 与播放鉴权同平台
          });
          setSettings(updated);

          await refreshUserSettings();
          await syncCloudPlaylists(true);

          if (updated.kugouToken && updated.kugouUserId) {
            checkinConceptVip(updated.kugouToken, updated.kugouUserId).then((r) => {
              setCheckinMessage(r.message);
              refreshVipStatus();
            });
          }
        } else if (checkRes.status === 5) {
          setIsQrExpired(true);
          setQrStatusText('二维码已失效，点击刷新');
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

  useEffect(() => {
    if (isOpen) {
      setShowLogoutConfirm(false);
      getUserSettings().then((s) => {
        setSettings(s);
        if (!s.kugouToken) {
          loadNewQrCode();
        } else {
          refreshVipStatus();
        }
      });
      setCheckinMessage(null);
    } else {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    }
  }, [isOpen]);

  if (!isOpen) return null;

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

  const handleManualCheckin = async () => {
    if (!settings.kugouToken || !settings.kugouUserId) return;
    setIsCheckinLoading(true);
    setCheckinMessage(null);
    try {
      const res = await checkinConceptVip(settings.kugouToken, settings.kugouUserId);
      setCheckinMessage(res.message);
      await refreshVipStatus();
      const updated = await getUserSettings();
      setSettings(updated);
    } finally {
      setIsCheckinLoading(false);
    }
  };

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
        const parsed = JSON.parse(raw);
        token = String(parsed.token || '');
        userid = String(parsed.userid || '');
      } else {
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
      setManualAuthMsg(token ? '凭据中缺少 UserID（请粘贴完整 JSON）' : '未识别到有效 Token');
      return;
    }
    try {
      const profile = await fetchUserProfile(token, userid);
      const updated = await saveUserSettings({
        kugouToken: token,
        kugouUserId: userid,
        nickname: profile?.nickname || '酷狗用户',
        avatar: profile?.avatar || '',
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
    <div className="overlay" onClick={onClose} role="presentation">
      <div
        className="sheet"
        style={{ maxWidth: 460 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="账号与设置"
      >
        <div className="sheet-head-row">
          <div className="min-w-0 flex-1">
            <h2 className="sheet-title">{settings.kugouToken ? '账号' : '扫码登录'}</h2>
            <p className="sheet-sub">
              {settings.kugouToken ? '同步账号歌单与概念版会员权益' : '手机扫一扫即可绑定，不经过第三方服务器'}
            </p>
          </div>
          <button type="button" onClick={onClose} className="icon-btn" title="关闭">
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        <div className="sheet-body">
          {/* ===== 未登录：二维码 ===== */}
          {!settings.kugouToken ? (
            <>
              <div className="flex" style={{ gap: 16, alignItems: 'flex-start' }}>
                <div
                  className="relative shrink-0"
                  style={{
                    width: 152,
                    height: 152,
                    padding: 7,
                    background: 'var(--paper)',
                    borderRadius: 'var(--r-2)',
                  }}
                >
                  {qrcodeImg ? (
                    <img
                      src={qrcodeImg}
                      alt="登录二维码"
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <div className="grid h-full w-full place-items-center">
                      <Loader2 size={20} className="spin" style={{ color: 'var(--ink-3)' }} />
                    </div>
                  )}

                  {(isQrExpired || isQrLoading) && (
                    <button
                      type="button"
                      onClick={loadNewQrCode}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-1.5"
                      style={{
                        background: 'color-mix(in oklab, var(--sunken) 88%, transparent)',
                        borderRadius: 'var(--r-2)',
                        color: 'var(--ink-1)',
                      }}
                    >
                      <RefreshCw size={16} strokeWidth={1.8} />
                      <span style={{ fontSize: 'var(--fs-2)' }}>
                        {isQrLoading ? '正在获取…' : '点击刷新'}
                      </span>
                    </button>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p style={{ fontSize: 'var(--fs-3)', color: 'var(--ink-0)', marginBottom: 6 }}>
                    {qrStatusText}
                  </p>
                  <p
                    style={{
                      fontSize: 'var(--fs-2)',
                      lineHeight: 'var(--lh-body)',
                      color: 'var(--ink-2)',
                    }}
                  >
                    打开手机「酷狗音乐」或「酷狗概念版」，进入扫一扫完成授权。
                  </p>
                  <button
                    type="button"
                    onClick={loadNewQrCode}
                    disabled={isQrLoading}
                    className="btn btn-quiet mt-2"
                    style={{ height: 26, padding: '0 8px', fontSize: 'var(--fs-1)' }}
                  >
                    <RefreshCw size={12} strokeWidth={1.8} />
                    刷新二维码
                  </button>
                </div>
              </div>

              <div className="set-block" style={{ marginTop: 14 }}>
                <button
                  type="button"
                  onClick={() => setShowManualAuth((v) => !v)}
                  className="btn btn-quiet"
                  style={{ height: 28, padding: '0 8px', fontSize: 'var(--fs-2)' }}
                >
                  {showManualAuth ? '收起手动授权' : '在手机上？用凭据手动授权'}
                </button>

                {showManualAuth && (
                  <div style={{ marginTop: 10 }}>
                    <p className="field-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                      在电脑版登录后复制凭据，粘贴到下方（支持 JSON 或仅 Token）。
                    </p>
                    <textarea
                      value={manualToken}
                      onChange={(e) => setManualToken(e.target.value)}
                      placeholder={'{"token":"…","userid":"700121683"}'}
                      rows={3}
                      className="field field-area"
                      aria-label="授权凭据"
                    />
                    {manualAuthMsg && (
                      <p
                        style={{ marginTop: 6, fontSize: 'var(--fs-1)', color: 'var(--danger)' }}
                        role="alert"
                      >
                        {manualAuthMsg}
                      </p>
                    )}
                    <button
                      type="button"
                      onClick={handleManualAuth}
                      className="btn btn-primary mt-2"
                      style={{ width: '100%' }}
                    >
                      保存并登录
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* ===== 已登录：账号信息 ===== */
            <>
              <div className="flex items-start gap-3">
                <span className="shrink-0">
                  {settings.avatar ? (
                    <img
                      src={settings.avatar}
                      alt=""
                      style={{
                        width: 46,
                        height: 46,
                        borderRadius: 'var(--r-2)',
                        objectFit: 'cover',
                        border: '1px solid var(--line)',
                      }}
                    />
                  ) : (
                    <span
                      className="grid place-items-center"
                      style={{
                        width: 46,
                        height: 46,
                        borderRadius: 'var(--r-2)',
                        background: 'var(--lift)',
                        color: 'var(--ink-2)',
                      }}
                    >
                      <User size={19} strokeWidth={1.6} />
                    </span>
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span
                      style={{
                        fontFamily: 'var(--font-display)',
                        fontSize: 'var(--fs-4)',
                        color: 'var(--ink-0)',
                      }}
                    >
                      {settings.nickname || '酷狗用户'}
                    </span>
                    <span
                      className="mono inline-flex items-center gap-1"
                      style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}
                    >
                      <span className="dot" data-tone="ok" />
                      已授权
                    </span>
                  </div>

                  <p
                    className="mono"
                    style={{ marginTop: 4, fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}
                  >
                    UID {settings.kugouUserId}
                  </p>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {vipStatus?.isVip ? (
                      <span
                        className="mono inline-flex items-center gap-1.5"
                        title={vipStatus.vipEndTime ? `会员到期 ${vipStatus.vipEndTime}` : '会员生效中'}
                        style={{
                          fontSize: 'var(--fs-1)',
                          color: 'var(--accent-ink)',
                          padding: '1px 6px',
                          border: '1px solid var(--accent-line)',
                          borderRadius: 'var(--r-1)',
                        }}
                      >
                        概念版会员
                        {vipStatus.vipEndTime ? ` · ${vipStatus.vipEndTime.slice(5, 10)}` : ''}
                      </span>
                    ) : (
                      <span
                        className="mono"
                        style={{
                          fontSize: 'var(--fs-1)',
                          color: 'var(--ink-3)',
                          padding: '1px 6px',
                          border: '1px solid var(--line)',
                          borderRadius: 'var(--r-1)',
                        }}
                      >
                        非会员
                      </span>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard
                          .writeText(
                            JSON.stringify({ token: settings.kugouToken, userid: settings.kugouUserId })
                          )
                          .then(() => setCheckinMessage('已复制凭据，可在手机端手动授权中粘贴'));
                      }}
                      className="btn btn-quiet"
                      style={{ height: 22, padding: '0 6px', fontSize: 'var(--fs-1)' }}
                      title="复制授权凭据"
                    >
                      复制凭据
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowLogoutConfirm(true)}
                  className="icon-btn"
                  title="退出登录"
                  style={{ color: 'var(--ink-3)' }}
                >
                  <LogOut size={15} strokeWidth={1.7} />
                </button>
              </div>

              {showLogoutConfirm && (
                <div className="notice mt-3" data-tone="bad">
                  <span className="flex-1">退出后需要重新扫码授权，确定吗？</span>
                  <button
                    type="button"
                    onClick={() => setShowLogoutConfirm(false)}
                    className="btn btn-quiet"
                    style={{ height: 22, padding: '0 6px', fontSize: 'var(--fs-1)' }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="btn btn-danger"
                    style={{ height: 22, padding: '0 6px', fontSize: 'var(--fs-1)' }}
                  >
                    退出
                  </button>
                </div>
              )}

              {/* 打卡 */}
              <div className="set-block" style={{ marginTop: 12 }}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="set-block-title">启动时自动签到</p>
                    <p className="set-block-note">每日自动领取概念版会员时长</p>
                  </div>
                  <label className="check shrink-0">
                    <input
                      type="checkbox"
                      checked={settings.autoCheckinVip}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setSettings({ ...settings, autoCheckinVip: next });
                        saveUserSettings({ autoCheckinVip: next });
                      }}
                      aria-label="启动时自动签到"
                    />
                  </label>
                </div>

                <div className="flex items-center justify-between gap-3" style={{ marginTop: 12 }}>
                  <span
                    className="mono"
                    style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}
                  >
                    {settings.lastCheckinDate ? `今日已打卡 ${settings.lastCheckinDate}` : '今日未打卡'}
                  </span>
                  <button
                    type="button"
                    onClick={handleManualCheckin}
                    disabled={isCheckinLoading}
                    className="btn"
                    style={{ height: 28, fontSize: 'var(--fs-2)' }}
                  >
                    {isCheckinLoading ? (
                      <Loader2 size={12} className="spin" />
                    ) : (
                      <CheckCircle2 size={12} strokeWidth={1.8} />
                    )}
                    立即打卡
                  </button>
                </div>

                {checkinMessage && (
                  <div className="notice mt-3" data-tone="ok">
                    <Check size={13} strokeWidth={2.2} className="mt-0.5 shrink-0" />
                    <span>{checkinMessage}</span>
                  </div>
                )}
              </div>
            </>
          )}

          {/* 备用音源 */}
          <div className="set-block" style={{ marginTop: 4 }}>
            <div className="flex items-center gap-2">
              <p className="set-block-title">备用音源</p>
              <span className="mono" style={{ fontSize: 'var(--fs-1)', color: 'var(--ink-3)' }}>
                免登录
              </span>
            </div>
            <p className="set-block-note">
              主轨不可用或只有试听片段时，自动检索时长误差 ±3 秒内的完整版本。
            </p>
            <input
              type="text"
              value={settings.customFallbackApi}
              onChange={(e) => {
                const val = e.target.value.trim();
                setSettings({ ...settings, customFallbackApi: val });
                saveUserSettings({ customFallbackApi: val });
              }}
              placeholder="自定义接口模板（选填）https://api.example.com?name={name}&artist={artist}"
              className="field mono mt-2"
              style={{ fontSize: 'var(--fs-1)' }}
              aria-label="自定义备用音源接口"
            />
          </div>

          {/* 应用更新 */}
          <div className="set-block">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="set-block-title">应用更新</p>
                <p className="set-block-note">检查 GitHub 新版本，应用内下载并自动重启</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenUpdate?.();
                }}
                className="btn shrink-0"
                style={{ height: 28, fontSize: 'var(--fs-2)' }}
              >
                <RefreshCw size={12} strokeWidth={1.8} />
                检查更新
              </button>
            </div>
          </div>
        </div>

        <div className="sheet-foot">
          <button type="button" onClick={onClose} className="btn">
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
