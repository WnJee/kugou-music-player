# 播放内核与服务层只读审查报告

未修改任何文件。标注「待真机验证」的条目是基于代码结构的推断，没有实机证据；其余均已对照源码核实。密钥和盐值只引用行号。

## 1. 架构概述

- **播放**：单个 `new Audio()`（HTMLAudioElement），由 `PlayerProvider` 持有（`src/context/PlayerContext.tsx:165-206`、`209-218`）。音效非「原声」时才用 `createMediaElementSource` 接入 WebAudio，链路为三段 EQ 加压限（`src/services/audioEffects.ts:41-71`）。没有原生播放，`src-tauri/src/lib.rs` 没有任何 `invoke_handler`，Rust 侧只管托盘和窗口事件。
- **状态**：一个 React Context 承载约 20 个 `useState`（`PlayerContext.tsx:112-135`），Provider value 每次渲染重建（`:1062-1063`）。
- **持久化**：`tauri-plugin-store` 写四个明文 JSON，浏览器环境回退 localStorage。
  - `kugou_playback.json`：音量、模式、歌单 id、当前歌、进度、队列（`PlayerContext.tsx:249-275`）。
  - `kugou_settings.json`：token、userid、音质、音效（`src/services/audioSource.ts:20`、`77-89`）。
  - `kugou_playlists.json`：全部歌单和曲目（`src/services/kugouPlaylist.ts:17`、`604-612`）。
  - `kugou_device.json`：设备 MID（`src/services/device.ts:14`、`69-98`）。
- **网络**：`request()` 在 Tauri 内走 plugin-http 绕过 CORS，浏览器开发态走 `window.fetch` 加 Vite 代理（`src/services/http.ts:39-78`、`125`；`vite.config.ts:32-84`）。超时 15s（`http.ts:113`、`128-129`）。音频流由 WebView 直接拉（`PlayerContext.tsx:556`），CORS 探测也走 `window.fetch`（`audioEffects.ts:96`）。
- **鉴权**：
  - 扫码：`createLoginQrCode`（`src/services/kugouAuth.ts:45-86`），每 2s 轮询（`src/components/SettingsModal.tsx:130`，`kugouAuth.ts:92-149`），成功后保存 token、userid 和 `kugouAppId: 3116`（`SettingsModal.tsx:103-107`）。
  - 签名：`MD5(salt + 排序参数 + body + salt)`（`audioSource.ts:576-588`），平台不匹配时在 3116 与 1005 之间互换重试（`audioSource.ts:729-741`）。
  - 保活：`setInterval` 每 6 小时调一次 VIP 查询（`PlayerContext.tsx:456-471`，`audioSource.ts:270-274`）。代码里没有任何 token 刷新接口。
- **云同步**：
  - 启动时拉歌单元数据（`PlayerContext.tsx:436-452`，`kugouPlaylist.ts:749-870`），按 `cloud_${listId}` 与本地缓存合并（`PlayerContext.tsx:389-423`）。
  - 曲目在 `selectPlaylist` 时懒加载（`:798-834`），每页 300、最多 10 页（`kugouPlaylist.ts:882-885`）。
  - 加歌先云后本地（`PlayerContext.tsx:836-887`），删歌云端失败则不动本地（`:889-934`）。
  - 防重入加 3s 最小间隔（`:358-361`、`382-387`）。

## 2. 现有功能清单

