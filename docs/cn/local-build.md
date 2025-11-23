## 🏗️ 本地构建指南（兼容老系统）

- 依赖：Node 20+、npm、VSCE、Pixi
- 安装 VSCE：`npm i -g @vscode/vsce`
- 安装 Pixi：参考 https://prefix.dev/pixi 安装后在项目根运行

### 构建 WebView 与扩展
- 一次性构建：`pixi run build_all`
- 仅 WebView：`pixi run build_web`
- 仅扩展：`pixi run build`

### 打包 VSIX（本机平台）
- 稳定版：`pixi run local_std`
- 预发布：`pixi run local_exp`
- 两者顺序执行：`pixi run local_both`

说明：
- 默认 Electron 版本为 `30.0.9`，可在命令前设置环境变量 `ELECTRON_VERSION` 覆盖
- 本地脚本会自动重建 `@vscode/sqlite3` 原生模块并在打包时调整 `onStartupFinished`
- 打包输出位于 `dist/anh-std-<platform-arch>.vsix` 与 `dist/anh-exp-<platform-arch>.vsix`

### Linux 老系统兼容建议
- 若遇到 glibc 过高导致不兼容，建议在旧版容器中构建（如 Debian buster）：
  - `docker run --rm -v "$PWD":/work -w /work debian:buster bash -lc "apt-get update && apt-get install -y git curl python3 make g++ && npm ci && pixi run local_both"`
- 或使用较新的 VS Code 版本对应的 Electron 版本设置 `ELECTRON_VERSION`
