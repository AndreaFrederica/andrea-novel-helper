# 跨平台构建指南

## 概述

本文档描述了 `@anh/enigo-keyboard` 包的跨平台构建系统，包括 Rust 原生模块的编译和 TypeScript 类型生成。

## 构建脚本

### 1. 基础构建脚本

- `scripts/build-ci.js` - CI 专用构建脚本，用于 GitHub Actions
- `scripts/build-cross-platform.js` - 基础跨平台构建脚本
- `scripts/build-cross-enhanced.js` - 增强跨平台构建脚本（推荐）

### 2. 增强跨平台构建脚本功能

`build-cross-enhanced.js` 提供以下功能：

- **多平台支持**：Windows x64、macOS x64/ARM64、Linux x64/ARM64/ARM32
- **Docker 交叉编译**：支持使用 Docker 进行跨平台编译
- **智能平台检测**：自动检测当前平台并选择最佳构建方式
- **详细日志输出**：提供构建过程的详细信息
- **错误处理**：完善的错误处理和回退机制

## 支持的目标平台

| 平台名称 | Rust 目标 | Node.js 平台 | 架构 |
|---------|-----------|-------------|------|
| win32-x64 | x86_64-pc-windows-msvc | win32 | x64 |
| darwin-x64 | x86_64-apple-darwin | darwin | x64 |
| darwin-arm64 | aarch64-apple-darwin | darwin | arm64 |
| linux-x64 | x86_64-unknown-linux-gnu | linux | x64 |
| linux-arm64 | aarch64-unknown-linux-gnu | linux | arm64 |
| linux-armhf | arm-unknown-linux-gnueabihf | linux | arm |

## 使用方法

### 1. 直接使用脚本

```bash
# 构建当前平台
node scripts/build-cross-enhanced.js

# 构建特定平台
node scripts/build-cross-enhanced.js win32-x64

# 使用 Docker 交叉编译
node scripts/build-cross-enhanced.js linux-x64 --docker

# 显示帮助信息
node scripts/build-cross-enhanced.js --help

# 列出所有可用目标
node scripts/build-cross-enhanced.js list
```

### 2. 使用 npm 脚本

```bash
# 构建当前平台
npm run build:cross:enhanced

# 构建特定平台
npm run build:cross:enhanced:target -- win32-x64

# 使用 Docker 交叉编译
npm run build:cross:enhanced -- --docker
```

### 3. 使用 Pixi 任务

```bash
# 构建当前平台
pixi run build_enigo_cross_enhanced

# 构建特定平台
pixi run build_enigo_cross_enhanced_win32
pixi run build_enigo_cross_enhanced_darwin_x64
pixi run build_enigo_cross_enhanced_linux_x64

# 使用 Docker 交叉编译
pixi run build_enigo_cross_docker
pixi run build_enigo_cross_docker_linux_x64
```

### 4. Intel macOS 虚拟机本地打包 darwin-x64

当 GitHub Actions 的 Intel macOS runner 不可用，且没有 Linux 容器环境时，可以在 Intel macOS 虚拟机中直接拉仓库并打包：

```bash
git clone <repo-url>
cd andrea-novel-helper
bash scripts/macos-vm-build.sh
```

脚本会使用 `pixi` 创建/复用本地环境，安装 npm 依赖，构建 webview 与 `@anh/enigo-keyboard` 原生模块，重建 `@vscode/sqlite3` 的 Electron 版本。默认按单版本流程仅输出：

```text
dist/anh-exp-darwin-x64.vsix
```

常用参数：

```bash
# 只打标准版
bash scripts/macos-vm-build.sh --variant std

# 同时打标准版和预发布版
bash scripts/macos-vm-build.sh --variant both

# 指定 VS Code Electron headers 版本
bash scripts/macos-vm-build.sh --electron-version 30.0.9

# 复用已有 node_modules
bash scripts/macos-vm-build.sh --skip-npm-ci
```

首次运行前如果缺少 Xcode Command Line Tools，先执行：

```bash
xcode-select --install
```

## 构建输出

构建成功后，生成的文件位于：

- `dist/<platform>/enigo_keyboard.node` - 原生模块文件
- `dist/index.js` - JavaScript 入口文件
- `dist/index.d.ts` - TypeScript 类型定义文件

## 交叉编译要求

### Windows 交叉编译到 Linux

需要安装 Linux 交叉编译工具链：

```bash
# Windows (使用 MSYS2/MinGW)
pacman -S mingw-w64-x86_64-linux-gnu-gcc

# 或使用 Docker
pixi run build_enigo_cross_docker_linux_x64
```

### macOS 交叉编译

在 macOS 上交叉编译到其他平台：

```bash
# 安装 Rust 目标
rustup target add x86_64-pc-windows-msvc aarch64-apple-darwin

# 构建其他平台
npm run build:cross:enhanced:target -- win32-x64
```

## 故障排除

### 1. 链接器错误

如果遇到 "linker not found" 错误：

- Windows：确保安装了 Microsoft Visual Studio Build Tools
- Linux：安装 `build-essential` 和目标平台的交叉编译工具链
- macOS：安装 Xcode Command Line Tools

### 2. Rust 目标未安装

```bash
# 安装所有目标
rustup target add x86_64-pc-windows-msvc x86_64-apple-darwin aarch64-apple-darwin x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu arm-unknown-linux-gnueabihf
```

### 3. Docker 交叉编译失败

确保 Docker 已安装并正在运行：

```bash
# 检查 Docker 状态
docker --version
docker info
```

## CI/CD 集成

在 GitHub Actions 中使用：

```yaml
- name: Build native module
  run: npm run build:ci
  working-directory: packages/enigo-keyboard
```

## 性能优化

1. **并行构建**：脚本支持并行构建多个平台
2. **缓存利用**：Rust 和 npm 依赖会被缓存
3. **增量构建**：只重新编译变更的部分

## 最佳实践

1. **开发环境**：使用 `npm run build:dev` 进行快速开发构建
2. **生产构建**：使用 `npm run build:cross:enhanced` 进行跨平台生产构建
3. **CI/CD**：使用 `npm run build:ci` 在持续集成中构建
4. **发布前**：运行 `npm run build:cross:enhanced` 确保所有平台都能正常构建

## 相关文件

- `packages/enigo-keyboard/package.json` - 包配置和构建脚本
- `packages/enigo-keyboard/tsconfig.json` - TypeScript 配置
- `packages/enigo-keyboard/Cargo.toml` - Rust 项目配置
- `pixi.toml` - Pixi 任务定义
- `.github/workflows/main.yml` - CI/CD 工作流

## 更新日志

- 2025-12-10: 创建增强跨平台构建脚本，支持 Docker 交叉编译
- 2025-12-09: 添加基础跨平台构建支持
- 2025-12-08: 修复 CI 构建问题，添加 TypeScript 输出配置
