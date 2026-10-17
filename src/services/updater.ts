/**
 * 应用内自动更新服务 (src/services/updater.ts)
 *
 * 基于 tauri-plugin-updater：
 *   1. 启动时静默检查 GitHub Releases 是否有新版本（latest.json）
 *   2. 发现新版本时回调通知 UI 弹窗提示
 *   3. 用户确认后下载（带进度回调），完成后自动重启进入新版
 *
 * 仅桌面端（macOS/Windows/Linux）可用；Android APK 不支持应用内自更新，
 * 插件调用会抛错，统一封装为 { available: false }。
 */

import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { isTauriEnvironment } from './http';

export interface UpdateProgress {
  /** 已下载字节数 */
  downloaded: number;
  /** 总字节数（可能为 0 表示未知） */
  total: number;
}

export interface UpdateCheckResult {
  /** 是否检查成功（网络失败/非 Tauri 环境为 false） */
  ok: boolean;
  /** 是否有可用更新 */
  available: boolean;
  /** 新版本号 */
  version?: string;
  /** 更新说明 */
  notes?: string;
  /** 当前版本 */
  currentVersion?: string;
}

let pendingUpdate: Update | null = null;

/**
 * 检查 GitHub 是否有新版本。
 * 成功时缓存 Update 对象供 downloadAndInstall 使用。
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (typeof window === 'undefined' || !isTauriEnvironment()) {
    return { ok: false, available: false };
  }

  try {
    const update = await check();
    if (update) {
      pendingUpdate = update;
      return {
        ok: true,
        available: true,
        version: update.version,
        notes: update.body || '',
      };
    }
    return { ok: true, available: false };
  } catch (err) {
    console.warn('[Updater] 检查更新失败:', err);
    return { ok: false, available: false };
  }
}

/**
 * 下载并安装更新，完成后自动重启应用。
 * onProgress 可选，用于展示下载进度。
 */
export async function downloadAndInstallUpdate(
  onProgress?: (p: UpdateProgress) => void
): Promise<{ success: boolean; message: string }> {
  if (!pendingUpdate) {
    // 兜底：重新检查一次
    const res = await checkForUpdate();
    if (!res.available) {
      return { success: false, message: '当前已是最新版本' };
    }
  }

  const update = pendingUpdate;
  if (!update) {
    return { success: false, message: '更新对象不可用' };
  }

  try {
    let total = 0;
    let downloaded = 0;

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          total = event.data.contentLength ?? 0;
          onProgress?.({ downloaded: 0, total });
          break;
        case 'Progress':
          downloaded += event.data.chunkLength;
          onProgress?.({ downloaded, total });
          break;
        case 'Finished':
          onProgress?.({ downloaded: total || downloaded, total });
          break;
      }
    });

    // 安装完成后重启进入新版（Windows 下 install 会先退出旧进程）
    await relaunch();
    return { success: true, message: '更新完成，正在重启...' };
  } catch (err) {
    console.error('[Updater] 下载/安装更新失败:', err);
    pendingUpdate = null;
    return {
      success: false,
      message: err instanceof Error ? err.message : '下载更新失败',
    };
  }
}
