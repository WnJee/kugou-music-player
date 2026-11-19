/**
 * 弹层栈与快捷键屏蔽信号 (src/components/overlayStack.ts)
 *
 * Android 物理返回键由原生侧派发 document 事件 'app-back'，本模块只回答「先关谁」：
 * 每个弹层注册时带一个优先级，数值大的在内层、先被关闭；栈空时不接管，
 * 交给原生决定是否退出应用。
 *
 * 同时对外提供「有弹层打开」的信号，供全局快捷键判断是否该让路：
 *   - document.body.dataset.modal === '1'
 *   - isAnyOverlayOpen()
 * PlayerContext 的全局 keydown 尚未接入，接入时读上面任一信号即可，
 * 弹层打开期间不响应空格播放与方向键快进，避免在对话框里误触。
 */

import { useEffect, useRef } from 'react';

/** 统一的关闭优先级：数值越大越靠内层，越先被返回键关掉 */
export const OVERLAY_PRIORITY = {
  /** 音质 / 音效面板：常挂在别的弹层里，最先收 */
  audioMenu: 90,
  /** 弹层内部的二级对话框：队列抽屉、加入歌单、移除确认 */
  nested: 80,
  /** 移动端全屏播放页 */
  mobilePlayer: 60,
  /** 移动端歌单抽屉 */
  drawer: 55,
  /** 全局弹窗：导入 > 更新 > 设置（设置里能打开更新） */
  importModal: 50,
  updateModal: 45,
  settingsModal: 40,
} as const;

interface OverlayEntry {
  priority: number;
  close: () => void;
}

let stack: OverlayEntry[] = [];

/** 同步 body 标记：全局快捷键据此让路 */
function syncModalFlag(): void {
  if (stack.length > 0) document.body.dataset.modal = '1';
  else delete document.body.dataset.modal;
}

export function isAnyOverlayOpen(): boolean {
  return stack.length > 0;
}

/** 注册一个弹层，返回注销函数（通常是 useEffect 的清理函数） */
export function pushOverlay(priority: number, close: () => void): () => void {
  const entry: OverlayEntry = { priority, close };
  stack.push(entry);
  syncModalFlag();
  return () => {
    stack = stack.filter((item) => item !== entry);
    syncModalFlag();
  };
}

/** 关闭最内层弹层；栈空返回 false，表示没有弹层可关 */
export function closeTopOverlay(): boolean {
  const top = stack.reduce<OverlayEntry | null>(
    (acc, item) => (acc === null || item.priority >= acc.priority ? item : acc),
    null
  );
  if (!top) return false;
  stack = stack.filter((item) => item !== top);
  syncModalFlag();
  top.close();
  return true;
}

/**
 * 把弹层接进返回键与快捷键屏蔽信号。
 * 用法：useOverlayBack(isOpen, onClose, OVERLAY_PRIORITY.nested)
 */
export function useOverlayBack(isOpen: boolean, onClose: () => void, priority: number): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    return pushOverlay(priority, () => closeRef.current());
  }, [isOpen, priority]);
}