- **播放模式**：`sequence / loop / single / random` 四档循环切换（`PlayerContext.tsx:741-745`）；`sequence` 与 `loop` 行为相同，见 4-M1。
- **队列**：独立于歌单。`playAll` 重建（`:668-672`），搜索结果插队首、其余追加（`:501-507`），可清空（`:675-695`），重启恢复（`:302-307`）。
- **音质**：128 / 320 / FLAC / Hi-Res，带降档链（`src/services/audioQuality.ts:22-43`），切换时保留进度重解析（`PlayerContext.tsx:748-761`）。
- **双轨音源**：官方主轨（`audioSource.ts:749-779`）；备轨依次为自定义 API、同名同长曲目、第三方镜像（`:786-917`）；失败自动跳下一首（`PlayerContext.tsx:630-648`）。
- **音效**：5 个预设加原声（`audioEffects.ts:21-28`），含 CORS 探测和换元素逻辑（`PlayerContext.tsx:221-246`、`763-796`）。
- **歌词**：仅行级 LRC（`src/services/lyrics.ts:30-66`、`:110` 的 `fmt:'lrc'`），当前行定位（`PlayerContext.tsx:474-488`）。
- **搜索**：歌单内过滤（`src/components/SongList.tsx:122-132`）和全网搜索（`SongList.tsx:98-114`，`kugouPlaylist.ts:682-744`）；全网只取第 1 页 30 条。
- **歌单**：短链、酷狗码、URL、ID 导入（`kugouPlaylist.ts:447-534`）；云歌单同步、加歌、删歌；本地删歌单（`PlayerContext.tsx:936-943`）。
- **账号**：扫码登录、手动贴 token（`SettingsModal.tsx:227`）、资料（`audioSource.ts:175-186`）、VIP 状态（`:252-263`）、每日签到领 VIP 含启动自动签到（`:302-515`，`PlayerContext.tsx:451`）。
- **控制**：音量和静音（`PlayerContext.tsx:723-739`）；窗口内快捷键：空格、←→ 5s、↑↓ 音量、Media* 键（`:948-1017`）；MediaSession 元数据和动作（`:1020-1059`）。
- **桌面**：关窗隐藏（`lib.rs:66-72`）；Windows/Linux 托盘含显示和退出（`:24-50`）；macOS 点 Dock 重开（`:88-95`）；桌面自更新（`src/services/updater.ts`）。

## 3. 缺失的常用功能

以下均经全仓 grep 确认无实现：

- **搜索建议、热搜、搜索历史、搜索分页**：`searchKuGouSongs` 只以默认参数调用（`SongList.tsx:107`）。
- **播放历史 / 最近播放**：无。
- **「我喜欢」红心**：无独立入口，只能通过加入歌单弹窗操作。
- **队列操作**：Context 只暴露 `queueSongs` 和 `clearQueue`（`PlayerContext.tsx:84-86`），没有单曲移除、下一首播放、拖拽排序。
- **定时关闭、倍速、淡入淡出、无缝播放、音量归一、自定义 EQ**：无。
- **下载 / 离线缓存**：无；封面和歌词也不缓存，每次播放重新请求（`lyrics.ts:71`）。
- **歌词**：无 KRC 逐字、无翻译和音译、无桌面歌词、无时间偏移；`LyricLine` 只有 `time` 和 `text`（`src/types/music.ts:125-130`）。
- **内容页**：每日推荐、排行榜、歌手页、专辑页、歌单广场、新建或重命名歌单，全无。
- **全局快捷键**：没有 global-shortcut 插件（`src-tauri/Cargo.toml:17-21`），快捷键只在窗口聚焦时生效。
- **系统媒体控制**：只有 WebView 自带的 MediaSession，且没有 `setPositionState`；没有原生 Now Playing、SMTC、Android 通知。
- **Android 后台**：没有前台服务、通知、WakeLock。
- **窗口与实例**：没有窗口状态记忆（`src-tauri/tauri.conf.json:14-22` 固定 1100×720）、单实例、迷你窗口模式（现有 "Mini" 只是移动端底栏）。
- **托盘**：只有显示和退出，没有播放控制和曲目信息（`lib.rs:30-32`）。
- **主题**：`index.html:2` 写死 `class="dark"`，没有浅色或跟随系统。
- **启动静默检查更新**：名义上有，实际不执行，见 4-H6。

## 4. Bug 与风险

### 高

