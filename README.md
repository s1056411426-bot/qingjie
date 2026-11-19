# 轻截 Qingjie

Windows / macOS 桌面截图工具。以 PixPin 的常用截图流程为参考，独立实现，不包含录屏、GIF 录制或云端 AI 功能。

## 功能

- **截图**：区域框选、全屏、窗口选择、3 秒延时。多显示器分别框选；按真实像素导出，处理 DPI / Retina 缩放。
- **选区**：移动、四角缩放、方向键微调。Enter 编辑，Ctrl/⌘+C 复制，Ctrl/⌘+S 保存，Ctrl/⌘+T 贴图，Esc 取消。
- **标注**：矩形、椭圆、箭头、直线、画笔、荧光笔、文字、序号、马赛克、裁剪；颜色与粗细、撤销重做、缩放预览。
- **贴图**：截图或剪贴板图片 / 纯文字置顶；拖动标题栏移动、滚轮缩放、透明度调节。
- **长截图**：框选内容，手动向下滚动，软件识别重叠区域并自动拼接；完成后继续标注、OCR、复制和导出。
- **OCR**：离线识别简体中文和英文，结果可校正和复制。模型随应用打包，无需首次联网下载。
- **取色**：屏幕像素放大镜、HEX 复制；编辑器内也可取色。
- **历史**：本地缩略图、重新编辑、逐条删除，默认保留 100 条，可设 10–500 条，也可关闭保存。
- **其他**：二维码读取、图片导入 / 粘贴、PNG / JPG 保存、系统托盘、自定义全局快捷键。

## 使用

Windows 10 / 11 x64：运行 `release/Qingjie-0.1.4-win-x64.exe`，无需安装 Node.js。便携程序每次启动会解压运行时，可能需要数秒。也可以解压随附的 Windows ZIP，运行其中的 `轻截.exe`，避免重复解压。

当前是未签名的开发版本，Windows 可能提示未知发布者。完整源码和校验摘要随包提供；功能验收范围见 `docs/验收说明.md`。

macOS：本仓库已包含 Intel x64 和 Apple Silicon arm64 的 DMG / ZIP 构建配置。**当前 Windows 环境不能完成 macOS 打包；Mac 二进制及实机验收尚未完成。** 在 Mac 执行下面的构建命令，或将本项目作为仓库根目录上传至你自己的 GitHub 仓库，在 Actions 运行 `Desktop builds`。生成的包仍须在 Mac 实测。

Mac 第一次截图需在系统设置 → 隐私与安全性 → 屏幕与系统音频录制中授权轻截，随后重启。系统权限名称包含“录制”，应用只用其获取静态截图。当前开发构建未配置 Apple Developer ID 签名和公证；正式面向其他 Mac 用户分发前，应在 Mac 上完成签名、公证及实机测试。

| 操作 | Windows | macOS |
| --- | --- | --- |
| 区域截图 | Ctrl+Shift+A | ⌘+Shift+A |
| 剪贴板贴图 | Ctrl+Shift+P | ⌘+Shift+P |
| 完成长截图 | Ctrl+Shift+L | ⌘+Shift+L |
| 复制图片 | Ctrl+C | ⌘+C |
| 保存图片 | Ctrl+S | ⌘+S |
| 撤销 / 重做 | Ctrl+Z / Ctrl+Shift+Z | ⌘+Z / ⌘+Shift+Z |

长截图请只框选会滚动的区域，避开固定标题、导航栏和输入框；每次向下滚动不超过半屏，稍停约一秒。识别失败时返回上次成功位置再慢慢向下滚动。选区过大导致工具栏无处放置时，使用完成快捷键。当前上限为高度 24,000 像素或总计 6,000 万像素。

## 开发和打包

推荐 Node.js 22 或更新版本。

```sh
npm ci --include=dev
npm run assets
npm start
npm test
npm run test:app
```

```sh
# 在 Windows 上
npm run dist:win
# 在 macOS 上
npm run dist:mac
```

`assets` 从固定版本的 npm 模型包复制识别模型，不依赖外部模型 CDN。首次安装依赖需要联网。`test:app` 会运行真实桌面应用，使用项目下的独立测试数据目录；请在可交互的桌面会话运行。`node scripts/scroll-smoke.cjs` 验证实际屏幕滚动拼接。

应用 Logo 原图保存在 `assets/logo-source.png`。`npm run assets` 会基于原图生成透明 PNG 及多尺寸 Windows ICO；源码压缩包包含该原图，重新构建会保留此 Logo。

CI 配置位于 `.github/workflows/build.yml`。默认只生成未签名的构建产物，不会发布到公共下载页。正式分发需自行配置代码签名证书及 macOS 公证凭据。

## 数据与实现

- 数据目录由 Electron `app.getPath('userData')` 决定，通常为 Windows `%APPDATA%/轻截` 或 macOS `~/Library/Application Support/轻截`。
- 截图历史是本地 PNG 和缩略图，不加密；可在设置中关闭新历史保存。删除记录同时删除对应图片和缩略图。
- Electron 45；沙箱渲染进程、contextIsolation、受限 IPC、内容安全策略、禁用远程导航及网络资源加载。
- 主进程使用 `desktopCapturer` 获取静态图像，不采集音频或媒体流。Tesseract.js 在线程内离线识别。截图数据不发往服务器。
- 长截图基于像素重叠匹配，对重复图案、低纹理、动态内容或无重叠画面会拒绝拼接，避免静默损坏。没有原生辅助功能驱动的自动滚动。

## 当前边界

这是可运行的 0.1 开发版本，不是完整 PixPin 替代品。当前不含窗口内部元素智能吸附、自由形状 / 多边形截图、跨屏单一选区、横向拼接、自动驱动页面滚动、HDR 色彩校正、富文本贴图、翻译、表格 / 公式识别。窗口截图由系统缩略图 API 提供，部分受保护窗口可能无法捕获。

Windows 已有本地自动化验证；多显示器混合 DPI 和 Mac Retina 权限流程需要对应设备实测。OCR 可能漏字或误识别，尤其是低对比、倾斜、小字号或复杂版面。

第三方代码和模型遵循各自许可证，见 `THIRD_PARTY_NOTICES.md`。
