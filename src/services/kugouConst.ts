/**
 * 酷狗网关协议常量与签名 (src/services/kugouConst.ts)
 *
 * 协议盐值、平台身份（appid/clientver/page_id）与 MD5 签名逻辑集中在此，
 * 其他模块一律从这里取，避免同一套参数在多处复制导致改一处漏一处。
 * 注意：本文件里的常量属于凭据，严禁打印到 console、严禁拼进错误信息（统一走 redact）。
 */

import { md5 } from '../utils/md5';

/** 标准版（appid 1005）网关签名盐值 */
const STANDARD_SIGNATURE_SALT = 'OIlwieks28dk2k092lksi2UIkp';
/** 标准版 trackercdn key 盐值 */
const STANDARD_TRACKER_SALT = '57ae12eb6890223e355ccfcb74edf70d';
/** 概念版（appid 3116）网关签名盐值 */
const CONCEPT_SIGNATURE_SALT = 'LnT6xpN3khm36zse0QzvmgTZ3waWdRSA';
/** 概念版 trackercdn key 盐值 */
const CONCEPT_TRACKER_SALT = '185672dd44712f60bb1736df5a377e82';

/** 概念版 appid（登录平台判定用） */
export const CONCEPT_APPID = 3116;
/** 概念版 clientver */
export const CONCEPT_CLIENTVER = 11430;

/** 网关请求签名参数类型 */
export type GatewayParams = Record<string, string | number>;
/**
 * 平台身份：token 与 appid 必须同平台，VIP 鉴权才会生效。
 * 3116 = 酷狗概念版（lite），1005 = 酷狗标准版。
 */
export interface GatewayPlatform {
  appid: number;
  clientver: number;
  signatureSalt: string;
  trackerKeySalt: string;
  pageId: number;
  ppid: string;
  pid: number;
}

export const PLATFORM_CONCEPT: GatewayPlatform = {
  appid: CONCEPT_APPID,
  clientver: CONCEPT_CLIENTVER,
  signatureSalt: CONCEPT_SIGNATURE_SALT,
  trackerKeySalt: CONCEPT_TRACKER_SALT,
  pageId: 967177915,
  ppid: '356753938,823673182,967485191',
  pid: 411,
};

export const PLATFORM_STANDARD: GatewayPlatform = {
  appid: 1005,
  clientver: 11430,
  signatureSalt: STANDARD_SIGNATURE_SALT,
  trackerKeySalt: STANDARD_TRACKER_SALT,
  pageId: 151369488,
  ppid: '463467626,350369493,788954147',
  pid: 2,
};

/** 由本地保存的 appid 判定登录平台 */
export function platformOfAppId(appId?: number): GatewayPlatform {
  return (appId || 1005) === CONCEPT_APPID ? PLATFORM_CONCEPT : PLATFORM_STANDARD;
}

/**
 * 资料/会员类网关接口使用的 clientver（与 trackercdn 的 clientver 不同，沿用官方实测值）
 */
export function gatewayClientverFor(platform: GatewayPlatform): number {
  return platform.appid === CONCEPT_APPID ? CONCEPT_CLIENTVER : 20489;
}

/** 取另一个平台（token 与 appid 不匹配时换平台重试用） */
export function otherPlatform(platform: GatewayPlatform): GatewayPlatform {
  return platform === PLATFORM_CONCEPT ? PLATFORM_STANDARD : PLATFORM_CONCEPT;
}

/**
 * MD5 签名（全仓库唯一实现）：salt + 参数按名排序拼接 + body + salt
 * 参数里已有的 signature 不参与排序拼接。
 */
export function signWithSalt(salt: string, params: GatewayParams, bodyObj?: unknown): string {
  const sorted = Object.keys(params)
    .filter((key) => key !== 'signature')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('');
  const bodyStr = bodyObj ? (typeof bodyObj === 'string' ? bodyObj : JSON.stringify(bodyObj)) : '';
  return md5(`${salt}${sorted}${bodyStr}${salt}`);
}

/** trackercdn 的 key 参数：hash + 盐值 + appid + mid + userid */
export function trackerKey(
  hash: string,
  platform: GatewayPlatform,
  mid: string,
  userid: string
): string {
  return md5(`${hash}${platform.trackerKeySalt}${platform.appid}${mid}${userid}`);
}