- **H1 缓冲中点暂停会跳到下一首**。`play()` 被 `pause()` 打断时以 AbortError 拒绝，而两处 catch 把任何拒绝都当坏音源交给 `skipBrokenRef`（`PlayerContext.tsx:567-580`、`598-601`）。应过滤 `AbortError` 和 `NotAllowedError`。
- **H2 登录 Cookie 等头被 plugin-http 静默丢弃**。`Cargo.toml:18` 没开 `unsafe-headers`；plugin-http 2.8.3 的 `commands.rs:256-264`、`540-557` 会剔除 Cookie、Host、Referer。
  - 受影响：`audioSource.ts:151`、`228`、`346`、`693` 的 Cookie；`http.ts:19` 的 Referer；`kugouPlaylist.ts:400` 的 Host。
  - `audioSource.ts:692` 的注释称「缺 Cookie 按未登录返回试听」，与实际发包不符，需抓包确认 VIP 鉴权到底靠什么生效。
- **H3 `pendingSeekRef` 泄漏到别的歌**。启动恢复（`:293`）或未加载时拖进度条（`:709`）会写入它，但非 reload 的 `playSong` 从不清空，`clearQueue` 也不清。此时点另一首歌，会在 `loadedmetadata` 被拖到旧位置（`:187-195`）。
- **H4 歌词请求没有过期保护**。`fetchSongLyrics(song).then(setLyrics)`（`:514`）不校验 `requestId`，快速切歌时旧歌词会覆盖新歌。
- **H5 切歌不取消旧请求，可能触发风控**。`requestId` 只是丢弃结果（`:530`），请求链照跑。
  - 单曲最坏情况：Hi-Res 档 7 个参数（`audioQuality.ts:23-26`、`38-43`）各带一次平台重试（`audioSource.ts:735-740`），再加备轨搜索、5 个候选、第三方镜像（`:843-900`），全部串行，每个 15s 超时。
  - 连点下一首会并发多条这样的链。
  - `[128,'128']`、`[320,'320']` 序列化后完全相同（`http.ts:89`，`audioSource.ts:584`），属于重复请求。
- **H6 启动静默检查更新是死代码**。`UpdateModal` 只在 `isUpdateOpen` 时挂载（`src/App.tsx:57-59`），而打开前 signal 已自增（`App.tsx:24-27`），所以 `checkSignal === 0` 分支（`src/components/UpdateModal.tsx:57-63`）永远走不到。g
- **H7 安全面过宽，叠加后一处 XSS 即可接管账号**。
  - `tauri.conf.json:25` 的 `csp: null`。
  - `src-tauri/capabilities/default.json:11-27` 放行任意 http/https 主机。
  - `store:default` 可读明文 token（`default.json:10`，`audioSource.ts:82-84`）。
  - `process:default` 和 `updater:default` 也对 WebView 开放（`default.json:28-29`）。
- **H8 token 会泄漏到日志和界面**。token 放在 URL query 里（`audioSource.ts:131`、`208`、`335`、`659`；`kugouPlaylist.ts:799`、`956`、`1101`、`1196`），超时错误把完整 URL 拼进 message（`http.ts:198`），再被显示到 UI（`PlayerContext.tsx:576-577`、`426-428`）。另有一键复制凭据到剪贴板（`SettingsModal.tsx:474-478`）。
- **H9 自动刷 VIP 时长有封号和合规风险**。启动默认开启（`audioSource.ts:26`，`PlayerContext.tsx:451`），用固定歌曲 id 伪造听歌上报（`audioSource.ts:364-368`），用固定广告 id 伪造 8 次广告播放（`:388-401`）。
  - 没有并发保护：启动自动签到、登录后签到（`SettingsModal.tsx:115`）、手动签到（`:175`）可同时跑。

### 中

