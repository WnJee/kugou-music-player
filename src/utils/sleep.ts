/**
 * 延时工具 (src/utils/sleep.ts)
 *
 * 仓库内所有「等待若干毫秒」的场景统一走这里，避免到处内联 new Promise(setTimeout)。
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
