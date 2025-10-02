# 开发与构建指南

本项目支持两种编译模式:

## 1. TypeScript 模式
直接使用 TypeScript 编译器编译,输出到 `out/` 目录。

**优点:**
- 编译速度快
- 保留完整的 node_modules 依赖
- 调试时源码映射更准确
- 适合开发调试

**缺点:**
- 打包体积大(需要包含所有 node_modules)
- 启动稍慢

**使用方法:**
```bash
# 切换到 TypeScript 模式
pixi run use_tsc

# 编译
pixi run build

# 监视模式
pixi run watch

# 打包 VSIX
pixi run package_tsc
```

**调试配置:** 使用 `Run Extension (TypeScript)` 启动配置

---

## 2. Webpack 模式
使用 Webpack 打包所有代码到单个文件,输出到 `dist/` 目录。

**优点:**
- 打包体积小
- 启动速度快
- 适合发布到市场

**缺点:**
- 编译时间较长
- 某些 native 模块需要特殊处理

**使用方法:**
```bash
# 切换到 Webpack 模式
pixi run use_webpack

# 编译(生产环境)
pixi run build_webpack

# 编译(开发环境)
pixi run build_webpack_dev

# 监视模式
pixi run watch_webpack

# 打包 VSIX (推荐用于发布)
pixi run package_webpack
# 或直接使用
pixi run package
```

**调试配置:** 使用 `Run Extension (Webpack)` 启动配置

---

## 完整工作流

### 开发阶段
```bash
# 1. 切换到 TypeScript 模式(开发更快)
pixi run use_tsc

# 2. 启动 webview 开发服务器
pixi run web_dev

# 3. 在另一个终端启动扩展监视编译
pixi run watch

# 4. 在 VS Code 中按 F5,选择 "Run Extension (TypeScript)"
```

### 发布前
```bash
# 1. 切换到 Webpack 模式
pixi run use_webpack

# 2. 完整编译(包括 webview)
pixi run build_all_webpack

# 3. 打包 VSIX
pixi run package

# 4. 发布
pixi run publish_all
```

---

## 其他命令

```bash
# 清理编译产物
pixi run clean

# 只编译 webview
pixi run build_web

# 启动静态服务器测试 webview
pixi run server
```

---

## 注意事项

1. **切换模式后需要重新编译**: 使用 `use_webpack` 或 `use_tsc` 后,需要运行相应的 build 命令

2. **调试配置要匹配**: 确保使用的调试配置与当前编译模式匹配

3. **前端 SPA 产物必须保留**: 
   - `packages/webview/dist/spa/` 目录包含 Webview 的前端资源
   - 这些文件对扩展运行是必需的!
   - 所有 `.vscodeignore` 配置都已正确保留此目录
   - 验证: 运行 `npx vsce ls --tree` 应该能看到 `packages/webview/dist/spa/` 及其文件

4. **VSIX 文件被锁定错误**: 
   - 关闭所有打开扩展的 VS Code 窗口
   - 或使用 `.\package.ps1` 脚本(自动处理删除)
   - 或手动删除旧的 `.vsix` 文件后重试

5. **node_modules 优化**: Webpack 模式会大幅减少 VSIX 体积,但某些 native 模块仍需保留:
   - `@vscode/sqlite3` - 数据库支持
   - `iconv-lite/encodings` - 字符编码

6. **首次切换**: 第一次切换模式时,建议先运行 `pixi run clean` 清理旧的编译产物

7. **打包前检查**: 使用 `npx vsce ls` 查看将包含的文件数量和大小