- **M1 `sequence` 等于 `loop`**。`getNextSongIndex` 恒为 `(i+1) % total`（`PlayerContext.tsx:605-618`），`ended` 只区分 `single`（`:196-203`），顺序播放到队尾不会停。
- **M2 「连续失败上限」实际是累计**。`failed` 只在队列引用变化时清空（`:651-653`），成功播放不清。一个长队列累计坏 5 首后就不再自动跳，并误报「队列中没有可播放的音源」（`:641-644`）。
- **M3 启动后进度被写成 0**。恢复时只设了 `pendingSeekRef`，没调 `setCurrentTime`（`:290-294`），随后保存进度的 effect 在未播放状态下立刻写入 `position: 0`（`:326-335`）。启动后不播放就退出，下次进度丢失；进度条也显示 0。
- **M4 播放中的进度从不落盘**。只在暂停和 `beforeunload` 时保存（`:328-335`）。桌面关窗是隐藏（`lib.rs:66-72`），不触发 `beforeunload`；托盘退出直接 `app.exit(0)`（`lib.rs:41`）；Android 被杀也没有回调。
- **M5 恢复与持久化竞态**。挂载 500ms 后的防抖保存（`PlayerContext.tsx:313-324`）没有「已恢复完成」的门闩，恢复慢时会把 `song: null, queue: []` 写回去。另外 `savePlaybackPrefs` 是无锁的读改写（`:261-275`），并发会丢补丁。实际发生概率待真机验证。
- **M6 `selectPlaylist` 没有过期保护**。先点 A（多页慢请求）再点 B，A 返回后把视图切回 A（`:818-823`）。另外在 setState updater 里做落盘副作用（`:824-828`），StrictMode 下会执行两次。
- **M7 云端删歌同步不下来**。缓存曲目数 `>=` 云端总数就复用缓存，并取 `Math.max`（`:401-413`），不比较 `list_ver`。云端删歌或增删相抵后本地永久陈旧。加歌云端失败仍写本地并返回 `success: true`（`:859-886`），会产生幽灵歌曲。
- **M8 分页可能提前截断**。末页判断用的是过滤掉无 hash 条目后的数量（`kugouPlaylist.ts:941`、`1032`）；整页 3 次重试失败后同样直接 break 并返回残表（`:1027-1032`）。
  - 调用方把残表长度写成 `totalSongs`（`PlayerContext.tsx:817`）。
  - 歌单列表只取第 1 页 50 个（`kugouPlaylist.ts:809-810`）。
  - 导入歌单的网关兜底只取 300 首（`:364-365`）。
- **M9 签到日期用 UTC**。`toISOString().split('T')[0]`（`audioSource.ts:313`、`500`）在东八区 0 点到 8 点算作前一天。
- **M10 切音质或地址过期会误跳歌**。切音质时重解析失败走到 `skipBrokenRef`（`PlayerContext.tsx:573-580`、`748-761`）；长暂停后链接过期也是直接跳下一首，不重解析当前曲（`:596-601`、`178-185`）。
- **M11 整棵树高频重渲染**。`timeupdate` 每次 `setCurrentTime`（`:169`），9 个 `usePlayer()` 消费者全部重渲染。
  - 全仓没有 `React.memo`；`SongList` 全量 `.map`、无虚拟化（`SongList.tsx:353`、`541`）。
  - 键盘和 MediaSession 两个 effect 依赖 `currentTime` 和每次渲染都重建的函数，每帧解绑重绑（`PlayerContext.tsx:1017`、`1059`）。
  - 修复方向：把 `currentTime` 拆成独立 store 或 context。
- **M12 存储写放大**。每次切歌把整个队列写盘（`:313-324`，`playAll` 后可达上千首）；每次加删歌重写全部歌单（`:881`、`928`）；`getLocalPlaylists` 每次读取都遍历所有歌曲做历史清洗（`kugouPlaylist.ts:578-582`），这也违反项目「禁止历史兼容」的约定。
- **M13 备轨可能播错歌，并向第三方泄漏听歌数据**。
  - 同名同长匹配只看 ±3s，原曲时长为 0 时任意候选都通过（`audioSource.ts:852-856`）。
  - 向 `api.injahow.cn` 发送歌名和歌手，用关键词充当 `id`，返回地址不做校验直接播放（`:897-911`）。
