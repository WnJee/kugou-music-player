/**
 * 音质 / 音效切换面板 (src/components/AudioOptionsMenu.tsx)
 *
 * 一个胶囊 + 一块面板：上半是音质档位（等宽规格对齐），下半是音效。
 * 面板贴在触发键上方（底栏）或下方（页面顶栏），点外部或 Esc 关闭。
 */

import React, { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { AUDIO_QUALITY_OPTIONS, audioQualityOption } from '../services/audioQuality';
import { AUDIO_EFFECT_PRESETS } from '../services/audioEffects';

interface AudioOptionsMenuProps {
  direction?: 'up' | 'down';
}

export const AudioOptionsMenu: React.FC<AudioOptionsMenuProps> = ({ direction = 'up' }) => {
  const { audioQuality, setAudioQuality, audioEffect, setAudioEffect, effectBlocked } = usePlayer();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  const quality = audioQualityOption(audioQuality);
  const effectOn = audioEffect !== 'off';

  return (
    <div className="aom" ref={rootRef}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className="aom-trigger icon-btn"
        data-on={isOpen || effectOn}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="音质与音效"
        title="音质与音效"
      >
        <span className="mono aom-badge">{quality.badge}</span>
        <SlidersHorizontal size={13} strokeWidth={1.7} />
      </button>

      {isOpen && (
        <div className="aom-pop" data-dir={direction} role="menu" aria-label="音质与音效">
          <div className="aom-group">
            <span className="microcaps">音质</span>
            {AUDIO_QUALITY_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={option.id === audioQuality}
                className="aom-opt"
                data-active={option.id === audioQuality}
                onClick={() => setAudioQuality(option.id)}
              >
                <span className="aom-label">{option.label}</span>
                <span className="aom-spec mono">{option.spec}</span>
              </button>
            ))}
          </div>

          <div className="aom-group">
            <span className="microcaps">音效</span>
            <div className="aom-chips">
              {AUDIO_EFFECT_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={preset.id === audioEffect}
                  className="aom-chip"
                  data-active={preset.id === audioEffect}
                  onClick={() => void setAudioEffect(preset.id)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {effectBlocked && <p className="aom-note">当前音源不支持音效</p>}
          </div>
        </div>
      )}
    </div>
  );
};
