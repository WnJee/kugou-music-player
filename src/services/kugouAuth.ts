/**
 * 酷狗二维码扫码登录与鉴权服务 (src/services/kugouAuth.ts)
 * 支持生成酷狗官方登录二维码、轮询扫码状态并提取 Token 与 UserID
 */

import { md5 } from '../utils/md5';
import { httpGet } from './http';

const SIGNATURE_WEB_SECRET = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';

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
 * 生成设备随机唯一 MID
 */
function generateMid(): string {
  const randomStr = Math.random().toString(36).substring(2) + Date.now().toString(36);
  const hash = md5(randomStr);
  try {
    return BigInt('0x' + hash).toString();
  } catch {
    return '239526275778893399526700786998289824956';
  }
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
 * 1. 获取登录二维码及 Key
 */
export async function createLoginQrCode(): Promise<QrCodeKeyResult> {
  const clienttime = Math.floor(Date.now() / 1000);
  const mid = generateMid();

  const params: Record<string, string | number> = {
    appid: 1014,
    clienttime,
    clientver: 20489,
    dfid: '-',
    mid,
    plat: 4,
    qrcode_txt: 'https://h5.kugou.com/apps/loginQRCode/html/index.html?appid=1014&',
    srcappid: 2919,
    type: 1,
    uuid: '-',
  };

  const signature = signWebParams(params);

  interface QrResponse {
    status: number;
    error_code: number;
    data?: {
      qrcode: string;
      qrcode_img: string;
    };
  }

  const res = await httpGet<QrResponse>('https://login-user.kugou.com/v2/qrcode', {
    ...params,
    signature,
  });

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
  const clienttime = Math.floor(Date.now() / 1000);
  const mid = generateMid();

  const params: Record<string, string | number> = {
    appid: 1014,
    clienttime,
    clientver: 20489,
    dfid: '-',
    mid,
    plat: 4,
    qrcode: qrcodeKey,
    srcappid: 2919,
    uuid: '-',
  };

  const signature = signWebParams(params);

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

  const res = await httpGet<CheckResponse>('https://login-user.kugou.com/v2/get_userinfo_qrcode', {
    ...params,
    signature,
  });

  if (res && res.status === 1 && res.data) {
    const rawStatus = res.data.status;
    return {
      status: rawStatus,
      token: res.data.token,
      userid: res.data.userid ? String(res.data.userid) : undefined,
      nickname: res.data.nickname,
      avatar: res.data.pic,
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
