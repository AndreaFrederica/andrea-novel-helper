# Typo LLM 深度思考模型支持

## 概述

Andrea Novel Helper 0.4.7 版本新增了对带思考过程（Reasoning）的深度思考模型的支持，如 GLM-4.6、GLM-4.5、GLM-4.5-air、DeepSeek-R1 等。

## 功能特性

### 1. 思考过程输出
当启用 `enableThinking` 选项后，支持推理的模型会在生成最终回复前输出其思考过程（reasoning_content），这些思考过程会在调试日志中显示，帮助用户了解模型的推理逻辑。

### 2. 兼容性
- ✅ 兼容支持 `reasoning_content` 的模型（如 GLM-4.6、GLM-4.5、GLM-4.5-air、DeepSeek-R1 等）
- ✅ 向后兼容普通模型（不启用 enableThinking 时行为不变）
- ✅ 自动检测和处理思考过程与正式回复的切换

## 配置说明

### 基本配置

在 VS Code 设置中配置以下选项：

```json
{
  "AndreaNovelHelper.typo.clientLLM.enabled": true,
  "AndreaNovelHelper.typo.clientLLM.apiBase": "https://dashscope.aliyuncloud.com/compatible-mode/v1",
  "AndreaNovelHelper.typo.clientLLM.apiKey": "your-api-key",
  "AndreaNovelHelper.typo.clientLLM.model": "glm-4.6",
  "AndreaNovelHelper.typo.clientLLM.temperature": 0,
  "AndreaNovelHelper.typo.clientLLM.enableThinking": true,
  "AndreaNovelHelper.typo.clientLLM.thinkingProvider": "auto"
}
```

### 配置项说明

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `enabled` | boolean | false | 启用客户端 LLM |
| `apiBase` | string | "https://api.deepseek.com/v1" | API 基础地址 |
| `apiKey` | string | "" | API 密钥 |
| `model` | string | "deepseek-v3" | 模型名称 |
| `temperature` | number | 0 | 温度参数 (0-2) |
| `enableThinking` | boolean | false | 启用思考过程 |
| `thinkingProvider` | string | "auto" | thinking 参数格式预设 |
| `customThinkingEnabled` | boolean | false | 启用自定义 thinking 字段 |
| `customThinkingEnabledValue` | boolean | true | 自定义 thinking 启用值 |
| `customThinkingDisabledValue` | boolean | false | 自定义 thinking 禁用值 |
| `qwenThinkingMethod` | string | "parameter" | Qwen 模型 thinking 控制方法 |
| `geminiThinkingBudget` | number | -1 | Gemini 模型思考预算 |

### 调试选项

```json
{
  "AndreaNovelHelper.typo.debug.llmTrace": true
}
```

启用后会在输出面板中显示：
- 思考过程（reasoning_content）
- 完整回复（content）
- 请求参数和响应统计

## 使用示例

### 示例 1: 使用阿里云百炼 API + GLM-4.6

```json
{
  "AndreaNovelHelper.typo.clientLLM.enabled": true,
  "AndreaNovelHelper.typo.clientLLM.apiBase": "https://dashscope.aliyuncloud.com/compatible-mode/v1",
  "AndreaNovelHelper.typo.clientLLM.apiKey": "sk-xxx",
  "AndreaNovelHelper.typo.clientLLM.model": "glm-4.6",
  "AndreaNovelHelper.typo.clientLLM.enableThinking": true,
  "AndreaNovelHelper.typo.debug.llmTrace": true
}
```

### 示例 2: 使用 GLM-4.5-air

```json
{
  "AndreaNovelHelper.typo.clientLLM.enabled": true,
  "AndreaNovelHelper.typo.clientLLM.apiBase": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  "AndreaNovelHelper.typo.clientLLM.apiKey": "your-api-key",
  "AndreaNovelHelper.typo.clientLLM.model": "glm-4.5-air",
  "AndreaNovelHelper.typo.clientLLM.enableThinking": true,
  "AndreaNovelHelper.typo.debug.llmTrace": true
}
```

