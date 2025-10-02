# 配置更新总结

## ✅ 已完成的改动

本次更新实现了对 **TypeScript** 和 **Webpack** 两种编译模式的完整支持。

### 📄 修改的文件

#### 1. **package.json**
- ✅ 添加了 `use:webpack` 和 `use:tsc` 脚本用于切换入口点
- ✅ 保留了所有现有的编译脚本

#### 2. **.vscode/launch.json**
- ✅ 添加了 `Run Extension (TypeScript)` 调试配置
- ✅ 添加了 `Run Extension (Webpack)` 调试配置
- ✅ 添加了 `Extension Tests (TypeScript)` 配置
- ✅ 保留了原有的 C/C++ 调试配置

#### 3. **.vscodeignore**
- ✅ 优化了主配置文件
- ✅ **重要: 正确保留了 `packages/webview/dist/spa/` 产物**
- ✅ 添加了更详细的注释

#### 4. **新建文件**

**配置文件:**
- ✅ `.vscodeignore.webpack` - Webpack 模式专用配置
- ✅ `.vscodeignore.tsc` - TypeScript 模式专用配置

**PowerShell 脚本:**
- ✅ `switch-to-webpack.ps1` - 切换到 Webpack 模式
- ✅ `switch-to-tsc.ps1` - 切换到 TypeScript 模式
- ✅ `package.ps1` - 智能打包脚本(自动处理 VSIX 锁定问题)

**文档:**
- ✅ `BUILD_GUIDE.md` - 详细的构建指南
- ✅ `QUICK_REFERENCE.md` - 快速命令参考
- ✅ `docs/vscodeignore-configuration.md` - .vscodeignore 配置说明

#### 5. **pixi.toml**
- ✅ 添加了完整的任务配置
- ✅ 支持两种编译模式
- ✅ 添加了模式切换命令
- ✅ 添加了清理命令

---

## 🎯 核心功能

### 模式切换
```bash
# 方式 1: 使用 pixi
pixi run use_webpack    # 切换到 Webpack
pixi run use_tsc        # 切换到 TypeScript

# 方式 2: 使用 PowerShell 脚本
.\switch-to-webpack.ps1
.\switch-to-tsc.ps1
```

### 编译
```bash
# TypeScript 模式
pixi run build          # 编译一次
pixi run watch          # 监视编译

# Webpack 模式
pixi run build_webpack      # 生产编译
pixi run build_webpack_dev  # 开发编译
pixi run watch_webpack      # 监视编译
```

### 打包 (推荐方式)
```bash
# 使用智能打包脚本 (自动处理 VSIX 锁定)
.\package.ps1 -Webpack      # Webpack 模式
.\package.ps1 -TypeScript   # TypeScript 模式
.\package.ps1 -Webpack -Clean  # 清理后打包

# 使用 pixi
pixi run package            # 默认 Webpack
pixi run package_webpack    # Webpack 模式
pixi run package_tsc        # TypeScript 模式
pixi run package_clean      # 清理后打包
```

---

## 🔧 关键配置说明

### 1. 前端 SPA 产物保留 ⚠️

**所有** `.vscodeignore` 文件都包含以下配置:

```gitignore
packages/webview/**
!packages/webview/dist/
!packages/webview/dist/spa/
!packages/webview/dist/spa/**
```

这确保了 Quasar 构建的前端资源被包含在 VSIX 中。

### 2. 入口点切换

- **Webpack 模式**: `"main": "./dist/extension.js"`
- **TypeScript 模式**: `"main": "./out/extension.js"`

切换脚本会自动修改 `package.json` 的 `main` 字段。

### 3. 调试配置

- **TypeScript**: 使用 `out/**/*.js` 作为 outFiles
- **Webpack**: 使用 `dist/**/*.js` 作为 outFiles

按 F5 时选择对应的配置。

---

## 📊 两种模式对比

| 特性 | TypeScript | Webpack |
|------|-----------|---------|
| 编译速度 | ⚡ 快 (5-10秒) | 🐌 慢 (30-60秒) |
| VSIX 体积 | 📦 大 (~100MB) | 📦 小 (~10MB) |
| 启动速度 | 🐌 慢 | ⚡ 快 |
| 调试体验 | 👍 优秀 | 👌 良好 |
| 适用场景 | 🛠️ 开发调试 | 🚀 发布部署 |
| node_modules | ✅ 全部包含 | ⚡ 仅 native 模块 |

---

## 🚀 推荐工作流

### 日常开发
```bash
# 1. 切换到 TypeScript 模式
pixi run use_tsc

# 2. 启动监视编译
pixi run watch

# 3. 在 VS Code 中按 F5,选择 "Run Extension (TypeScript)"
```

### 发布前测试
```bash
# 1. 切换到 Webpack 模式
pixi run use_webpack

# 2. 完整编译
pixi run build_all_webpack

# 3. 打包测试
.\package.ps1 -Webpack

# 4. 安装 VSIX 测试
code --install-extension andrea-novel-helper-*.vsix
```

### 正式发布
```bash
# 1. 确保在 Webpack 模式
pixi run use_webpack

# 2. 清理并打包
.\package.ps1 -Webpack -Clean

# 3. 验证文件
npx vsce ls --tree

# 4. 发布
pixi run publish_all
```

---

## ❓ 常见问题解决

### Q: VSIX 文件被锁定无法删除?
**A:** 使用 `.\package.ps1` 脚本,它会自动重试删除旧文件

### Q: 切换模式后扩展无法启动?
**A:** 确保重新编译: `pixi run build` 或 `pixi run build_webpack`

### Q: Webview 显示空白?
**A:** 检查 `packages/webview/dist/spa/` 是否存在并被包含

### Q: 如何减小 VSIX 体积?
**A:** 使用 Webpack 模式,体积从 ~100MB 减少到 ~10MB

### Q: 如何验证打包内容?
**A:** 运行 `npx vsce ls --tree` 查看详细文件列表

---

## 📚 参考文档

- `BUILD_GUIDE.md` - 完整构建指南
- `QUICK_REFERENCE.md` - 快速命令参考  
- `docs/vscodeignore-configuration.md` - .vscodeignore 配置详解

---

## ✨ 下一步

1. **测试两种模式**: 分别测试 TypeScript 和 Webpack 模式的编译和运行
2. **验证 VSIX**: 确保打包后的 VSIX 包含所有必要文件
3. **更新 CI/CD**: 如果有持续集成,更新构建脚本使用 Webpack 模式
4. **文档更新**: 在 README 中添加开发和发布说明的链接

---

**配置更新完成!** 🎉

现在可以灵活地在两种编译模式之间切换,开发时使用 TypeScript 模式获得快速编译,发布时使用 Webpack 模式获得小体积的 VSIX 包。