- **M14 音效链的 AudioContext 可能静音**。它在多个 `await` 之后才创建（`PlayerContext.tsx:559-561`），自动连播时完全没有用户手势，上下文可能停在 suspended；`resume()` 的拒绝未处理。CORS 探测带 `Range` 头，可能触发预检而误判为不支持（`audioEffects.ts:96-102`），且未取消响应体。待真机验证。
- **M15 Android 允许备份明文 token**。`AndroidManifest.xml:8-12` 没有设置 `allowBackup="false"`。

### 低

- **L1 换元素后旧元素不清理**。`swapMediaElement` 对旧元素只 `pause` 加 `removeAttribute`，不 `load()`、不解绑监听（`PlayerContext.tsx:236-237`）；卸载时清理的是首个元素，不是 `audioRef.current`（`:212-213`）。
- **L2 过期请求会清掉新请求的 loading**。`finally` 无条件 `setIsLoadingAudio(false)`（`:581-583`）。
- **L3 随机和上一首的细节**。随机撞到当前曲时取 `+1`，有偏且无洗牌历史（`:610-615`）；随机模式下上一首取的是索引减一（`:656-662`）；当前曲不在队列时上一首落到 `total-2`。
- **L4 MediaSession 动作可能反向**。`play` 和 `pause` 都调 `togglePlay()`，依赖闭包里的 `isPlaying`（`:1044-1045`）。
- **L5 快捷键过滤不全**。不排除 BUTTON 和 SELECT，不判断修饰键和 `e.repeat`（`:951-959`、`992`）；静音时按 ↑ 只改数值不解除静音（`:1004-1006`，`723-729`）。
- **L6 静音不持久化，音量 0 不恢复**（`:251-259`、`284`）。
- **L7 歌词兜底误导**。网络失败也显示「纯音乐，请欣赏」（`lyrics.ts:122-127`）；盲取第一个候选（`:95`）；`atob` 失败后的兜底仍是 `atob`（`:21-23`）。
- **L8 http 层细节**。超时只覆盖到响应头（`http.ts:155`）；非 2xx 不报错（`:207-219`）；不识别 303 和 308（`:165`）；多处 `any`（`:30-32`、`132`、`169`）。
- **L9 明文 HTTP 接口**：`lyrics.ts:74`、`98`；`kugouPlaylist.ts:301`、`393`、`690`；`audioSource.ts:822`。
- **L10 硬编码协议盐值，且跨文件重复**：`audioSource.ts:520`、`524`、`525`、`532`；`kugouPlaylist.ts:14`、`634`；`kugouAuth.ts:11`。硬编码设备 MID：`kugouPlaylist.ts:402`、`device.ts:18`。
- **L11 保活无反馈**。失败只 `console.warn`（`PlayerContext.tsx:463-465`），返回值分不清网络失败和 token 失效（`audioSource.ts:243-246`）。
- **L12 导入输入兜底会抛原生错误**。任意文本被当 URL，`new URL` 直接抛 TypeError（`kugouPlaylist.ts:100`、`461`）。
- **L13 Rust 依赖**。`serde` 和 `serde_json` 未使用（`Cargo.toml:22-23`）；没有 `[profile.release]` 体积优化。
- **L14 标识与注释**。包名 `com.kugou.player` 占用官方命名空间（`tauri.conf.json:5`）；`music.ts:103` 的音效注释与实际预设不符。

## 5. 重复代码与可抽取项

