# 代理语言编辑器改进

## 问题描述

原始的代理语言编辑器无法获得语言服务的 hover/completion/definition 等功能，原因是：

1. 大多数语言服务只对 `file:` 或 `untitled:` scheme 生效，而虚拟文档使用 `andrea-proxy:` scheme
2. 虚拟文档 URI 没有文件扩展名，语言服务无法识别文档类型
3. 缺少版本控制，可能导致过期响应被处理

## 解决方案

### 1. 使用真实文件 URI（方案 A - 默认）

将所有语言服务查询的目标从虚拟文档 URI 改为真实文件 URI，确保与原生编辑器体验一致。

### 2. 改进虚拟文档 URI（方案 B - 可选）

为虚拟文档添加文件扩展名，使语言服务能够识别文档类型。

### 3. 添加配置选项

允许用户通过设置选择使用哪种模式。

## 实现的更改

### 1. 核心文件修改

#### `ProxyLanguageEditorProvider.ts`

- 添加 `useRealFileUri` 配置选项
- 修改所有 `execute*Provider` 调用，根据配置选择使用真实文件 URI 或虚拟文档 URI
- 为 completion 添加 `triggerCharacter` 支持
- 添加版本检查，防止过期响应被处理
- 改进虚拟文档 URI 构造，保留原始文件扩展名

#### `proxyLanguageEditorConfig.ts`（新文件）

- 提供配置管理功能
- 封装配置读取和更新逻辑

#### `proxyLanguageEditorCommands.ts`（新文件）

- 注册切换命令
- 提供用户友好的切换界面

### 2. 扩展配置

#### `package.json`

- 添加 `andrea.proxyLanguageEditor.useRealFileUri` 配置项
- 添加 `andrea.proxyLanguageEditor.toggleUseRealFileUri` 命令
- 在编辑器标题栏添加设置按钮

### 3. 测试和文档

#### `test-proxy-language-editor.md`（新文件）

- 提供各种语言服务功能的测试用例
- 包含配置说明和故障排除指南

#### `src/Provider/editor/README.md`（新文件）

- 详细说明代理语言编辑器的功能
- 提供配置选项说明
- 包含技术实现细节

### 4. 集成更新

#### `activate.ts`

- 注册新的命令处理程序
- 修复 ESLint 错误

## 使用方法

### 通过设置切换

1. 打开 VSCode 设置
2. 搜索 `andrea.proxyLanguageEditor.useRealFileUri`
3. 切换开关值

### 通过命令切换

1. 打开命令面板（Ctrl+Shift+P）
2. 搜索"切换代理语言编辑器 URI 模式"
3. 执行命令

### 通过编辑器菜单切换

1. 在代理语言编辑器中
2. 点击标题栏中的设置图标

## 测试建议

1. 使用提供的测试文件验证各种语言服务功能
2. 在两种模式之间切换，比较体验差异
3. 对于不同语言类型（TypeScript、JavaScript、Markdown）重复测试

## 技术细节

### 真实文件 URI 模式

- 所有语言服务查询直接在真实文件上运行
- 确保与原生编辑器完全一致的语言服务体验
- 代价是会直接修改真实文件

### 虚拟文档 URI 模式

- 语言服务查询在虚拟文档上运行
- 虚拟文档保留原始文件的扩展名
- 完全在内存中操作，不修改真实文件
- 可能无法获得某些语言服务支持

## 未来改进

1. 添加更多语言服务支持（如 references、implementations 等）
2. 改进虚拟文档的语言服务兼容性
3. 添加性能优化，减少不必要的语言服务查询
4. 提供更丰富的配置选项，如按语言类型选择不同模式