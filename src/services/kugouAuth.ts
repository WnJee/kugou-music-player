/**
 * 酷狗二维码扫码登录与鉴权服务 (src/services/kugouAuth.ts)
 * 支持生成酷狗官方登录二维码、轮询扫码状态并提取 Token 与 UserID
 */

import { md5 } from '../utils/md5';
import { toSecureImageUrl } from '../utils/url';
import { getDeviceMid } from './device';
import { httpGet } from './http';

const SIGNATURE_WEB_SECRET = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';

// 酷狗概念版 appid（网关接口需与登录态所属 appid 一致，VIP 鉴权按平台校验）
const KUGOU_ANDROID_APPID = 3116;
// 二维码创建接口使用的 appid（与登录态同平台，扫码后签发概念版 token）
const KUGOU_QRCODE_APPID = 3116;

export interface QrCodeKeyResult {
  qrcode: string;
  qrcodeImg: string;
}

export interface QrCodeStatusResult {
  /** 1: 等待扫码, 2: 已扫码待在手机确认, 4: 登录成功, 5: 二维码已失效 */
  status: number;
  token?: string;
  userid?: string;
  nickname?: string;
  avatar?: string;
  message?: string;
}

/**
 * 计算 Web 端登录接口 MD5 签名
 */
function signWebParams(params: Record<string, string | number>): string {
  const sortedKeys = Object.keys(params).sort();
  const paramStr = sortedKeys.map((k) => `${k}=${params[k]}`).join('');
  return md5(`${SIGNATURE_WEB_SECRET}${paramStr}${SIGNATURE_WEB_SECRET}`);
}

/**
 * 组装 Web 登录接口的公共参数（含签名），两个接口共用同一套设备标识与签名。
 * clienttime 每次调用重新取，避免并发轮询时复用过期时间戳。
 */
async function buildWebSignedParams(
  appid: number,
  extra: Record<string, string | number>
): Promise<Record<string, string | number>> {
  const params: Record<string, string | number> = {
    appid,
    clienttime: Math.floor(Date.now() / 1000),
    clientver: 20489,
    dfid: '-',
    mid: await getDeviceMid(),
    plat: 4,
    srcappid: 2919,
    uuid: '-',
    ...extra,
  };
  return { ...params, signature: signWebParams(params) };
}

/**
 * 1. 获取登录二维码及 Key
 */
export async function createLoginQrCode(): Promise<QrCodeKeyResult> {
  interface QrResponse {
    status: number;
    error_code: number;
    data?: {
      qrcode: string;
      qrcode_img: string;
    };
  }

  const res = await httpGet<QrResponse>(
    'https://login-user.kugou.com/v2/qrcode',
    await buildWebSignedParams(KUGOU_QRCODE_APPID, {
      qrcode_txt: `https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=${KUGOU_ANDROID_APPID}&`,
      type: 1,
    })
  );

  if (res && res.status === 1 && res.data?.qrcode && res.data?.qrcode_img) {
    return {
      qrcode: res.data.qrcode,
      qrcodeImg: res.data.qrcode_img,
    };
  }

  throw new Error(`获取登录二维码失败: ${JSON.stringify(res)}`);
}

/**
 * 2. 轮询二维码扫码状态
 * @param qrcodeKey 第一步获取到的 qrcode 字符串
 */
export async function checkLoginQrCode(qrcodeKey: string): Promise<QrCodeStatusResult> {
  interface CheckResponse {
    status: number;
    error_code: number;
    data?: {
      status: number;
      token?: string;
      userid?: number | string;
      nickname?: string;
      pic?: string;
    };
  }

  const res = await httpGet<CheckResponse>(
    'https://login-user.kugou.com/v2/get_userinfo_qrcode',
    await buildWebSignedParams(KUGOU_ANDROID_APPID, { qrcode: qrcodeKey })
  );

  if (res && res.status === 1 && res.data) {
    const rawStatus = res.data.status;
    // 已确认登录但未下发 token：视为本次扫码失败，按二维码失效处理，
    // 避免轮询一直成功拿到「已确认」却永远等不到 token
    if (rawStatus === 4 && !res.data.token) {
      return { status: 5, message: '登录授权未返回有效凭证，请点击刷新二维码重试' };
    }
    return {
      status: rawStatus,
      token: res.data.token,
      userid: res.data.userid ? String(res.data.userid) : undefined,
      nickname: res.data.nickname,
      avatar: toSecureImageUrl(res.data.pic),
      message:
        rawStatus === 1
          ? '等待手机扫码'
          : rawStatus === 2
          ? '已扫码，请在手机上点击确认登录'
          : rawStatus === 4
          ? '授权登录成功'
          : rawStatus === 5
          ? '二维码已失效，请点击刷新'
          : '授权中...',
    };
  }

  return { status: 1, message: '等待扫码' };
}