| 重复内容 | 位置 | 建议 |
|---|---|---|
| 平台配置 `GatewayPlatform`、`PLATFORM_*`、`otherPlatform`、`platformOf*` | `audioSource.ts:538-574`；`kugouPlaylist.ts:619-648` | 抽 `services/kugouGateway.ts` |
| MD5 签名四份 | `audioSource.ts:576-588`、`590-595`（未使用）；`kugouPlaylist.ts:57-63`、`654-666`；`kugouAuth.ts:36-40` | 统一 `sign(salt, params, body?)` |
| 网关公共参数、头、Cookie 拼装共 8 处 | `audioSource.ts:123-133`、`200-210`、`327-337`、`652-678`；`kugouPlaylist.ts:792-802`、`949-959`、`1092-1104`、`1189-1199` | `gatewayRequest({path, platform, token, userid, body, extra})` |
| 换平台重试 6 处 | `audioSource.ts:183-185`、`260-262`、`483-488`、`735-740`；`kugouPlaylist.ts:828-835`、`991-999`、`1121-1128`、`1217-1224` | `withPlatformFallback(fn, retryCodes)` |
| Store 加载和读写四套 | `audioSource.ts:38-50`；`kugouPlaylist.ts:40-52`；`device.ts:26-38`；`PlayerContext.tsx:261-282` | `createKvStore(file)`，内含 localStorage 回退和串行写队列 |
| Tauri 环境判断 | `http.ts:27-34` 对比 `audioSource.ts:39`、`kugouPlaylist.ts:41`、`device.ts:27`、`PlayerContext.tsx:264`、`279` | 统一用 `isTauriEnvironment()` |
| 歌单三处落盘 | `kugouPlaylist.ts:550-555`、`593-598`、`606-611` | 前两处改调 `saveAllPlaylistsToStorage` |
| 歌曲字段映射四处 | `kugouPlaylist.ts:328-343`、`410-431`、`720-737`、`918-941` | `toKuGouSong(raw)`；毫秒转秒抽 `normalizeDuration` |
| 搜索接口两处 | `kugouPlaylist.ts:690-716`；`audioSource.ts:822-848` | 备轨复用 `searchKuGouSongs` |
| URL 参数提取 | `kugouPlaylist.ts:189-205`；`460-476` | `parseKuGouShareUrl(url)` |
| 卸载音源三连 | `PlayerContext.tsx:518-523`；`677-682` | `unloadAudio(el)` |
| MediaSession 取对象三次 | `PlayerContext.tsx:1021`、`1035`、`1041` | 抽常量 |
| 加删歌后的状态回写 | `PlayerContext.tsx:868-881`；`915-928` | `commitPlaylist(updated)` |
| 开发代理 13 个 if | `http.ts:39-78` | 映射表；另缺 `mobilecdn`、`gatewayretry`、`kugouvip` |
| `sleep` 内联 6 处 | `audioSource.ts:416`、`425`、`512`；`kugouPlaylist.ts:1023`、`1036` 等 | `utils/sleep.ts` |
| 无实际逻辑的函数 | `trackerUserAgent`（`audioSource.ts:607-610`） | 删除 |

## 6. Android 特有问题

