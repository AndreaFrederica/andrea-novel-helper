# Feature: "Open Config" Quick Buttons in Guide Page

## Summary

Added an "Open Config" button to each of the four feature cards in the "Roles & Resources" section of the ANH Guide page. One click detects and opens the corresponding configuration file in the project.

## Problem

Previously, the guide cards only had a "View Docs" button. After reading the docs, users had to manually navigate to the `novel-helper/` directory and find the right config file. New users often didn't know where the files were or what they should be named.

## Solution

Each feature card now has an "打开配置" (Open Config) button:

| Files found | Behavior |
|-------------|----------|
| 0 | Prompt to choose format (JSON5 / MD) → auto-create template with default filename → open |
| 1 | Open directly |
| 2+ | QuickPick list for user to choose |

### Four Commands

| Card | Command ID | Default File | Search Keywords |
|------|-----------|-------------|-----------------|
| 角色管理 (Roles) | `andrea.openRoleConfig` | `character-gallery.*` | `character-gallery`, `character`, `role`, `roles` |
| 敏感词检测 (Sensitive Words) | `andrea.openSensitiveConfig` | `sensitive-words.*` | `sensitive-words`, `sensitive`, `敏感词` |
| 词汇表 (Vocabulary) | `andrea.openVocabConfig` | `vocabulary.*` | `vocabulary`, `vocab`, `词汇`, `术语` |
| 正则着色 (Regex Coloring) | `andrea.openRegexConfig` | `regex-patterns.*` | `regex-patterns`, `regex`, `正则` |

### File Opening

All types use the default text editor (`vscode.openWith ... default`) to avoid the Role JSON5 custom editor incorrectly rendering sensitive-word, vocabulary, and regex-pattern `.json5` files as character forms.

## UI

```
┌─────────────────────────────────────────┐
│  🧑  Role Management                     │
│  Manage characters via role card editor.  │
│  [View Docs] [Open Config]                │
└─────────────────────────────────────────┘
```

## Files Changed

| File | Change |
|------|--------|
| `src/guide/guidePage.ts` | Added `CONFIG_TYPES` mapping, `findConfigFiles()` scanner, `openOrCreateConfig()` open/create logic, `openFileForType()` helper, 4 command registrations |
| `media/guide.html` | Added "打开配置" button next to "查看文档" in each of the 4 cards (via `data-cmd` attributes) |

### Reuses Existing Infrastructure

- File scanning: lightweight keyword + extension matching
- Template creation: simplified inline templates matching `templateGenerators.ts` style
- Button clicks: reused `guide.js` existing `[data-cmd]` event delegation

## Compatibility

- Non-breaking: only adds UI buttons and commands
- Buttons are in the Guide page WebView only (not sidebar or context menus)
- Guides user to create a file when none exists; never errors out