### 示例 3: 使用 DeepSeek API + 指定供应商预设

```json
{
  "AndreaNovelHelper.typo.clientLLM.enabled": true,
  "AndreaNovelHelper.typo.clientLLM.apiBase": "https://api.deepseek.com/v1",
  "AndreaNovelHelper.typo.clientLLM.apiKey": "your-api-key",
  "AndreaNovelHelper.typo.clientLLM.model": "deepseek-r1",
  "AndreaNovelHelper.typo.clientLLM.enableThinking": true,
  "AndreaNovelHelper.typo.clientLLM.thinkingProvider": "deepseek"
}
```

### 示例 4: 禁用 thinking 功能

```json
{
  "AndreaNovelHelper.typo.clientLLM.enabled": true,
  "AndreaNovelHelper.typo.clientLLM.apiBase": "https://open.bigmodel.cn/api/paas/v4/chat/completions",
  "AndreaNovelHelper.typo.clientLLM.apiKey": "your-api-key",
  "AndreaNovelHelper.typo.clientLLM.model": "glm-4.6",
  "AndreaNovelHelper.typo.clientLLM.enableThinking": false,
  "AndreaNovelHelper.typo.clientLLM.thinkingProvider": "glm"
}
```

### 示例 5: 使用 Qwen3 + 参数法控制 thinking

```json
{
  "AndreaNovelHelper.typo.clientLLM.enabled": true,
  "AndreaNovelHelper.typo.clientLLM.apiBase": "https://your-qwen-api.com/v1",
  "AndreaNovelHelper.typo.clientLLM.apiKey": "your-api-key",
  "AndreaNovelHelper.typo.clientLLM.model": "qwen2.5-72b-instruct",
  "AndreaNovelHelper.typo.clientLLM.enableThinking": true,
  "AndreaNovelHelper.typo.clientLLM.thinkingProvider": "qwen",
  "AndreaNovelHelper.typo.clientLLM.qwenThinkingMethod": "parameter"
}
```

### 示例 6: 使用 Qwen3 + 后缀法控制 thinking

```json
{
  "AndreaNovelHelper.typo.clientLLM.enabled": true,
  "AndreaNovelHelper.typo.clientLLM.apiBase": "https://your-qwen-api.com/v1",
  "AndreaNovelHelper.typo.clientLLM.apiKey": "your-api-key",
  "AndreaNovelHelper.typo.clientLLM.model": "qwen2.5-72b-instruct",
  "AndreaNovelHelper.typo.clientLLM.enableThinking": false,
  "AndreaNovelHelper.typo.clientLLM.thinkingProvider": "qwen",
  "AndreaNovelHelper.typo.clientLLM.qwenThinkingMethod": "suffix"
}
```

### 示例 7: 使用 Gemini 2.5 Pro + 动态思考

```json
{
  "AndreaNovelHelper.typo.clientLLM.enabled": true,
  "AndreaNovelHelper.typo.clientLLM.apiBase": "https://generativelanguage.googleapis.com/v1beta",
  "AndreaNovelHelper.typo.clientLLM.apiKey": "your-api-key",
  "AndreaNovelHelper.typo.clientLLM.model": "gemini-2.5-pro",
  "AndreaNovelHelper.typo.clientLLM.enableThinking": true,
  "AndreaNovelHelper.typo.clientLLM.thinkingProvider": "gemini",
  "AndreaNovelHelper.typo.clientLLM.geminiThinkingBudget": -1,
  "AndreaNovelHelper.typo.debug.llmTrace": true
}
```

### 示例 8: 使用 Gemini 2.5 Flash + 指定思考预算

