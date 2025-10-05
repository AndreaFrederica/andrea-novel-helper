# Typo LLM 深度思考模型支持

## 概述

Andrea Novel Helper 0.4.7 版本新增了对带思考过程（Reasoning）的深度思考模型的支持，如 GLM-4.5、DeepSeek-R1 等。

## 功能特性

### 1. 思考过程输出
当启用 `enableThinking` 选项后，支持推理的模型会在生成最终回复前输出其思考过程（reasoning_content），这些思考过程会在调试日志中显示，帮助用户了解模型的推理逻辑。

### 2. 兼容性
- ✅ 兼容支持 `reasoning_content` 的模型（如 GLM-4.5、DeepSeek-R1 等）
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
  "AndreaNovelHelper.typo.clientLLM.model": "glm-4.5",
  "AndreaNovelHelper.typo.clientLLM.temperature": 0,
  "AndreaNovelHelper.typo.clientLLM.enableThinking": true
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

### 示例 1: 使用阿里云百炼 API + GLM-4.5

```json
{
  "AndreaNovelHelper.typo.clientLLM.enabled": true,
  "AndreaNovelHelper.typo.clientLLM.apiBase": "https://dashscope.aliyuncloud.com/compatible-mode/v1",
  "AndreaNovelHelper.typo.clientLLM.apiKey": "sk-xxx",
  "AndreaNovelHelper.typo.clientLLM.model": "glm-4.5",
  "AndreaNovelHelper.typo.clientLLM.enableThinking": true,
  "AndreaNovelHelper.typo.debug.llmTrace": true
}
```

### 示例 2: 使用 DeepSeek API

```json
{
  "AndreaNovelHelper.typo.clientLLM.enabled": true,
  "AndreaNovelHelper.typo.clientLLM.apiBase": "https://api.deepseek.com/v1",
  "AndreaNovelHelper.typo.clientLLM.apiKey": "your-api-key",
  "AndreaNovelHelper.typo.clientLLM.model": "deepseek-v3",
  "AndreaNovelHelper.typo.clientLLM.enableThinking": false
}
```

## 日志输出示例

启用 `llmTrace` 后，输出面板会显示：

```
==> [ClientLLM] POST https://dashscope.aliyuncloud.com/compatible-mode/v1/chat/completions
model=glm-4.5 temp=0 thinking=true docUuid=xxx texts=5 ctxLen=1234
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

### API 请求格式

启用思考过程时，请求体会包含 `extra_body` 参数：

```typescript
{
  "model": "glm-4.5",
  "messages": [...],
  "temperature": 0,
  "stream": true,
  "extra_body": {
    "enable_thinking": true
  }
}
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

### v0.4.7
- ✨ 新增对深度思考模型的支持
- ✨ 添加 `enableThinking` 配置选项
- ✨ 思考过程日志输出
- 🔧 优化流式响应处理逻辑
