/**
 * 音质档位表 (src/services/audioQuality.ts)
 *
 * 网关 /v5/url 的 quality 参数决定返回码流。会员等级不同，能拿到的档位不同，
 * 所以每个档位都带一条「自身 → 逐级下降」的请求链，取不到就自动降档，而不是报错。
 */

import type { AudioQuality } from '../types/music';

export interface AudioQualityOption {
  id: AudioQuality;
  /** 菜单里的名字 */
  label: string;
  /** 底栏胶囊上的短标 */
  badge: string;
  /** 采样规格，等宽小字 */
  spec: string;
  /** 网关 quality 参数，按优先级排列 */
  params: Array<number | string>;
}

export const AUDIO_QUALITY_OPTIONS: AudioQualityOption[] = [
  { id: '128', label: '标准', badge: '128K', spec: 'MP3 128 kbps', params: [128, '128'] },
  { id: '320', label: '高音质', badge: '320K', spec: 'MP3 320 kbps', params: [320, '320'] },
  { id: 'flac', label: '无损', badge: 'FLAC', spec: 'FLAC 44.1 kHz', params: ['flac', 640] },
  { id: 'hires', label: 'Hi-Res', badge: 'HR', spec: 'FLAC 24 bit 96 kHz', params: ['hires'] },
];

export const DEFAULT_AUDIO_QUALITY: AudioQuality = '320';

const BY_ID = new Map(AUDIO_QUALITY_OPTIONS.map((option) => [option.id, option]));

export function audioQualityOption(id?: AudioQuality | null): AudioQualityOption {
  return (id && BY_ID.get(id)) || BY_ID.get(DEFAULT_AUDIO_QUALITY) || AUDIO_QUALITY_OPTIONS[0];
}

/** 请求链：目标档位在前，之后按档位从高到低依次回退 */
export function audioQualityChain(id?: AudioQuality | null): Array<number | string> {
  const top = AUDIO_QUALITY_OPTIONS.indexOf(audioQualityOption(id));
  return AUDIO_QUALITY_OPTIONS.slice(0, top + 1)
    .reverse()
    .flatMap((option) => option.params);
}

/** 网关参数反查实际到手的档位 */
export function qualityOfParam(param: number | string): AudioQuality {
  if (param === 'hires') return 'hires';
  if (param === 'flac' || param === 640) return 'flac';
  if (param === 320 || param === '320') return '320';
  return '128';
}
