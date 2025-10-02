# Andrea Novel Helper - 快速命令参考

## 🚀 开发模式

### TypeScript 模式 (快速开发)
```bash
pixi run use_tsc          # 切换到 TypeScript 模式
pixi run watch            # 启动监视编译
# 然后按 F5 选择 "Run Extension (TypeScript)"
```

### Webpack 模式 (接近生产)
```bash
pixi run use_webpack      # 切换到 Webpack 模式  
pixi run watch_webpack    # 启动监视编译
# 然后按 F5 选择 "Run Extension (Webpack)"
```

## 📦 打包发布

### 推荐方式 (使用 PowerShell 脚本)
```bash
# Webpack 模式打包 (体积小,推荐)
.\package.ps1 -Webpack

# TypeScript 模式打包
.\package.ps1 -TypeScript

# 清理后打包
.\package.ps1 -Webpack -Clean
```

### 使用 Pixi
```bash
pixi run package          # 默认 Webpack 打包
pixi run package_webpack  # Webpack 打包
pixi run package_tsc      # TypeScript 打包
pixi run package_clean    # 清理后打包
```

## 🌐 Webview 开发

```bash
pixi run web_dev          # 开发模式 (热重载)
pixi run build_web        # 生产构建
pixi run server           # 本地预览
```

## 🧹 清理

```bash
pixi run clean            # 清理 out/ 和 dist/
```

## 📊 两种模式对比

| 特性 | TypeScript 模式 | Webpack 模式 |
|------|----------------|--------------|
| 编译速度 | ⚡ 快 | 🐌 慢 |
| VSIX 体积 | 📦 大 (~100MB) | 📦 小 (~10MB) |
| 启动速度 | 🐌 慢 | ⚡ 快 |
| 调试体验 | 👍 好 | 👌 一般 |
| 适用场景 | 开发调试 | 发布部署 |

## ⚠️ 常见问题

### VSIX 文件被锁定
```bash
# 解决方法:
# 1. 关闭所有 VS Code 窗口
# 2. 使用 package.ps1 脚本 (自动处理)
.\package.ps1 -Webpack
```

### 切换模式后扩展无法启动
```bash
# 确保重新编译
pixi run build            # TypeScript
pixi run build_webpack    # Webpack
```

### node_modules 太大
```bash
# 使用 Webpack 模式可以大幅减小体积
pixi run use_webpack
pixi run package_webpack
```

## 📝 发布检查清单

- [ ] 切换到 Webpack 模式: `pixi run use_webpack`
- [ ] 更新版本号 in `package.json`
- [ ] 更新 `CHANGELOG.md`
- [ ] 完整构建: `pixi run build_all_webpack`
- [ ] 打包: `.\package.ps1 -Webpack`
- [ ] 测试 VSIX 安装
- [ ] 发布: `pixi run publish_all`
