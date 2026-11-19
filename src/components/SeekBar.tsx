/**
 * 自绘播放进度轨道 (src/components/SeekBar.tsx)
 *
 * 原生 range 轨道的伪元素在 WebKit 里无法稳定接收 CSS 变量做渐变填充，
 * 所以拆成「可见的轨道（自己画）+ 透明的原生 input（只负责交互）」：
 * 填充、hover 手柄都能精确控制，且不牺牲键盘与无障碍。
 */

import React from 'react';

export const SeekBar: React.FC<{
  value: number;
  max: number;
  onChange: (v: number) => void;
  large?: boolean;
  label: string;
}> = ({ value, max, onChange, large, label }) => {
  const safeMax = max > 0 ? max : 100;
  const pct = Math.min(100, Math.max(0, (value / safeMax) * 100));
  return (
    <div className={`seek ${large ? 'seek-lg' : ''}`}>
      <div className="seek-track" aria-hidden>
        <div className="seek-fill" style={{ width: `${pct}%` }} />
      </div>
      <input
        type="range"
        min={0}
        max={safeMax}
        step={0.1}
        value={Math.min(value, safeMax)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="seek-input"
        aria-label={label}
      />
    </div>
  );
};
