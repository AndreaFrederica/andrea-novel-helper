# 测试批注功能调试

这是一个测试文件，用于调试批注系统的编辑和回复功能。

## 核心问题修复

**问题原因**：当用户在批注面板中进行编辑或回复操作时，焦点会转移到批注面板，导致 `vscode.window.activeTextEditor` 返回 `null`，从而无法获取当前文档进行保存操作。

**解决方案**：修改后端逻辑，使用批注面板绑定的文档URI (`this.activeDocUri`) 而不是依赖 `activeTextEditor`。

## 测试步骤

1. **重新加载扩展**：按 `Ctrl+Shift+P`，输入 "Developer: Reload Window" 重新加载VSCode窗口以应用修复
2. 打开这个测试文件
3. 选择下面这段文字并添加批注：

   **这是一段用于测试批注功能的文字。请选择这段文字并添加批注，然后测试编辑和回复功能。**

4. 尝试编辑批注内容
5. 尝试回复批注
6. 检查批注内容是否正确保存到文件中

## 预期行为

- ✅ 前端发送 editThread 和 reply 消息
- ✅ 后端接收并处理这些消息（不再显示 "No active editor"）
- ✅ 批注内容被正确更新和保存到磁盘
- ✅ 批注面板实时更新显示新内容

## 调试日志检查

打开开发者控制台（`Help > Toggle Developer Tools`），应该看到：

### 成功的日志序列：
```
[前端] Sending message: {type: 'editThread', id: '...', body: '...'}
[后端] [Controller] Received message: {type: 'editThread', ...}
[后端] [Controller] Processing editThread: {id: '...', body: '...'}
[后端] [Controller] Updating thread with docUuid: ...
[后端] [Controller] Found thread, updating body from: ... to: ...
[后端] [Controller] Updated threadsByDoc for key: ...
[后端] [Controller] editThread processing completed
```

### 如果仍有问题，检查：
- 是否显示 "No active document URI" - 表示面板未正确绑定文档
- 是否显示 "Failed to open document" - 表示文档URI解析失败
- 是否显示 "Thread not found" - 表示批注ID不匹配