/**
 * 通用丝滑歌词滚动组件 (src/components/LyricsScroller.tsx)
 *
 * 用 transform 位移替代原生 scrollTo 滚动：
 * - 位移与缩放全部走 transform，不改变字号/行高，布局完全静态，
 *   不会因行高动画导致"滚过头再回弹"，也不影响 offsetTop 测量
 * - 支持滚轮/触摸临时翻阅，松手数秒后自动回到跟随模式
 *
 * 两种排版：
 *   variant="center" —— 播放详情页：居中、按距当前行的距离逐级缩放，当前行最大最亮
 *   variant="left"   —— 桌面歌词栏：左对齐 + 2px 赭橙竖条，信息密度更高
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
  /** 激活行附加样式（不要改字号/行高，缩放由 data-distance 负责） */
  activeClassName?: string;
  /** 非激活行附加样式 */
  idleClassName?: string;
  /** 滚动容器（外层，负责裁剪与蒙版）额外类名 */
  containerClassName?: string;
  /** 内部位移层额外类名（内边距放在这里才能正确测量） */
  contentClassName?: string;
  /** 无歌词时的展示节点 */
  emptyNode?: React.ReactNode;
  /** 排版：居中缩放（播放页）或左对齐（桌面歌词栏） */
  variant?: 'center' | 'left';
}

/** 用户手动翻阅后，多久恢复自动跟随 */
const RESUME_DELAY = 4000;
/** 位移过渡曲线：标准 ease-out，无过冲 */
const EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

/** 距当前行的距离，超过 3 行统一按 3 处理（更远的行视觉上已无差别） */
function distanceOf(idx: number, activeIndex: number): number {
  if (activeIndex < 0) return 3;
  return Math.min(3, Math.abs(idx - activeIndex));
}

export const LyricsScroller: React.FC<LyricsScrollerProps> = ({
  lyrics,
  activeIndex,
  onSeek,
  activeClassName = '',
  idleClassName = '',
  containerClassName = '',
  contentClassName = '',
  emptyNode,
  variant = 'left',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const resumeTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ y: number; offset: number } | null>(null);

  const [baseOffset, setBaseOffset] = useState(0);
  const [userOffset, setUserOffset] = useState(0);
  const [userActive, setUserActive] = useState(false);
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

  const measure = useCallback(() => {
    const container = containerRef.current;
    const list = listRef.current;
    if (!container || !list) return;
    // 还没唱到第一句时（activeIndex = -1）不做居中位移，歌词从顶部开始，
    // 否则整段歌词会被推到底部，上面留一片空白
    if (activeIndex < 0) {
      setBaseOffset(0);
      return;
    }
    const el = list.querySelector<HTMLElement>(`[data-lyric-idx="${activeIndex}"]`);
    if (!el) {
      setBaseOffset(0);
      return;
    }
    // offsetTop / offsetHeight 不受 transform: scale 影响，所以缩放不会打乱定位
    setBaseOffset(container.clientHeight / 2 - el.offsetTop - el.offsetHeight / 2);
  }, [activeIndex]);

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
    setInstant(true);
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
  const isEmpty = lyrics.length === 0;

  return (
    <div
      ref={containerRef}
      className={`lyric-scroller lyric-scroller--${variant} relative overflow-hidden touch-none ${containerClassName}`}
      onWheel={isEmpty ? undefined : handleWheel}
      onTouchStart={isEmpty ? undefined : handleTouchStart}
      onTouchMove={isEmpty ? undefined : handleTouchMove}
      onTouchEnd={isEmpty ? undefined : handleTouchEnd}
    >
      {isEmpty ? (
        <div className="absolute inset-0 flex items-center justify-center">{emptyNode}</div>
      ) : (
        <div
          ref={listRef}
          className={`relative will-change-transform ${contentClassName}`}
          style={{
            transform: `translate3d(0, ${displayOffset}px, 0)`,
            transition: instant ? 'none' : `transform 620ms ${EASE}`,
          }}
        >
          {lyrics.map((line, idx) => {
            const isActive = idx === activeIndex;
            const distance = distanceOf(idx, activeIndex);
            return (
              <p
                key={`${line.time}-${idx}`}
                data-lyric-idx={idx}
                data-active={isActive}
                data-distance={distance}
                onClick={() => handleSeek(line.time)}
                className={`lyric-line lyric-line--${variant} cursor-pointer select-none ${
                  isActive ? activeClassName : idleClassName
                }`}
              >
                {line.text || '·'}
              </p>
            );
          })}
        </div>
      )}
    </div>
  );
};
