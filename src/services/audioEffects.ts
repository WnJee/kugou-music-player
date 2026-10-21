/**
 * 音效处理链 (src/services/audioEffects.ts)
 *
 * 三段均衡（180Hz 低架 / 1.6kHz 峰值 / 6kHz 高架）串一个动态压限。
 * Web Audio 的 MediaElementSource 一旦建立就无法解绑，且跨域未放行的资源接进
 * 音频图后只会输出静音，所以挂链之前必须先 checkAudioCors 探一次（酷狗 CDN 返回
 * access-control-allow-origin: *，可用；备轨镜像不一定）。
 */

import type { AudioEffectId } from '../types/music';

export interface AudioEffectPreset {
  id: AudioEffectId;
  label: string;
  /** 三段增益 (dB) */
  gain: { low: number; mid: number; high: number };
  /** 动态压限阈值 (dB)，null 表示不压 */
  compress: number | null;
}

export const AUDIO_EFFECT_PRESETS: AudioEffectPreset[] = [
  { id: 'off', label: '原声', gain: { low: 0, mid: 0, high: 0 }, compress: null },
  { id: 'lily', label: '丽音', gain: { low: -2, mid: 4, high: 2.5 }, compress: -20 },
  { id: 'hifi', label: '音响', gain: { low: 6, mid: -2, high: 3 }, compress: -18 },
  { id: 'car', label: '车载', gain: { low: -5, mid: 4, high: 2 }, compress: -26 },
  { id: 'live', label: '现场', gain: { low: 2, mid: -2, high: 5 }, compress: -22 },
  { id: 'rock', label: '摇滚', gain: { low: 5, mid: -3, high: 5 }, compress: null },
];

export function audioEffectPreset(id?: AudioEffectId | null): AudioEffectPreset {
  return AUDIO_EFFECT_PRESETS.find((preset) => preset.id === id) ?? AUDIO_EFFECT_PRESETS[0];
}

export class AudioEffectChain {
  private ctx: AudioContext;
  private low: BiquadFilterNode;
  private mid: BiquadFilterNode;
  private high: BiquadFilterNode;
  private comp: DynamicsCompressorNode;

  constructor(audio: HTMLAudioElement) {
    this.ctx = new AudioContext();

    const source = this.ctx.createMediaElementSource(audio);

    this.low = this.ctx.createBiquadFilter();
    this.low.type = 'lowshelf';
    this.low.frequency.value = 180;

    this.mid = this.ctx.createBiquadFilter();
    this.mid.type = 'peaking';
    this.mid.frequency.value = 1600;
    this.mid.Q.value = 0.9;

    this.high = this.ctx.createBiquadFilter();
    this.high.type = 'highshelf';
    this.high.frequency.value = 6000;

    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.attack.value = 0.006;
    this.comp.release.value = 0.2;

    source
      .connect(this.low)
      .connect(this.mid)
      .connect(this.high)
      .connect(this.comp)
      .connect(this.ctx.destination);

    this.setPreset('off');
  }

  /** 浏览器要求音频上下文必须由用户手势唤醒 */
  resume(): Promise<void> {
    return this.ctx.state === 'suspended' ? this.ctx.resume() : Promise.resolve();
  }

  setPreset(id?: AudioEffectId | null): void {
    const preset = audioEffectPreset(id);
    this.low.gain.value = preset.gain.low;
    this.mid.gain.value = preset.gain.mid;
    this.high.gain.value = preset.gain.high;
    this.comp.threshold.value = preset.compress ?? 0;
    this.comp.ratio.value = preset.compress == null ? 1 : 3;
  }

  dispose(): void {
    void this.ctx.close().catch(() => {});
  }
}

/** 探测音源能否被 Web Audio 取用（跨域且未放行 ACAO 的资源接进音频图只会静音） */
export async function checkAudioCors(url: string): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await window.fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-1' },
      mode: 'cors',
      cache: 'no-store',
    });
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}
