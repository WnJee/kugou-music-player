/**
 * 本地键值存储 (src/utils/store.ts)
 *
 * Tauri 环境下用 plugin-store 持久化，浏览器环境下回退 localStorage；
 * 值统一走 JSON 序列化，调用方不再各写一套读/写/解析逻辑。
 */

import { Store } from '@tauri-apps/plugin-store';

const storeCache = new Map<string, Store>();

const hasTauriInternals = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function localStorageKey(file: string, key: string): string {
  return `${file}:${key}`;
}

/** 加载（并缓存）Store 实例；浏览器环境返回 null */
async function loadStore(file: string): Promise<Store | null> {
  if (!hasTauriInternals()) return null;

  const cached = storeCache.get(file);
  if (cached) return cached;

  try {
    const store = await Store.load(file);
    storeCache.set(file, store);
    return store;
  } catch (err) {
    console.warn(`[Store] 加载 ${file} 失败，回退 localStorage`, err);
    return null;
  }
}

/** 读取一个值（不存在或解析失败时返回兜底值） */
export async function readStoreValue<T>(file: string, key: string, fallback: T): Promise<T> {
  const store = await loadStore(file);
  if (store) {
    const value = await store.get<T>(key);
    return value ?? fallback;
  }

  if (typeof localStorage === 'undefined') return fallback;
  const raw = localStorage.getItem(localStorageKey(file, key));
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** 写入一个值并立即落盘 */
export async function writeStoreValue(file: string, key: string, value: unknown): Promise<void> {
  const store = await loadStore(file);
  if (store) {
    await store.set(key, value);
    await store.save();
    return;
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(localStorageKey(file, key), JSON.stringify(value));
  }
}

/** 删除一个值 */
export async function removeStoreValue(file: string, key: string): Promise<void> {
  const store = await loadStore(file);
  if (store) {
    await store.delete(key);
    await store.save();
    return;
  }

  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(localStorageKey(file, key));
  }
}
