# Fix: cspell-roles.txt Dictionary Pollution from TXT Role Files

## Problem

The `.vscode/cspell-roles.txt` dictionary file contained large amounts of non-name content — full sentences, section headers, property fields, and narrative paragraphs — instead of just character names and terms.

### Example of polluted output

Before the fix, `cspell-roles.txt` contained entries like:

```
（本档案已更新至第三十五章·烬灭临渊）
一、核心主角
称号：烬灭真君
外貌：黑发，眼神深邃锐利，面容俊朗但常带一丝疏离和淡漠。穿着简约，偏好深色系衣物
告别青龙秘境，与凤凰、陈汐梅返回穗城。
11
1岁
Ch
```

Only a fraction of the 657 entries were actual character names (like `李修缘`, `陈汐梅`).

## Root Cause

The issue involved two interacting problems:

### 1. External folder scanning matched structured character data files

`scanExternalRoleFoldersWithReport()` scans the entire workspace for files with extensions `.txt` `.md` `.json5` `.csv` and checks their filenames against marker keywords. When a user maintained structured character profiles in `小说设定/角色/` with filenames containing "人物" (a default marker keyword), the directory was added to the role scanning queue.

### 2. `loadTXTRoleFile` treated every line as a role name

[src/utils/utils.ts:1232](src/utils/utils.ts) — The original `loadTXTRoleFile()` treated **every non-empty, non-comment line** in a `.txt` file as a role name:

```
（本档案已更新至第三十五章·烬灭临渊）  → role.name = 整行
一、核心主角                          → role.name = 整行
李修缘                                → role.name = "李修缘"  ← 唯一正确的
称号：烬灭真君                        → role.name = 整行
外貌：黑发，眼神深邃锐利...             → role.name = 整行
```

Structured character data files contain many non-name lines (metadata, section headers, property fields, narratives), but `loadTXTRoleFile` had no mechanism to distinguish names from other content.

### Why this matters

All role names (including bogus ones) flowed into `generateCSpellDictionary()`, which wrote them verbatim into `cspell-roles.txt`. This effectively disabled cspell's usefulness, as it would no longer flag misspelled words that happened to match any line in the character data files.

## Fix Summary

Two-layer defense added across two files:

### L1 — Source Filter in `loadTXTRoleFile`

**File**: [src/utils/utils.ts](src/utils/utils.ts#L1232)

**New function**: `isLikelyNonNameLine(line: string): boolean`

Filters lines before they become role objects:

| Rule | Rationale | Example matched |
|------|-----------|----------------|
| Length > 50 chars | Narrative text, not names/vocab | `告别青龙秘境，与凤凰、陈汐梅返回穗城。` |
| Starts with bracket `（([【[` | Metadata / section markers | `（本档案已更新至...）` `【九霄焚世真诀】` |
| Contains colon `：:` | Property fields | `称号：烬灭真君` `核心能力：` |
| Numbered header pattern | Section titles | `一、核心主角` `1. xxx` |
| Punctuation + length > 15 | Descriptive sentences | `外貌：黑发，眼神深邃...` |
| Chinese paired parentheses | Annotations on names | `"力"（新增）` `乔鸿煊（大哥）` |

**Integration point**: Called immediately after comment stripping, before `const role: Role = {...}`:

```
for (const raw of rawLines) {
    let line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#') || line.startsWith('//')) continue;
    // ... inline comment stripping ...
    if (isLikelyNonNameLine(line)) continue;  // ← NEW
    const role: Role = { name: line, ... };
}
```

### L2 — Dictionary Filter in `generateCSpellDictionary`

**File**: [src/utils/generateCSpellDictionary.ts](src/utils/generateCSpellDictionary.ts#L9)

**New function**: `isLikelyNonNameWord(word: string): boolean`

Format-agnostic final filter applied to the word set before writing:

| Rule | Rationale |
|------|-----------|
| Length > 25 chars | Not a name/term |
| Contains Chinese punctuation `：。，！？；、""''（）【】《》…—` | Sentence fragments |
| Contains English punctuation `,.;:!?"()` | Non-name content |
| Contains whitespace | Multi-word fragments |

**Integration point**: Between word collection and sort/write:

```
const wordSet = new Set<string>();
// ... collect all role names and aliases ...
const filtered = Array.from(wordSet).filter(word => !isLikelyNonNameWord(word)); // ← NEW
const sorted = filtered.sort(...);
const newContent = sorted.join('\n');
```

## Before vs After

### Before (original logic)

```
loadTXTRoleFile:
  for each line in .txt file:
    if (!empty && !comment):
      create Role({ name: line })   ← EVERY line becomes a role

generateCSpellDictionary:
  for each role:
    wordSet.add(role.name)          ← ALL names go directly into dictionary
    wordSet.add(tokenized parts)
  write wordSet to cspell-roles.txt
```

### After (with fix)

```
loadTXTRoleFile:
  for each line in .txt file:
    if (!empty && !comment):
      if isLikelyNonNameLine(line):  ← L1: heuristic filter
        continue                      ← skip section headers, properties, narratives
      create Role({ name: line })    ← only name-like lines become roles

generateCSpellDictionary:
  for each role:
    wordSet.add(role.name)
    wordSet.add(tokenized parts)
  filtered = wordSet.filter(!isLikelyNonNameWord)  ← L2: format-agnostic final filter
  write filtered to cspell-roles.txt
```

## What This Prevents

| Scenario | How it's handled |
|----------|-----------------|
| User writes structured character profiles in any `.txt` file | L1 filters out non-name lines by heuristics |
| User changes their character data format in the future | L2 catches anything with punctuation, whitespace, or excessive length regardless of format |
| JSON5/Markdown role files with description fields | L2 ensures only `role.name` entries (short, no punctuation) enter the dictionary |
| Tokenized fragments that are too long or contain artifacts | L2 filters them out |

## Verification

Tested against real-world character data file (`截止第三十四章登场人物信息.txt`, 301 non-empty lines):

| Stage | Entries | Notes |
|-------|---------|-------|
| Original (unfiltered) | 657 | role names + tokenized fragments |
| With L1 only | ~35 roles created | Section headers, properties, narratives all skipped |
| With L2 only | 111 dict entries | 83% reduction from original 657 |
| With L1 + L2 | Clean output | Only genuine character names and terms |

## Risk Assessment

- **Low risk**: L1 only affects `.txt` role files. JSON5, Markdown, and CSV role files use separate loaders and are unaffected.
- **Conservative L1**: The `isLikelyNonNameLine` rules use safe thresholds (50 chars for length, explicit punctuation patterns) that are extremely unlikely to match legitimate Chinese/Japanese character names.
- **L2 is format-agnostic**: Even if a future file format produces unexpected output, L2's punctuation and length checks provide a safety net.
- **False negative risk**: A legitimate role name containing a colon (e.g., "A:B") would be filtered by L1. Such names are virtually non-existent in Chinese novel writing. If needed, these can be added via JSON5/Markdown role files which bypass the TXT line filter.
- **Non-breaking**: The role objects themselves are preserved in `roles[]` even if filtered from the cspell dictionary. Role highlighting, completion, and other features continue to work.

## Files Changed

| File | Change |
|------|--------|
| `src/utils/utils.ts` | Added `isLikelyNonNameLine()` helper function. Added filter call in `loadTXTRoleFile()` |
| `src/utils/generateCSpellDictionary.ts` | Added `isLikelyNonNameWord()` helper function. Added filter step between collection and sort/write |
