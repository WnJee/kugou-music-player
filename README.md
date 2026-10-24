# 酷狗无损播放器 (KuGouPlayer)

基于 **Tauri v2 + React + TypeScript** 构建的跨平台酷狗音乐播放器，一套代码同时运行于 **Android / macOS / Windows**。深色毛玻璃风格界面，桌面端三栏布局，移动端自适应并配备专属歌词页。

## ✨ 功能特性

- 🎵 **无损播放** — 接入酷狗音源，支持手动授权（粘贴凭据 JSON 自动解析）
- 📃 **动效歌词** — 逐行滚动歌词，移动端独立歌词页（含播放列表）
- 📂 **歌单管理** — 导入歌单、添加到歌单、本地持久化存储
- 🎨 **毛玻璃 UI** — 深色渐变 + 动态氛围晕光，响应式适配手机 / 平板 / 桌面
- 🔒 **安全区适配** — Android 状态栏安全区预留，与桌面端图标风格统一

## 📥 下载安装

前往 [Releases](https://github.com/WnJee/kugou-music-player/releases) 页面，下载对应平台的最新版本：

| 平台 | 文件 | 说明 |
|------|------|------|
| Android | `KuGouPlayer-v*.*.*-android-arm64.apk` | arm64-v8a（覆盖麒麟980、骁龙、天玑等主流 64 位芯片） |
| Android | `KuGouPlayer-v*.*.*-android-armv7.apk` | 老款 32 位设备 |
| Android | `KuGouPlayer-v*.*.*-android-universal.apk` | 全架构合并包，不确定选哪个就用它 |
| macOS | `KuGouPlayer-v*.*.*-aarch64.dmg` / `-x64.dmg` | Apple Silicon / Intel |
| Windows | `KuGouPlayer-v*.*.*-x64-setup.exe` / `.msi` | 64 位安装包 |

> Android APK 为 **Release 构建**。配置了正式签名 secrets 后为正式签名；未配置时自动回退 Debug 签名（测试分发用），安装时如提示未知来源请允许安装。

## 🛠 技术栈

| 层 | 技术 |
|----|------|
| 桌面/移动壳 | Tauri 2 (Rust) |
| 前端 | React 18 + TypeScript + Vite 6 |
| 样式 | Tailwind CSS 3 |
| 图标 | lucide-react |
| 状态管理 | React Context (PlayerContext) |
| 持久化 | @tauri-apps/plugin-store |
| 网络 | @tauri-apps/plugin-http |

## 📁 项目结构

```
├── src/                    # 前端源码 (React + TS)
│   ├── components/         # UI 组件（播放条、歌词、歌单、设置等）
│   ├── context/            # PlayerContext 播放器全局状态
│   ├── services/           # 酷狗 API、音源、歌词、歌单服务
│   └── types/              # TypeScript 类型定义
├── src-tauri/              # Tauri (Rust) 后端
│   ├── src/                # Rust 入口
│   ├── gen/android/        # Android 工程（已纳入版本管理）
│   └── tauri.conf.json     # Tauri 配置
└── .github/workflows/      # CI/CD 发布流水线
```

## 🚀 本地开发

环境要求：**Node.js ≥ 18**、**Rust**（Android 构建另需 Android SDK/NDK 与 Java 17）。

```bash
# 安装依赖
npm install

# 桌面端开发调试
npm run tauri dev

# 桌面端构建（当前平台）
npm run tauri build

# Android 开发调试
npm run tauri android dev

# Android 构建 APK（Debug 签名，日常测试）
npm run tauri android build -- --apk --debug

# Android 构建 Release APK（正式签名需先配置 keystore，见下方发布流程）
```

## 📦 发布流程

发布完全由 GitHub Actions 自动完成，推送 `v*` 格式的标签即可触发：

```bash
git tag v0.2.0
git push origin v0.2.0
```

流水线（[release.yml](.github/workflows/release.yml)）会自动：

1. 创建 GitHub Release
2. 并行构建 **macOS (universal)**、**Windows (x64)** 安装包并上传
3. 构建 **Android Release APK**（arm64-v8a + armv7）并上传

### Android 正式签名（可选）

流水线默认尝试从仓库 secrets 读取签名密钥，配置后 Release APK 自动正式签名；未配置则回退 Debug 签名。配置步骤：

```bash
# 1. 生成签名密钥（有效期 10000 天以上）
keytool -genkey -v -keystore release.keystore -alias kugou \
  -keyalg RSA -keysize 2048 -validity 10000

# 2. 导出 base64（macOS/Linux）
base64 -i release.keystore | pbcopy        # macOS
base64 -w0 release.keystore                # Linux
# Windows PowerShell:
# [Convert]::ToBase64String([IO.File]::ReadAllBytes("release.keystore")) | Set-Clipboard
```

在仓库 **Settings → Secrets and variables → Actions** 添加四个 secret：

| Secret | 说明 |
|--------|------|
| `ANDROID_KEYSTORE_BASE64` | keystore 文件的 base64 内容 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码（storePassword） |
| `ANDROID_KEY_ALIAS` | 密钥别名（如 `kugou`） |
| `ANDROID_KEY_PASSWORD` | 密钥密码（与 storePassword 相同时可不设） |

> ⚠️ keystore 一旦用于发布必须妥善备份：后续版本必须使用同一 keystore 签名，否则用户无法覆盖安装。

产物统一出现在对应的 Release 页面下。

## 📄 许可证

仅供学习交流使用。
