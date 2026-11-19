/**
 * 设备标识服务 (src/services/device.ts)
 *
 * 酷狗移动端网关（gateway.kugou.com）会校验请求中的设备 MID 是否与登录会话一致。
 * 因此 MID 必须：
 *   1. 生成一次后持久化保存；
 *   2. 在「扫码登录创建 / 扫码状态轮询 / 网关业务请求」全流程中保持一致。
 * 若每次请求都随机生成新的 MID，网关会返回 error_code 20017（参数/登录态校验失败）。
 */

import { md5 } from '../utils/md5';
import { readStoreValue, writeStoreValue } from '../utils/store';

const DEVICE_STORE_FILE = 'kugou_device.json';
const DEVICE_MID_KEY = 'device_mid';

/** 兜底 MID（仅在 BigInt 不可用时使用） */
const FALLBACK_MID = '239526275778893399526700786998289824956';

let cachedMid: string | null = null;

/**
 * 生成随机 GUID（优先使用 Web Crypto，保证设备标识足够随机）
 */
function randomGuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try {
      return crypto.randomUUID();
    } catch {
      /* 忽略，走下方兜底 */
    }
  }
  const rand = () => Math.random().toString(16).slice(2).padStart(8, '0');
  return `${rand()}-${rand()}-${rand()}-${rand()}`;
}

/**
 * 由 GUID 推导酷狗设备 MID（MD5 的十六进制大整数表示）
 */
export function calculateMid(seed: string): string {
  try {
    return BigInt('0x' + md5(seed)).toString();
  } catch {
    return FALLBACK_MID;
  }
}

/**
 * 读取（或首次生成并持久化）全局唯一设备 MID
 */
export async function getDeviceMid(): Promise<string> {
  if (cachedMid) return cachedMid;

  const existing = await readStoreValue<string | null>(DEVICE_STORE_FILE, DEVICE_MID_KEY, null);
  if (existing) {
    cachedMid = existing;
    return existing;
  }

  const mid = calculateMid(randomGuid());
  cachedMid = mid;
  await writeStoreValue(DEVICE_STORE_FILE, DEVICE_MID_KEY, mid);
  return mid;
}
