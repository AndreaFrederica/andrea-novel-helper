---
name: anh-project
description: >-
  Domain knowledge for working with Andrea Novel Helper (ANH) projects.
  Teaches agents how to identify, read, and edit ANH project files including
  project config, character files (JSON5/Markdown), relationship graphs, and
  the file-tracking database.
user-invocable: true
---

# Andrea Novel Helper (ANH) — Agent Knowledge Base

This skill gives you the domain knowledge needed to identify, read, and edit an **ANH (Andrea Novel Helper)** project — a VS Code extension that assists novelists with character management, writing statistics, outlines, and more.

---

## 1. How to Recognise an ANH Project

An ANH project root contains **at least one** of the following markers:

| Marker | Meaning |
|---|---|
| `anhproject.md` | Project configuration file (required for full ANH features) |
| `novel-helper/` directory | Character & helper data directory |
| `novel-helper/mcp.json` | MCP (Model Context Protocol) config |

The `novel-helper/` directory is the single most important directory. It contains all character packages, relationship files, writing-statistics databases, and outline files.

**Typical project layout:**

```
<workspace-root>/
├── anhproject.md                  # Project config (Markdown-based)
├── novel-helper/                  # ANH data root
│   ├── <package-name>/            # A "character package" (any folder name)
│   │   ├── characters.json5       # Character list (JSON5 format)
│   │   ├── characters.ojson5      # Ordered character list (OJSON5 format)
│   │   ├── roles.md               # Character list (Markdown format)
│   │   ├── relationships.rjson5   # Relationship graph
│   │   └── ...
│   ├── mcp.json                   # MCP server config
│   ├── file-tracking.json         # Legacy file-tracking DB (may not exist)
│   └── .anh-fsdb/                 # Sharded file-tracking DB (newer format)
│       ├── index.json
│       └── snapshots/
│           ├── wordcount-files.json
│           └── tracker-files.json
└── <chapter-files>.md / .txt      # The actual novel chapters
```

---

## 2. Project Config — `anhproject.md`

The project configuration is a Markdown file using `##` second-level headings as section keys. **Do not use first-level headings for fields.**

### Reading

Parse each `## <SectionName>` block: the text following the heading (until the next `##`) is the field value. Supported section names (case-insensitive, Chinese or English):

| Section heading | Field | Type |
|---|---|---|
| `项目名称` / `name` | Project name | string |
| `项目描述` / `description` | Description | string |
| `作者` / `author` | Author | string |
| `项目UUID` / `项目标识` / `uuid` | Project UUID | UUID string |
| `封面` / `cover` | Cover image path | string (optional) |
| `项目简介` / `简介` / `summary` | Summary | string (optional) |
| `标签` / `tags` | Tags | comma-separated or newline-separated list; lines starting with `//` are comments and must be ignored |
| `创建时间` / `created` | Created timestamp | ISO 8601 string |
| `更新时间` / `updated` | Updated timestamp | ISO 8601 string |

### Example

```markdown
# My Novel

## 项目名称
My Novel

## 项目描述
A fantasy adventure novel.

## 作者
Jane Doe

## 项目UUID
a1b2c3d4-0000-0000-0000-000000000001

## 封面

## 项目简介
An epic tale of heroes and dragons.

## 标签
// This line is a comment and is ignored
奇幻, 冒险
龙与魔法

## 创建时间
2025-01-01T00:00:00.000Z

## 更新时间
2025-06-01T12:00:00.000Z
```

### Writing / Editing

When updating `anhproject.md`:
- Preserve the existing `uuid` and `created` (`createdAt`) fields exactly.
- Update the `updated` (`updatedAt`) section to the current ISO 8601 timestamp.
- Keep the `##` section structure; do not add or remove headings.

---

## 3. Character (Role) Files

Characters can be stored in three file formats. All formats may coexist in the same package directory; ANH merges them by priority.

### File Priority (higher = wins on conflict)

```
.ojson5 (3) > .json5 (2) > .md (1)
```

Files with `__` or `!!` prefix get priority 1000 (highest). Example: `__main-cast.json5`.

---

### 3a. JSON5 / OJSON5 Format (`.json5`, `.ojson5`)

A JSON5 file contains an **array** of Role objects. Comments (`//`) are allowed.

**Full Role interface:**

