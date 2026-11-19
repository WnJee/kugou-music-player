/**
 * 播放时间格式 (src/components/playbackTime.ts)
 * 秒 → m:ss。缺时长时按场景给占位：播放条 0:00、列表 --:--。
 */
export function formatTime(secs: number, fallback = '0:00'): string {
  if (!secs || isNaN(secs)) return fallback;
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
