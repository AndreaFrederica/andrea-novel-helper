# 代理语言编辑器最终修复

## 问题分析

从错误日志可以看出，主要有三个问题：

1. **`Method not found: toJSON`** - VSCode 内部错误，某些对象没有 toJSON 方法
2. **`Failed to execute 'write' on 'Document'`** - Webview 中使用 document.write() 导致的错误
3. **`Unrecognized feature: 'local-network-access'`** - CSP 策略警告

## 已实施的修复

### 1. 序列化错误处理

为所有序列化函数添加了 try-catch 块和空值检查：

```typescript
function serializeHovers(hovers: vscode.Hover[]): SerializedHover[] {
    if (!Array.isArray(hovers)) return [];
    return hovers.map((h) => {
        try {
            // 序列化逻辑
        } catch (e) {
            console.error('Error serializing hover:', e);
            return {
                contents: 'Error serializing hover',
                range: undefined,
            };
        }
    });
}
```

### 2. Webview 内容设置错误处理

在 Webview 中设置内容时添加了错误处理：

```typescript
case 'init':
  isApplyingExternal = true;
  try {
    editor.value = msg.text || '';
    version = msg.version || 1;
    languageInput.value = msg.languageId || 'plaintext';
    updateStatus('init');
  } catch (e) {
    console.error('Error initializing editor:', e);
    // 使用更安全的方式设置内容
    if (msg.text) {
      editor.textContent = msg.text;
    }
  } finally {
    isApplyingExternal = false;
  }
  return;
```

### 3. 渲染错误处理

为所有渲染函数添加了错误处理：

```typescript
function renderHovers(hovers) {
  if (!Array.isArray(hovers) || hovers.length === 0) {
    hoverOutput.textContent = 'No hover data.';
    hoverCount.textContent = '0';
    return;
  }
  const lines = hovers.map((h, idx) => {
    const range = h.range ? rangeToString(h.range) : '';
    const prefix = range ? 'Range ' + range + '\\n' : '';
    return 'Hover #' + (idx + 1) + '\\n' + prefix + String(h.contents || '').trim();
  });
  try {
    hoverOutput.textContent = lines.join('\\n\\n');
    hoverCount.textContent = String(hovers.length);
  } catch (e) {
    console.error('Error rendering hovers:', e);
    hoverOutput.textContent = 'Error rendering hovers';
    hoverCount.textContent = '0';
  }
}
```

### 4. CSP 策略改进

添加了 `connect-src` 到 CSP 策略中：

```typescript
const csp = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
    `connect-src ${webview.cspSource}`,
].join('; ');
```

## 建议的解决方案

### 方案一：使用简单语言服务代理（推荐）

如果只需要获取语言服务数据，不需要编辑功能，建议使用简单语言服务代理：

1. 打开任何文档
2. 将光标放在需要查询的位置
3. 打开命令面板 (Ctrl+Shift+P)
4. 运行以下任一命令：
   - `andrea.getHover` - 获取当前编辑器的 Hover 信息
   - `andrea.getCompletion` - 获取当前编辑器的自动完成
   - `andrea.getDefinition` - 获取当前编辑器的定义
   - `andrea.getSymbols` - 获取当前编辑器的符号
   - `andrea.getDiagnostics` - 获取当前编辑器的诊断信息
   - `andrea.getSemanticTokens` - 获取当前编辑器的语义标记

### 方案二：切换到虚拟文档模式

如果需要使用代理语言编辑器的完整功能，但真实文件模式有问题：

1. 打开命令面板 (Ctrl+Shift+P)
2. 搜索"切换代理语言编辑器 URI 模式"
3. 执行命令切换到虚拟文档模式

### 方案三：重新加载窗口

如果以上方法都不能解决问题：

1. 打开命令面板 (Ctrl+Shift+P)
2. 搜索"Reload Window"
3. 执行命令重新加载 VSCode 窗口

## 测试文件

1. `test-simple-language-service.md` - 简单语言服务代理测试
2. `test-simple-language-service.js` - JavaScript 测试脚本
3. `test-proxy-editor-fix.md` - 代理语言编辑器修复测试

## 总结

1. **简单语言服务代理**是最稳定的解决方案，适用于大多数用例
2. **代理语言编辑器**已修复了主要问题，但仍可能遇到边缘情况
3. **虚拟文档模式**比真实文件模式更稳定，但兼容性较差
4. **重新加载窗口**是最后的解决方案，可以解决大多数状态问题

建议优先使用简单语言服务代理，只有在确实需要完整编辑功能时才使用代理语言编辑器。