```json
{
  "AndreaNovelHelper.typo.clientLLM.enabled": true,
  "AndreaNovelHelper.typo.clientLLM.apiBase": "https://generativelanguage.googleapis.com/v1beta",
  "AndreaNovelHelper.typo.clientLLM.apiKey": "your-api-key",
  "AndreaNovelHelper.typo.clientLLM.model": "gemini-2.5-flash",
  "AndreaNovelHelper.typo.clientLLM.enableThinking": true,
  "AndreaNovelHelper.typo.clientLLM.thinkingProvider": "gemini",
  "AndreaNovelHelper.typo.clientLLM.geminiThinkingBudget": 1024,
  "AndreaNovelHelper.typo.debug.llmTrace": true
}
```

### 示例 9: 使用自定义 thinking 配置

```json
{
  "AndreaNovelHelper.typo.clientLLM.enabled": true,
  "AndreaNovelHelper.typo.clientLLM.apiBase": "https://your-custom-api.com/v1",
  "AndreaNovelHelper.typo.clientLLM.apiKey": "your-api-key",
  "AndreaNovelHelper.typo.clientLLM.model": "your-custom-model",
  "AndreaNovelHelper.typo.clientLLM.enableThinking": true,
  "AndreaNovelHelper.typo.clientLLM.thinkingProvider": "custom",
  "AndreaNovelHelper.typo.clientLLM.customThinkingEnabled": true,
  "AndreaNovelHelper.typo.clientLLM.customThinkingEnabledValue": true,
  "AndreaNovelHelper.typo.clientLLM.customThinkingDisabledValue": false
}
```

## 日志输出示例

启用 `llmTrace` 后，输出面板会显示：

```
==> [ClientLLM] POST https://dashscope.aliyuncloud.com/compatible-mode/v1/chat/completions
model=glm-4.6 temp=0 thinking=true docUuid=xxx texts=5 ctxLen=1234
system: 你是一个中文错别字纠正助手...
user: {"instruction":"严格输出 JSON 对象..."...}

====================思考过程====================
首先分析文本中的潜在错误...
检查标点符号使用...
对比上下文语义...
====================完整回复====================
{"corrections":[...]}

<== [ClientLLM] stream done, total=567
```

## 技术实现

### 供应商预设系统

新的 thinking 配置系统支持以下供应商预设：

#### Auto (自动检测)
- 根据模型名称自动选择合适的参数格式
- GLM-4.x → `thinking` 参数
- DeepSeek-x → `extra_body.enable_thinking` 参数
- Qwen-x → `extra_body.enable_thinking` 参数（使用参数法）
- Gemini-x → `extra_body.thinking_config` 参数

#### GLM 预设
```json
// 启用
{
  "thinking": { "type": "enabled" }
}

// 禁用
{
  "thinking": { "type": "disabled" }
}
```

#### DeepSeek 预设
```json
// 启用
{
  "extra_body": { "enable_thinking": true }
}

// 禁用
{
  // 删除整个 extra_body 参数
}
```

#### Qwen 预设
支持两种控制 thinking 的方法：

##### 方法 1：参数法（默认，`qwenThinkingMethod: "parameter"`）
```json
// 启用 thinking
{
  "extra_body": { "enable_thinking": true }
}

// 禁用 thinking
{
  "extra_body": { "enable_thinking": false }
}
```

##### 方法 2：后缀法（`qwenThinkingMethod: "suffix"`）
```json
// 启用 thinking（使用原始模型名称）
{
  "model": "qwen2.5-72b-instruct"
}

// 禁用 thinking（添加 /no_think 后缀）
{
  "model": "qwen2.5-72b-instruct/no_think"
}
```

##### 配置示例
```json
{
  "AndreaNovelHelper.typo.clientLLM.thinkingProvider": "qwen",
  "AndreaNovelHelper.typo.clientLLM.qwenThinkingMethod": "parameter"
}
```

#### Gemini 预设
Google Gemini 2.5 系列模型使用 `thinking_config` 参数控制思考功能，支持思考预算设置：