```json5
[
  {
    // --- Core / Base fields ---
    name: "角色名",             // REQUIRED. Primary name used for text highlight & completion.
    type: "主角",               // REQUIRED. One of: "主角"|"配角"|"联动角色"|"敏感词"|"词汇"|"正则表达式" or any custom string.
    uuid: "uuid-v7-string",    // Optional unique ID (UUID v7 recommended). Stable across renames.
    aliases: ["别名1", "别名2"], // Optional. Alternative names also highlighted/completed.
    description: "角色简介",    // Optional. Shown in hover & completion detail.
    color: "#E60033",           // Optional. Foreground highlight colour (hex/rgb/hsl).
    affiliation: "阵营",        // Optional. Faction or organisation.
    priority: 10,               // Optional. Lower = higher priority for highlight overlap. Default 999.
    fixes: ["替换词1", "替换词2"], // Optional. Replacement candidates (used for 敏感词 type).
    wordSegmentFilter: false,   // Optional. Prevents single-character false matches.
    regex: "pattern",           // Only for type "正则表达式". The regex pattern string.
    regexFlags: "gi",           // Only for type "正则表达式". Regex flags.

    // --- Text style (new, preferred) ---
    style: {
      color: "#E60033",
      backgroundColor: "#FFF0F0",
      bold: true,
      italic: false,
      strikethrough: false,
      underline: false,
    },

    // --- Extended fields (shown in character card UI) ---
    age: "25",
    gender: "女",
    occupation: "魔法师",
    personality: "开朗活泼",
    appearance: "银发红眸",
    background: "出生于魔法世家",
    relationship: "与主角是青梅竹马",  // also: relationships
    skill: "冰系魔法，治愈术",         // also: skills, 技能
    weakness: "火系弱点",              // also: weaknesses, 弱点
    goal: "成为最强魔法师",            // also: goals
    motivation: "为家人复仇",
    fear: "黑暗",                      // also: fears
    secret: "实为王族后裔",            // also: secrets
    quote: "我会保护大家！",           // also: quotes
    note: "重要的配角",                // also: notes
    tag: "魔法使用者",                 // also: tags
    category: "人类",
    level: "S级",
    status: "活跃",
    location: "魔法学院",
    origin: "北方王国",
    family: "父母双亡",
    education: "王立魔法学院",
    hobby: "植物收集",                 // also: hobbies

    // Any other custom key-value pairs are allowed (CustomFields).
    称号: "冰雪魔女",
    契约精灵: "霜雪",
  }
]
```

**Important rules for JSON5/OJSON5 editing:**
- Always keep `name` and `type` present.
- Do not include `packagePath` or `sourcePath` in the file — these are runtime-only backend fields injected by the extension and must never be written to disk.
- Use JSON5 syntax: trailing commas are allowed, `//` comments are allowed, unquoted keys are allowed.
- `.ojson5` is semantically identical to `.json5`; both are parsed the same way.

---

### 3b. Markdown Format (`.md`)

Characters are stored as second-level headings (`##`). Each field is a third-level heading (`###`) under the character heading.

**Structure:**

```markdown
# 角色库标题（任意，忽略）

## 角色名
（任意直接内容会被合并到 description）

### 类型
主角

### 描述
角色的详细描述

### 颜色
#E60033

### 从属
北方王国

### 别名
冰雪魔女, Elara

### 技能
- 冰系魔法
- 治愈术
- 结界展开

### 年龄
18

### 性格
开朗，勇敢，有时鲁莽

---

## 另一个角色名

### 类型
配角
```

**Supported `###` field headings** (English or Chinese alias both work):

| English key | Chinese alias |
|---|---|
| `name` | `名称` |
| `description` | `描述` |
| `type` | `类型` |
| `uuid` | `UUID` |
| `color` | `颜色` |
| `affiliation` | `从属` |
| `aliases` / `alias` | `别名` |
| `skill` / `skills` | `技能` |
| `age` | `年龄` |
| `gender` | `性别` |
| `occupation` | `职业` |
| `personality` | `性格` |
| `appearance` | `外貌` |
| `background` | `背景` |
| `relationship` / `relationships` | `关系` |
| `weakness` / `weaknesses` | `弱点` |
| `goal` / `goals` | `目标` |
| `motivation` | `动机` |
| `fear` / `fears` | `恐惧` |
| `secret` / `secrets` | `秘密` |
| `quote` / `quotes` | `台词` |
| `note` / `notes` | `备注` |
| `tag` / `tags` | `标签` |
| `category` | `分类` |
| `level` | `等级` |
| `status` | `状态` |
| `location` | `位置` |
| `origin` | `出身` |
| `family` | `家庭` |
| `education` | `教育` |
| `hobby` / `hobbies` | `爱好` |
| `fixes` / `fixs` / `fix` / `replacements` | `修复` |

Any unrecognised `###` heading becomes a custom field on the character object.

**When adding a new character to a Markdown file**, append a new `## <name>` block with a `### 类型` field at minimum, and use `---` separators between characters.

---

