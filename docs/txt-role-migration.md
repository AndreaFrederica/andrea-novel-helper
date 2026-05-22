# Feature: TXT 角色档案自动检测与迁移

## Summary

When users already maintain character data as structured `.txt` files outside the `novel-helper/` directory (e.g., `小说设定/角色/截止第三十四章登场人物信息.txt`), ANH now automatically detects them and offers one-click conversion to standard JSON5 or Markdown format.

This bridges the gap between "free-form TXT character notes" and "ANH's structured role system" — users can keep their existing workflow and migrate when ready.

## Problem

- Many authors write character profiles as free-form TXT files before adopting ANH
- These TXT files have recognizable structure (character names, property fields like `称号： xxx`, section headers like `一、核心主角`) but are not machine-readable by ANH
- Without conversion, users can't benefit from role highlighting, completion, relationship graphs, or auto-generated cSpell dictionaries
- Previously, users had to manually recreate every character in JSON5/Markdown — error-prone and time-consuming for files with 40+ characters

## Solution

### Three-layer detection

| Layer | Method | Purpose |
|-------|--------|---------|
| **L1 — Filename** | Keywords: 角色, 人物, character, 登场, 设定, etc. | Quick filter — skip novel chapters and unrelated files |
| **L2 — Directory** | Boost confidence for files under `小说设定/角色/` etc. | High-confidence directories lower the content scoring threshold (30 vs 50) |
| **L3 — Content scoring** | Property-line density, short-name-line density, section header count, block structure, long-paragraph penalty | Distinguish character profiles (score 65-77) from novel chapters (score 0) and skill lists (score 0-50, filtered at L1) |

Each candidate gets a 0-100 score; candidates ≥50 (or ≥30 in high-confidence dirs) are surfaced to the user.

### Structured TXT parser

Parses common Chinese character-profile formats:

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
- Multi-line field aggregation
- Section-aware grouping
- `&` connector handling

### Migration workflow

```
Project open → auto-detect → notification popup (if no JSON5 exists)
  → click "开始转换" / status bar / command palette
    → QuickPick: file list with scores and summaries
      → select file → preview extracted roles and sections
        → choose format (JSON5 recommended / Markdown)
          → auto-backup TXT → write character-gallery.json5
```

Safety measures:
1. Original `.txt` file backed up as `.txt.bak` before conversion
2. Conversion preview shows extracted roles before writing
3. If `character-gallery.json5` already exists, user is prompted before overwrite
4. `/` separator in names (e.g., `蓝湛 / "镜"`) preserves ambiguity for manual review
5. Auto-prompt only fires when no JSON5 exists yet

### UI entry points

| Entry | How to access |
|-------|---------------|
| **Auto-popup** | On project open, if TXT candidates detected and no `character-gallery.json5` |
| **Status bar** | `"N 个 TXT 角色档案"` — click to open file list |
| **Command palette** | `andrea.detectTxtRoleFiles` ("检测 TXT 角色档案并迁移") |
| **Common Features panel** | `+ 转换 TXT 角色档案` node in the role management sidebar |

## Verification

Tested against real-world character data (`截止第三十四章登场人物信息.txt`, 301 non-empty lines, ~45 characters):

| Metric | Before | After |
|--------|--------|-------|
| Detection score | — | **77/100** (ROLE FILE) |
| Characters extracted | — | **38** (out of ~39 identifiable, 97%) |
| Novel chapter (第一章) | — | **0/100** (correctly excluded) |
| Skill list (火系异能) | — | Filtered at L1 (no role keyword in filename) |
| Missed: 1 | — | `蓝湛 / "镜"` (`/` reserved for manual review) |

Detection accuracy:
- Character profiles: correctly identified (score 65-77)
- Novel chapters: correctly excluded (score 0, long-paragraph penalty)
- Skill/ability lists: filtered at L1 filename check

## Files Changed

### New files

| File | Purpose |
|------|---------|
| `src/utils/txtRoleDetector.ts` | Three-layer TXT file detection with content scoring |
| `src/utils/txtRoleParser.ts` | Structured TXT → Role[] parser + JSON5/MD output |
| `src/commands/txtMigrationCommands.ts` | Auto-popup, status bar, QuickPick UI, migration execution |
| `docs/txt-role-migration.md` | This document |

### Modified files

| File | Change |
|------|--------|
| `src/activate.ts` | Added import and `registerTxtMigrationCommands(context)` call |
| `package.json` | Added `andrea.detectTxtRoleFiles` and `andrea.migrateTxtRoleFile` commands |
| `src/Provider/view/packageManagerView.ts` | Added `TxtMigrationNode` to "常用功能" panel (conditional on TXT candidates) |
| `media/docs/role-management.html` | Added "TXT 角色档案迁移" section to role management docs |

## Compatibility

- Non-breaking: does not modify existing role loading or parsing code paths
- Optional: no popup if `character-gallery.json5` already exists
- No dependency on TXT file format changes — users can keep their existing files
- Works alongside existing JSON5/MD/CSV role formats
- All existing security/backup patterns followed (`.bak` before write, user confirmation before destructive action)