- **后台会被杀**。清单只有 INTERNET 权限（`AndroidManifest.xml:3`），没有 `<service>`、`FOREGROUND_SERVICE_MEDIA_PLAYBACK`、`POST_NOTIFICATIONS`、`WAKE_LOCK`。`MainActivity.kt:6-11` 只有 `enableEdgeToEdge()`。播放完全寄生在 Activity 的 WebView 里，没有前台服务和通知。具体存活时长待真机验证，尤其是提交记录里针对的麒麟 980（EMUI）。
- **后台切歌可能断**。切歌依赖 JS 发网络请求解析地址，后台和 Doze 下定时器与网络受限，容易播完当前首就停。6 小时保活定时器同理。待真机验证。
- **没有通知栏和锁屏控制**。只有 `navigator.mediaSession`（`PlayerContext.tsx:1020-1059`），WebView 不会据此生成媒体通知。待真机验证。
- **音频焦点和拔耳机**。应用层零处理，全靠 WebView 内核默认行为；来电后恢复、拔耳机是否暂停都待真机验证。
- **耳机线控**。只有 WebView 聚焦时的 `keydown` Media* 键（`:963-988`），没有原生 MediaSession 接收按键。后台和锁屏大概率无效，待真机验证。
- **返回键**。JS 和 Kotlin 都没有处理（全仓无 `popstate` 或 `history`，`MainActivity.kt` 无回调）。SPA 没有历史栈，默认行为预期是直接结束 Activity 并停止播放；设置和歌词弹层也无法用返回键关闭。`lib.rs:66-72` 的关窗转隐藏对 Android 无效。待真机验证。
- **安全区**。`enableEdgeToEdge()`（`MainActivity.kt:8`）加 `viewport-fit=cover`（`index.html:6`）。CSS 只有底部 inset（`src/index.css:844`、`1540`、`1861`、`1898`），顶部 inset 仅歌词弹层有（`src/components/MobileLyricsModal.tsx:122`）。主界面顶部可能压在状态栏下；旧版 WebView 的 `env(safe-area-inset-*)` 可能返回 0。待真机验证。
- **明文流量**。清单写死 `usesCleartextTraffic="true"`（`AndroidManifest.xml:12`），`build.gradle.kts:29`、`48` 的占位符未被引用，release 包同样放开。
- **SDK 版本**。`compileSdk` 和 `targetSdk` 都是 37（`src-tauri/gen/android/app/build.gradle.kts:26`、`32`），看起来高于当前稳定版，需确认 CI 的 SDK 和新行为限制。
- **更新**。updater 插件无条件注册（`lib.rs:57`），Android 上 `check()` 抛错后被显示成「检查更新失败」（`updater.ts:60-63`，`UpdateModal.tsx:45-47`），没有 APK 更新路径。
- **FileProvider**。暴露外部存储根和缓存根（`res/xml/file_paths.xml`），未导出，属模板默认，建议收窄。

## 7. 桌面特有问题

- **关闭行为**。所有平台关窗都转为隐藏（`lib.rs:66-72`），没有首次提示，也没有「关闭即退出」选项。真退出只有托盘「退出」（`:40-42`）或 ⌘Q（`:83-85`）。
- **macOS**。没有托盘或菜单栏图标（`lib.rs:24` 排除了 macOS），靠 Dock 重开。Now Playing 和媒体键依赖 WKWebView 的 MediaSession，没有 `setPositionState`。窗口隐藏后 JS 是否被节流、影响自动切歌，待真机验证。`src-tauri/Info.plist:5-8` 放开了 WebView 内任意明文加载。
- **Windows / Linux 托盘**。左键弹菜单（`lib.rs:35`），没有单击或双击恢复窗口的事件；菜单只有显示和退出（`:30-32`）；tooltip 固定，不显示当前曲目（`:36`）。
- **没有单实例**（`lib.rs:55-58`）。隐藏到托盘后再点图标会起第二个进程，两边同时出声，并互相覆盖四个 store 文件。
- **媒体键和全局快捷键**。没有 global-shortcut。窗口失焦或隐藏时 `keydown` 路径失效（`PlayerContext.tsx:948-1017`），只剩 WebView2 的 MediaSession 到 SMTC 映射，待真机验证。
- **窗口**。原生装饰（`tauri.conf.json:20`），不记忆尺寸和位置，没有迷你模式、置顶、桌面歌词窗。最小宽度 380（`:18`）与三栏布局的适配属于 UI 层，未审。
- **更新**。除 H6 外，`relaunch()` 路径会置 `QUITTING`（`lib.rs:83-85`），逻辑正确。`pendingUpdate` 是模块级单例，失败后置空（`updater.ts:111`）。

## 建议修复顺序

1. 先修播放正确性：H1、H3、H4、M1、M2、M3。
2. 再处理鉴权和安全：H2（先抓包确认）、H7、H8、M15。
3. 然后是请求治理和性能：H5、M11、M12。
4. 接着是同步一致性：M6、M7、M8。
5. 最后补平台能力：Android 前台服务与返回键、桌面单实例与窗口状态、H6。