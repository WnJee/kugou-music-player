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

  /**
   * 浏览器要求音频上下文必须由用户手势唤醒。
   * 返回是否真的进入 running：返回 false 时调用方应回退到无音效播放，
   * 否则整首歌会被挂在暂停的 AudioContext 上变成静音。
   */
  async resume(): Promise<boolean> {
    return (await this.resumeDetailed()).ok;
  }

  /** 唤醒 AudioContext 并给出可判定的失败原因（不吞掉错误） */
  async resumeDetailed(): Promise<EffectResumeResult> {
    if (this.ctx.state === 'running') return { ok: true };
    try {
      await this.ctx.resume();
      // 早退分支已把 this.ctx.state 窄化成非 running，这里重新取值判定
      const resumed = String(this.ctx.state) === 'running';
      return resumed ? { ok: true } : { ok: false, reason: 'rejected' };
    } catch (err) {
      console.warn('[AudioEffectChain] AudioContext 唤醒失败:', err);
      return { ok: false, reason: 'error' };
    }
  }

  /** 当前音频图是否处于运行状态（供调用方判定是否已静音） */
  get running(): boolean {
    return this.ctx.state === 'running';
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

/** 音效链唤醒结果：调用方根据 reason 决定是重试用还是降级无音效 */
export interface EffectResumeResult {
  ok: boolean;
  /** rejected = 被阻断重试也没用；error = 唤醒报错可重试 */
  reason?: 'rejected' | 'error';
}

/** 丢弃响应体，避免探测请求一直占着连接 */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    /* 无 body 或已被消费 */
  }
}

/**
 * 探测音源能否被 Web Audio 取用（跨域且未放行 ACAO 的资源接进音频图只会静音）。
 * 不能用 Range 这类自定义请求头探测：它会触发 CORS 预检，预检失败会被误判成不可用，
 * 导致音效链整首静音。这里只用简单请求（HEAD 优先，不支持 HEAD 的 CDN 再退 GET），
 * 并且无论成败都取消/丢弃响应体。
 */
/** 探测预算：CDN 卡住时不能拖住首播，超时就当不可用（音效降级比不出声好） */
const CORS_PROBE_TIMEOUT_MS = 1200;

/**
 * 单次探测请求各用独立超时。不要用 AbortSignal.timeout：
 * 老 Android WebView（< Chrome 103）没有这个静态方法，会在 try 外抛 TypeError，
 * 让「不可用」误传成「抛错」，最终把整首歌误判成坏源。
 */
async function fetchProbe(url: string, method: 'HEAD' | 'GET'): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CORS_PROBE_TIMEOUT_MS);
  try {
    return await window.fetch(url, {
      method,
      mode: 'cors',
      cache: 'no-store',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function checkAudioCors(url: string): Promise<boolean> {
  if (!url) return false;

  try {
    const head = await fetchProbe(url, 'HEAD');
    if (head.ok || head.status === 206) {
      await discardBody(head);
      return true;
    }
    await discardBody(head);

    const get = await fetchProbe(url, 'GET');
    const usable = get.ok || get.status === 206;
    await discardBody(get);
    return usable;
  } catch {
    return false;
  }
}
