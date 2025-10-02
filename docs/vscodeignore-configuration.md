# .vscodeignore 配置说明

## 重要提示 ⚠️

本项目有**三个** `.vscodeignore` 配置文件:

1. **`.vscodeignore`** - 主配置文件(当前使用的)
2. **`.vscodeignore.webpack`** - Webpack 模式专用
3. **`.vscodeignore.tsc`** - TypeScript 模式专用

## 前端 SPA 产物必须保留 🎯

**关键配置:**
```gitignore
# 先排除所有 webview 文件
packages/webview/**

# 然后明确保留 SPA 打包产物 (重要!)
!packages/webview/dist/
!packages/webview/dist/spa/
!packages/webview/dist/spa/**
```

### 为什么这样配置?

1. **`packages/webview/**`** - 排除所有 webview 相关文件
2. **`!packages/webview/dist/`** - 保留 dist 目录
3. **`!packages/webview/dist/spa/`** - 保留 spa 子目录
4. **`!packages/webview/dist/spa/**`** - 保留 spa 目录下的所有文件

### SPA 产物包含什么?

前端 Webview 使用 Quasar + Vite 构建,产物在 `packages/webview/dist/spa/`:

```
packages/webview/dist/spa/
├── index.html           # 入口 HTML
├── favicon.ico          # 图标
├── assets/              # 静态资源
│   ├── *.js            # JavaScript bundle
│   ├── *.css           # 样式文件
│   └── *.woff2         # 字体文件
└── icons/              # 应用图标
```

**这些文件对扩展运行是必需的!** 缺少它们会导致 Webview 功能完全无法使用。

## Webpack vs TypeScript 模式的差异

### Webpack 模式 (`.vscodeignore.webpack`)

```gitignore
# 排除 TypeScript 编译产物
out/**

# 排除大部分 node_modules (已被 webpack 打包)
node_modules/**
!node_modules/@vscode/sqlite3/**      # 保留 native 模块
!node_modules/iconv-lite/encodings/** # 保留编码表
```

**优点:** VSIX 体积小 (~10-15 MB)

### TypeScript 模式 (`.vscodeignore.tsc`)

```gitignore
# 排除 Webpack 编译产物  
dist/**

# 保留所有 node_modules (运行时需要)
# node_modules/ 被注释掉,即全部保留
```

**缺点:** VSIX 体积大 (~100+ MB)

## 模式切换时的文件替换

当使用 `pixi run use_webpack` 或 `pixi run use_tsc` 时:

```bash
# Webpack 模式
Copy-Item .vscodeignore.webpack .vscodeignore -Force

# TypeScript 模式
Copy-Item .vscodeignore.tsc .vscodeignore -Force
```

## 验证配置

打包前可以预览将包含哪些文件:

```bash
npx vsce ls --tree
```

**必须确认以下内容存在:**
- ✅ `packages/webview/dist/spa/` 及其所有文件
- ✅ `dist/extension.js` (Webpack) 或 `out/extension.js` (TypeScript)
- ✅ `media/` 目录中的资源文件
- ✅ 必要的 native 模块 (如 `@vscode/sqlite3`)

**不应该包含:**
- ❌ `src/**/*.ts` 源代码
- ❌ `test/` 测试文件
- ❌ `packages/webview/src/` webview 源码
- ❌ `.vscode/` VS Code 配置
- ❌ `*.py` Python 脚本
- ❌ `pixi.toml` / `pixi.lock`

## 常见错误

### 错误 1: SPA 产物被排除

**症状:** 扩展安装后 Webview 显示空白或加载失败

**原因:** `.vscodeignore` 配置错误,排除了 `packages/webview/dist/spa/`

**修复:**
```gitignore
# 错误配置 ❌
packages/webview/**

# 正确配置 ✅
packages/webview/**
!packages/webview/dist/
!packages/webview/dist/spa/
!packages/webview/dist/spa/**
```

### 错误 2: 模式不匹配

**症状:** 打包后文件很大或扩展无法启动

**原因:** `package.json` 的 `main` 字段与 `.vscodeignore` 不匹配

**修复:** 确保切换模式时两个配置同步更新

### 错误 3: Native 模块缺失

**症状:** Webpack 模式下数据库功能失败

**原因:** `@vscode/sqlite3` 等 native 模块被排除

**修复:** 在 `.vscodeignore.webpack` 中添加:
```gitignore
node_modules/**
!node_modules/@vscode/sqlite3/**
```

## 参考

- [VS Code 打包文档](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)
- [.vscodeignore 模式](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#vscodeignore)
