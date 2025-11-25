# 🌍 多语言文化背景支持

## 功能概述

为 Andrea Novel Helper 的随机角色生成功能添加了多语言文化背景支持，现在用户可以根据 VS Code 的显示语言看到相应的文化名称翻译，避免用户看不懂不同文化背景选项的问题。

## 实现特性

### 🌐 支持的语言界面
- **中文 (zh)**: 简体中文显示
- **英文 (en)**: English interface
- **日语 (ja)**: 日本語インターフェース
- **韩文 (ko)**: 한국어 인터페이스

### 🗺️ 支持的文化背景 (40+ 种)

#### 亚洲语言
- **中文**: 简体 (zh_CN)、繁体 (zh_TW)
- **英文**: 美国 (en_US)、英国 (en_GB)、澳大利亚 (en_AU) 等
- **日语**: 日本語 (ja_JP)
- **韩文**: 한국어 (ko)
- **阿拉伯文**: العربية (ar)
- **希伯来文**: עברית (he)
- **泰文**: ไทย (th)
- **越南文**: Tiếng Việt (vi)
- **印尼文**: Bahasa Indonesia (id_ID)
- **印地文**: हिन्दी (hi)
- **尼泊尔文**: नेपाली (ne)

#### 欧洲语言
- **法文**: Français (fr)、加拿大 (fr_CA)
- **德文**: Deutsch (de)、奥地利 (de_AT)、瑞士 (de_CH)
- **西班牙文**: Español (es)、墨西哥 (es_MX)
- **意大利文**: Italiano (it)
- **葡萄牙文**: Brasil (pt_BR)、Portugal (pt_PT)
- **俄文**: Русский (ru)
- **北欧语言**: 瑞典文 (sv)、挪威文 (nb_NO)、丹麦文 (da)、芬兰文 (fi)
- **东欧语言**: 波兰文 (pl)、捷克文 (cs_CZ)、匈牙利文 (hu)、克罗地亚文 (hr)、罗马尼亚文 (ro)
- **南欧语言**: 希腊文 (el)、土耳其文 (tr)
- **荷兰文**: Nederlands (nl)

#### 奇幻风格
- **奇幻风格**: 奇幻、高等奇幻、黑暗奇幻

## 技术实现

### 核心功能
```typescript
public static getLocalizedName(culture: string): string {
    // 获取 VS Code 当前显示语言
    const currentLang = vscode.env.language;

    // 文化显示名称映射（支持多语言）
    const displayNames = {
        'zh_CN': {
            'zh': '中文（简体）',
            'en': 'Chinese (Simplified)',
            'ja': '中国語（簡体）',
            'ko': '중국어 (간체)',
            'default': '中文（简体）'
        },
        // ... 更多文化映射
    };

    const nameMap = displayNames[culture];
    if (nameMap) {
        return nameMap[currentLang] || nameMap['default'];
    }
    return culture;
}
```

### 智能回退机制
1. **语言回退**: 如果用户的 VS Code 语言没有对应翻译，回退到默认语言
2. **文化回退**: 如果文化代码未知，返回原始文化代码

### 集成方式
- 在文化配置初始化时自动应用本地化显示名称
- 在右键菜单 "🎲 随机生成角色" 中显示翻译后的文化名称
- 支持动态切换，无需重启 VS Code

## 用户体验示例

### 中文 VS Code 界面
```
🎭 随机生成角色 - 步骤 1/6：选择文化背景
◉ 中文（简体）
◐ 中文（繁體）
◐ 英文（美国）
◐ 英文（英国）
◐ 法文
◐ 德文
...
```

### 英文 VS Code 界面
```
🎲 Random Character Generation - Step 1/6: Select Cultural Background
◉ Chinese (Simplified)
◐ Chinese (Traditional)
◐ English (US)
◐ English (UK)
◐ French
◐ German
...
```

### 日语 VS Code 界面
```
🎭 ランダムキャラクター生成 - ステップ 1/6：文化背景を選択
◉ 中国語（簡体）
◐ 中国語（繁體）
◐ 英語（アメリカ）
◐ 英語（イギリス）
◐ フランス語
◐ ドイツ語
...
```

## 文件修改

### 主要文件
- `src/services/nameGeneratorService.ts`: 添加多语言支持核心功能
- 测试文件: 验证多语言功能正常工作

### 关键方法
- `NameGeneratorService.getLocalizedName()`: 获取本地化文化名称
- `initializeCultureConfigs()`: 初始化时应用多语言名称

## 配置要求

无额外配置要求！功能会自动：
1. 检测用户当前的 VS Code 显示语言 (`vscode.env.language`)
2. 根据语言自动显示对应的文化名称翻译
3. 在没有翻译时优雅回退到默认显示

## 测试验证

通过独立测试验证了：
- ✅ 中文界面正确显示中文文化名称
- ✅ 英文界面正确显示英文文化名称
- ✅ 日语界面正确显示日语文化名称
- ✅ 韩文界面正确显示韩文文化名称
- ✅ 未知语言时回退到默认显示
- ✅ 未知文化时返回原始代码

---

🎉 **现在用户在使用随机角色生成功能时，可以轻松理解每个文化背景选项，不再有语言障碍！**