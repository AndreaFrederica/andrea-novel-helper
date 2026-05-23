# Feature: TXT 角色档案自动检测与迁移

## Summary

When users already maintain character data as structured `.txt` files outside the `novel-helper/` directory (e.g., `小说设定/角色/截止第三十四章登场人物信息.txt`), ANH now automatically detects them and offers one-click conversion to standard JSON5 or Markdown format.

## Problem

- Many authors write character profiles as free-form TXT files before adopting ANH
- These TXT files have recognizable structure (character names, property fields like `称号： xxx`, section headers like `一、核心主角`) but are not machine-readable by ANH
- Without conversion, users can't benefit from role highlighting, completion, relationship graphs, or auto-generated cSpell dictionaries
- Previously, users had to manually recreate every character in JSON5/Markdown — error-prone and time-consuming for files with 40+ characters

## Solution

### Detection engine (configurable)

Three-layer detection with all parameters exposed via VS Code settings:

| Layer | Method | Configurable via |
|-------|--------|-----------------|
| **L1 — Filename** | Keywords matched against filename | `txtMigration.detectionKeywords` |
| **L2 — Directory** | Boost confidence for files under known character dirs | `txtMigration.highConfidenceDirs` |
| **L3 — Content scoring** | Property-line density, short-name-line density, section header count, block structure | `txtMigration.scoreThreshold` / `txtMigration.highConfidenceScoreThreshold` |

All settings live under `AndreaNovelHelper.txtMigration.*` with sensible defaults. Users can customize via VS Code Settings UI, `settings.json`, or project JSON5 config.

### Feature toggle

`AndreaNovelHelper.txtMigration.enabled` (default `true`). When disabled:
- Status bar indicator hidden
- Auto-popup suppressed
- Sidebar "转换 TXT 角色档案" node hidden
- Manual command still available

### Structured TXT parser

Parses common Chinese character-profile formats with 30+ field keyword mappings:

```
（本档案已更新至第三十五章）     → skipped (meta)
一、核心主角                    → section grouping
李修缘                         → character name
称号：烬灭真君                  → property (title)
年龄：未知（外表约25岁）         → property (age)
外貌：黑发，眼神深邃锐利...      → property (appearance)
新增动态：                      → multi-line field (dynamics)
告别青龙秘境，与凤凰返回穗城。   → field continuation
```

Features:
- Property extraction: 30+ Chinese field keywords (`称号`→`title`, `外貌`→`appearance`, etc.)
- Quote/parenthesis stripping: `"力"（新增）` → `力`
- `&` connector handling: `李佳 & 天一` → `李佳` + `天一` (split)
- `/` separator preserved for manual review (`蓝湛 / "镜"`)
- Multi-line field aggregation
- Section-aware grouping

### Output

- **Filename**: `<original_name>.json5` or `<original_name>.md` (e.g., `截止第三十四章登场人物信息.json5`)
- **Location**: `novel-helper/` under the correct workspace root (multi-root safe)
- **Format**: Proper JSON5 (via `JSON5.stringify`) handling arrays, numbers, and booleans correctly
- **Safety**: Original `.txt` backed up as `.txt.bak`, overwrite prompt if target exists

### Migration workflow

```
Project open → async detection (non-blocking, 100ms debounce)
  → auto-popup (if no character-gallery.json5 exists and feature enabled)
    → click "开始转换" / status bar / command palette / sidebar node
      → QuickPick: file list with scores and summaries
        → select file → preview extracted roles and sections
          → choose format (JSON5 / Markdown)
            → auto-backup TXT → write to novel-helper/
```

### UI entry points

| Entry | How to access |
|-------|---------------|
| **Auto-popup** | On project open, if TXT candidates detected and no `character-gallery.json5` |
| **Status bar** | `"N 个 TXT 角色档案"` — click to open file list |
| **Command palette** | `Ctrl+Shift+P` → `andrea.detectTxtRoleFiles` / "检测 TXT 角色档案并迁移" |
| **Sidebar** | "常用功能" → `+ 转换 TXT 角色档案` (conditional, uses cached async detection) |

## VS Code Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `AndreaNovelHelper.txtMigration.enabled` | boolean | `true` | Master toggle for TXT migration |
| `AndreaNovelHelper.txtMigration.detectionKeywords` | string[] | `["角色","人物","character","role"...]` | Filename keywords for L1 |
| `AndreaNovelHelper.txtMigration.highConfidenceDirs` | string[] | `["角色","人物","characters","roles"]` | Directory names for L2 boost |
| `AndreaNovelHelper.txtMigration.scoreThreshold` | number | `50` | Content score threshold (non-high-confidence dirs) |
| `AndreaNovelHelper.txtMigration.highConfidenceScoreThreshold` | number | `30` | Content score threshold (high-confidence dirs) |

## Verification

Tested against real-world character data (`截止第三十四章登场人物信息.txt`, 301 non-empty lines, ~45 characters):

| Metric | Result |
|--------|--------|
| Detection score | **77/100** |
| Characters extracted | **38** (~84%) |
| Missed | 1 (`蓝湛 / "镜"` — `/` reserved for manual review) |
| Novel chapter (第一章 云中惊魂.txt) | **0/100** (correctly excluded) |
| Skill list (火系异能技能.txt) | Filtered at L1 (no role keyword in filename) |
| JSON5 output validity | Valid, arrays/numbers/booleans handled correctly |

## Files Changed

### New files

| File | Purpose |
|------|---------|
| `src/utils/txtRoleDetector.ts` | Configurable three-layer TXT file detection with content scoring |
| `src/utils/txtRoleParser.ts` | Structured TXT → Role[] parser + JSON5/MD output (uses JSON5.stringify) |
| `src/commands/txtMigrationCommands.ts` | Auto-popup, status bar (subscription-safe), QuickPick UI, migration execution (multi-root safe) |
| `docs/txt-role-migration.md` | This document |

### Modified files

| File | Change |
|------|--------|
| `src/activate.ts` | Added import and `registerTxtMigrationCommands(context)` call |
| `package.json` | Added 5 VS Code settings + 2 commands |
| `src/Provider/view/packageManagerView.ts` | Added `TxtMigrationNode` with async cached detection (non-blocking TreeView) + feature toggle check |
| `media/docs/role-management.html` | Added "TXT 角色档案迁移" section to user-facing docs |

## Compatibility

- Non-breaking: does not modify existing role loading or parsing code paths
- Optional: feature toggle allows disabling everything
- Multi-root safe: output goes to the correct workspace folder for each source file
- Memory safe: statusBarItem properly disposed via context.subscriptions
- UI non-blocking: detection uses debounced timer, not synchronous in getChildren()
- All rules/configurations exposed via VS Code settings with defaults matching original behavior
