/**
 * 通用丝滑歌词滚动组件 (src/components/LyricsScroller.tsx)
 *
 * 用 transform 位移替代原生 scrollTo 滚动：
 * - 所有歌词行使用相同字号/行高（仅颜色/字重/缩放变化），布局完全静态，不会因行高动画导致"滚过头再回弹"
 * - 位移使用统一缓动曲线，视觉上丝滑无抖动
 * - 支持滚轮/触摸临时翻阅，松手数秒后自动回到跟随模式
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

interface LyricLine {
  time: number;
  text: string;
}

interface LyricsScrollerProps {
  lyrics: LyricLine[];
  activeIndex: number;
  onSeek: (time: number) => void;
  /** 激活行样式（请保持与 idle 相同字号和行高，仅用颜色/字重/缩放区分） */
  activeClassName: string;
  /** 非激活行样式 */
  idleClassName: string;
  /** 滚动容器额外类名（padding、蒙版等） */
  containerClassName?: string;
}

/** 用户手动翻阅后，多久恢复自动跟随 */
const RESUME_DELAY = 4000;
/** 位移过渡曲线：标准 ease-out，无过冲（避免回弹感） */
const EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

export const LyricsScroller: React.FC<LyricsScrollerProps> = ({
  lyrics,
  activeIndex,
  onSeek,
  activeClassName,
  idleClassName,
  containerClassName = '',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const resumeTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ y: number; offset: number } | null>(null);

  // 自动跟随的目标位移（让激活行垂直居中）
  const [baseOffset, setBaseOffset] = useState(0);
  // 用户手动翻阅的附加位移
  const [userOffset, setUserOffset] = useState(0);
  const [userActive, setUserActive] = useState(false);
  // 切歌/首次定位时跳过过渡动画
  const [instant, setInstant] = useState(true);

  const clearResumeTimer = useCallback(() => {
    if (resumeTimerRef.current !== null) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  }, []);

  const scheduleResume = useCallback(() => {
    clearResumeTimer();
    resumeTimerRef.current = window.setTimeout(() => {
      setUserActive(false);
      setUserOffset(0);
    }, RESUME_DELAY);
  }, [clearResumeTimer]);

  useEffect(() => clearResumeTimer, [clearResumeTimer]);

  // 重新测量：让 activeIndex 对应行居中
  const measure = useCallback(() => {
    const container = containerRef.current;
    const list = listRef.current;
    if (!container || !list) return;
    const el = list.querySelector<HTMLElement>(`[data-lyric-idx="${activeIndex}"]`);
    if (!el) return;
    setBaseOffset(container.clientHeight / 2 - el.offsetTop - el.offsetHeight / 2);
  }, [activeIndex]);

  // 切歌（lyrics 引用变化）：立即归位、恢复跟随
  useEffect(() => {
    setInstant(true);
    setUserActive(false);
    setUserOffset(0);
  }, [lyrics]);

  useEffect(() => {
    measure();
    const raf = requestAnimationFrame(() => setInstant(false));
    return () => cancelAnimationFrame(raf);
  }, [measure]);

  // 容器尺寸变化时重新对齐
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(container);
    return () => ro.disconnect();
  }, [measure]);

  const clampTotal = useCallback(
    (total: number) => {
      const container = containerRef.current;
      const list = listRef.current;
      if (!container || !list) return total;
      const min = Math.min(0, container.clientHeight - list.scrollHeight);
      const max = Math.max(0, baseOffset);
      return Math.min(max, Math.max(min, total));
    },
    [baseOffset]
  );

  const handleWheel = (e: React.WheelEvent) => {
    const current = userActive ? baseOffset + userOffset : baseOffset;
    const next = clampTotal(current - e.deltaY);
    setUserActive(true);
    setUserOffset(next - baseOffset);
    scheduleResume();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const current = userActive ? baseOffset + userOffset : baseOffset;
    touchStartRef.current = { y: e.touches[0].clientY, offset: current };
    clearResumeTimer();
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    if (!start) return;
    const next = clampTotal(start.offset + (e.touches[0].clientY - start.y));
    setInstant(true); // 拖动过程直接跟手，不做缓动
    setUserActive(true);
    setUserOffset(next - baseOffset);
  };

  const handleTouchEnd = () => {
    touchStartRef.current = null;
    setInstant(false);
    scheduleResume();
  };

  const handleSeek = (time: number) => {
    clearResumeTimer();
    setUserActive(false);
    setUserOffset(0);
    onSeek(time);
  };

  const displayOffset = userActive ? baseOffset + userOffset : baseOffset;

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden touch-none ${containerClassName}`}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        ref={listRef}
        className="relative will-change-transform"
        style={{
          transform: `translate3d(0, ${displayOffset}px, 0)`,
          transition: instant ? 'none' : `transform 600ms ${EASE}`,
        }}
      >
        {lyrics.map((line, idx) => {
          const isActive = idx === activeIndex;
          return (
            <p
              key={`${line.time}-${idx}`}
              data-lyric-idx={idx}
              onClick={() => handleSeek(line.time)}
              className={`cursor-pointer select-none text-center transition-all duration-300 ${
                isActive ? activeClassName : idleClassName
              }`}
            >
              {line.text || '♪'}
            </p>
          );
        })}
      </div>
    </div>
  );
};