```json
// 启用 thinking（动态思考）
{
  "extra_body": {
    "thinking_config": {
      "thinking_budget": -1,
      "include_thoughts": true
    }
  }
}

// 启用 thinking（指定预算）
{
  "extra_body": {
    "thinking_config": {
      "thinking_budget": 1024,
      "include_thoughts": true
    }
  }
}

// 禁用 thinking
{
  "extra_body": {
    "thinking_config": {
      "thinking_budget": 0,
      "include_thoughts": false
    }
  }
}
```

##### 思考预算配置选项

| 模型 | 默认设置 | 范围 | 禁用思考 | 动态思考 |
|------|----------|------|----------|----------|
| **Gemini 2.5 Pro** | 动态思考 | 128-32768 | 不支持 | `thinking_budget = -1` |
| **Gemini 2.5 Flash** | 动态思考 | 0-24576 | `thinking_budget = 0` | `thinking_budget = -1` |
| **Gemini 2.5 Flash-Lite** | 无思考 | 512-24576 | `thinking_budget = 0` | `thinking_budget = -1` |

##### 配置示例
```json
{
  "AndreaNovelHelper.typo.clientLLM.thinkingProvider": "gemini",
  "AndreaNovelHelper.typo.clientLLM.geminiThinkingBudget": 1024
}
```

#### 自定义预设
用户可以自定义 thinking 字段和值：
```json
// 配置示例
{
  "thinkingProvider": "custom",
  "customThinkingEnabled": true,
  "customThinkingEnabledValue": true,
  "customThinkingDisabledValue": false
}

// 生成的请求
// 启用时: { "thinking": true }
// 禁用时: { "thinking": false }
```

### 流式响应处理

系统会自动区分两种内容：
1. **思考过程** (`delta.reasoning_content`): 仅在日志中输出，不影响最终结果
2. **正式回复** (`delta.content`): 用于错别字检测的实际内容

### 状态机

```
初始状态 -> 思考阶段 (reasoning_content) -> 回复阶段 (content) -> 完成
```

## 注意事项

⚠️ **重要提示**：
1. `enableThinking` 选项仅对支持 `reasoning_content` 的模型有效
2. 普通模型启用此选项可能导致请求失败或无响应
3. 思考过程会增加 token 消耗和响应时间
4. 建议仅在需要深度推理的场景下启用

## 支持的模型

已知支持思考过程的模型：
- ✅ GLM-4.5 (阿里云百炼)
- ✅ DeepSeek-R1
- ✅ Google Gemini 2.5 Pro (支持动态思考)
- ✅ Google Gemini 2.5 Flash (支持动态思考和禁用)
- ✅ Google Gemini 2.5 Flash-Lite (可指定预算)
- ✅ 通义千问 Qwen3 系列 (支持参数法和后缀法)
- ✅ 其他兼容 OpenAI API 且支持 reasoning_content 的模型

## 故障排除

### 问题：启用 enableThinking 后无响应

**解决方案**：
1. 检查模型是否支持 `reasoning_content`
2. 关闭 `enableThinking` 选项
3. 查看输出面板的错误信息

### 问题：思考过程不显示

**解决方案**：
1. 确保 `enableThinking` 已启用
2. 启用 `typo.debug.llmTrace` 调试选项
3. 检查模型 API 是否返回 `reasoning_content` 字段

## 更新日志

### v0.4.7+
- ✨ 新增对深度思考模型的支持
- ✨ 添加 `enableThinking` 配置选项
- ✨ 思考过程日志输出
- 🔧 优化流式响应处理逻辑
- ✨ 新增 Qwen3 模型的两种 thinking 控制方法
- ✨ 添加 `qwenThinkingMethod` 配置选项
- ✨ 新增 Google Gemini 2.5 系列模型支持
- ✨ 添加 `geminiThinkingBudget` 配置选项和思考预算控制
- ✨ 支持 Gemini 动态思考、指定预算和禁用思考功能
- 📚 完善供应商预设系统文档