## 4. Relationship Files (`.rjson5` or JSON5 with "relationship" in filename)

Relationship files define directed or undirected edges between characters.

### Format A — Array of relationship objects (`.rjson5`)

```json5
[
  {
    uuid: "rel-001",
    fromRoleId: "张三",      // Source character name
    toRoleId: "李四",        // Target character name
    relationshipType: "朋友关系",
    description: "大学同窗好友",
    strength: 7,             // 1-10
    isDirectional: false,
    startTime: "2020-09-01",
    endTime: "",
    status: "active",        // "active" | "inactive" | "pending" | "ended"
    tags: ["同学", "朋友"],
    notes: "在大学期间结识的好友"
  }
]
```

### Format B — Graph data (nodes + lines, `.json5`)

```json5
{
  nodes: [
    {
      id: "node-1",
      text: "角色A",
      data: { roleUuid: "uuid-of-roleA" }
    }
  ],
  lines: [
    {
      id: "line-1",
      from: "node-1",
      to: "node-2",
      text: "关系描述",
      data: {
        type: "朋友",
        strength: 8,
        status: "active",
        tags: ["朋友"]
      }
    }
  ]
}
```

---

## 5. File-Tracking Database (Read-Only for Agents)

The file-tracking database is managed automatically by ANH. **Do not manually edit these files.** They are stored in:

- `novel-helper/.anh-fsdb/index.json` — path-to-UUID index
- `novel-helper/.anh-fsdb/*.json` — sharded file metadata
- `novel-helper/.anh-fsdb/snapshots/` — cached word-count and tracker snapshots
- `novel-helper/file-tracking.json` — legacy single-file format (may or may not exist)

Each file entry contains:

```json
{
  "uuid": "...",
  "filePath": "relative/path/to/file.md",
  "fileName": "file.md",
  "fileExtension": ".md",
  "size": 1234,
  "mtime": 1700000000000,
  "hash": "sha256hex",
  "createdAt": 1700000000000,
  "lastTrackedAt": 1700000000000,
  "updatedAt": 1700000000000,
  "writingStats": { ... },
  "wordCountStats": { "cjkChars": 500, "total": 600, ... }
}
```

---

## 6. MCP Config — `novel-helper/mcp.json`

A standard MCP server configuration used to connect external tools. Edit only if the user explicitly asks to change MCP settings.

---

## 7. Key Rules for Editing ANH Projects

1. **Never edit** `.anh-fsdb/` contents, `file-tracking.json`, or any snapshot files — these are managed by the extension.
2. **Character files in `novel-helper/`** are the correct place to add or edit characters.
3. When adding a character, choose the appropriate file format:
   - Use `.json5` or `.ojson5` for structured data and programmatic access.
   - Use `.md` for human-readable, prose-style character sheets.
4. **`name` and `type` are always required** for a character entry.
5. **`uuid`** should be a UUID v7 string. If omitting it, ANH will generate one at runtime.
6. The `packagePath` and `sourcePath` fields are **runtime-only** — never write them to disk.
7. When editing `anhproject.md`, always preserve `uuid` and `createdAt`.
8. Relationship file names: use `.rjson5` extension, or include `relationship`/`关系`/`关联` in the filename.
9. Files prefixed with `__` or `!!` (e.g., `__main.json5`) get the highest priority (1000) during character merging.
10. The `novel-helper/` directory is **not** the workspace root; it lives inside the workspace root alongside the actual chapter files.

---

## 8. Common Tasks

### Add a new character to an existing JSON5 file

1. Open the `.json5` (or `.ojson5`) character file under `novel-helper/<package>/`.
2. Append a new object to the array with at minimum `name` and `type`.
3. Optionally add `uuid` (UUID v7), `aliases`, `description`, `color`, extended fields.
4. Save the file. ANH will hot-reload automatically.

### Add a new character to an existing Markdown file

1. Open the `.md` character file under `novel-helper/<package>/`.
2. Append `---` then `## <角色名>` with `### 类型` as a minimum.
3. Add additional `###` field headings as needed.

### Create a new character package

1. Create a new subdirectory under `novel-helper/`, e.g., `novel-helper/side-characters/`.
2. Create a new file inside: `characters.json5` (array format) or `roles.md`.
3. Add character entries following the formats above.

### Read what characters are defined in a project

1. Enumerate all files under `novel-helper/` with extensions `.json5`, `.ojson5`, `.md`.
2. For each file, parse according to its extension (JSON5 array or Markdown headings).
3. Merge characters from all files, respecting file-type priority.

### Identify which chapter mentions a specific character

1. Read the character's `name` and `aliases` from the character files.
2. Search for occurrences of those strings in the workspace's `.md` and `.txt` chapter files.
