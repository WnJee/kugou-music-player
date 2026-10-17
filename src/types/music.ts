/**
 * 酷狗音乐核心数据类型定义
 */

export interface KuGouSong {
  /** 歌曲音频唯一标识 Hash */
  hash: string;
  /** 歌曲名称 */
  songName: string;
  /** 歌手名称 */
  singerName: string;
  /** 专辑 ID */
  albumId: string;
  /** 歌曲时长（秒） */
  duration: number;
  /** 歌曲封面 URL */
  coverUrl: string;
  /** 备用音质或文件哈希（如 SQ/HQ） */
  sqHash?: string;
  /** 官方音频直链（若已解析） */
  audioUrl?: string;
  /** 酷狗内部歌曲 ID (MixSongID) */
  mixSongId?: string;
}

export interface KuGouPlaylist {
  /** 歌单唯一 ID (special_id 或 global_collection_id) */
  id: string;
  /** 歌单名称 */
  name: string;
  /** 歌单封面图 */
  coverUrl: string;
  /** 歌单简介 */
  intro: string;
  /** 歌单曲目总数 */
  totalSongs: number;
  /** 歌单曲目列表 */
  songs: KuGouSong[];
  /** 导入时间戳 */
  importedAt: number;
  /** 来源类型 */
  sourceType: 'shortlink' | 'kugou_code' | 'id' | 'url' | 'user_cloud';
  /** 原始输入内容 */
  rawInput: string;
  /** 是否为当前登录用户的云端自建/收藏歌单 */
  isUserOwned?: boolean;
  /** 酷狗歌单原生 listid */
  listId?: string;
}

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'HEAD' | 'OPTIONS';
  headers?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  /** 是否禁止自动重定向（用于提取 302 Location 短链地址） */
  manualRedirect?: boolean;
  /** 超时毫秒数 */
  timeout?: number;
}

export interface HttpResponse<T = unknown> {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
  /** 重定向目标地址（当 manualRedirect 生效且状态码为 301/302 时返回） */
  redirectUrl?: string;
  /** 最终请求响应的真实 URL（在跟随重定向后返回最终地址） */
  finalUrl?: string;
}

export interface UserSettings {
  /** 酷狗概念版 Token */
  kugouToken: string;
  /** 酷狗用户 UserID */
  kugouUserId: string;
  /** 用户昵称 */
  nickname?: string;
  /** 用户头像 */
  avatar?: string;
  /** VIP 类型描述 */
  vipType?: string;
  /** 启动时是否自动签到领 VIP */
  autoCheckinVip: boolean;
  /** 上次签到日期 (YYYY-MM-DD) */
  lastCheckinDate?: string;
  /** 自定义备用音源 API 地址 */
  customFallbackApi: string;
  /** 登录平台 appid（3116=概念版，1005=标准版；决定网关签名与鉴权平台） */
  kugouAppId?: number;
}

export interface AudioSourceResult {
  /** 音频直链播放地址 */
  url: string;
  /** 音轨标识：主轨 (官方 VIP) 或 备轨 (免登录 Fallback) */
  source: 'primary' | 'fallback';
  /** 码率 (kbps) */
  bitrate?: number;
  /** 音频时长 (秒) */
  duration: number;
  /** 是否为试听片段 (如 <= 60s) */
  isTrial: boolean;
  /** 提示消息 */
  msg?: string;
}

export interface LyricLine {
  /** 歌词开始时间 (秒) */
  time: number;
  /** 歌词正文文本 */
  text: string;
}

export type PlayMode = 'sequence' | 'loop' | 'single' | 'random';
