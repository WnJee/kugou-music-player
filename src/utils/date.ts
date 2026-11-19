/**
 * 日期格式化工具 (src/utils/date.ts)
 *
 * 不能用 `toISOString().split('T')[0]` 取「今天」：那是 UTC 日期，
 * 东八区 0:00-8:00 之间会算成前一天（签到日期因此错位）。
 * 统一按本地时区输出 YYYY-MM-DD。
 */

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** 按本地时区格式化为 YYYY-MM-DD */
export function toLocalDateString(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** 本地时区的「今天」 */
export function todayLocalDate(): string {
  return toLocalDateString();
}
