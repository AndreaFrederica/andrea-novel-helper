---
mode: ask
description: ANH 项目文件结构、角色文件格式（JSON5/Markdown）、关系图、项目配置、文件追踪数据库等领域知识
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
├── novel-helper/                  # ANH data root (internal)
│   ├── <package-name>/            # A "character package" (any folder name)
│   │   ├── roles.md               # Character list — PREFERRED Markdown format
│   │   ├── characters.json5       # Character list (JSON5 format)
│   │   ├── characters.ojson5      # Ordered character list (OJSON5 format)
│   │   ├── relationships.rjson5   # Relationship graph
│   │   └── ...
│   ├── mcp.json                   # MCP server config
│   ├── file-tracking.json         # Legacy file-tracking DB (may not exist)
│   └── .anh-fsdb/                 # Sharded file-tracking DB (newer format)
│       ├── index.json
│       └── snapshots/
│           ├── wordcount-files.json
│           └── tracker-files.json
├── <any-other-folder>/            # External resource directory (auto-detected)
│   ├── roles.md                   # Marker file — triggers ANH to scan this folder
│   └── ...
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
   - **Prefer `.md` (Markdown) format** — it is the recommended default for new character files because it is human-readable and easy to maintain.
   - Use `.json5` or `.ojson5` for structured/programmatic access when needed.
4. **`name` and `type` are always required** for a character entry.
5. **`uuid`** should be a UUID v7 string. If omitting it, ANH will generate one at runtime.
6. The `packagePath` and `sourcePath` fields are **runtime-only** — never write them to disk.
7. When editing `anhproject.md`, always preserve `uuid` and `createdAt`.
8. Relationship file names: use `.rjson5` extension, or include `relationship`/`关系`/`关联` in the filename.
9. Files prefixed with `__` or `!!` (e.g., `__main.json5`) get the highest priority (1000) during character merging.
10. The `novel-helper/` directory is **not** the workspace root; it lives inside the workspace root alongside the actual chapter files.

---

## 8. Creating Characters — Two Modes

### Mode A: Extract from Novel Text

When the user provides novel text (chapters, excerpts, or a full manuscript), analyse it to extract characters, then create or update character files.

**Step-by-step process:**

1. **Read the provided text** — scan for character mentions, dialogue speakers, and narrative references.
2. **Identify candidates** — collect all names, pronouns, and aliases that appear to represent distinct individuals.
3. **Infer attributes from context:**
   - `type`: Determine if each character is `主角`, `配角`, or other. Protagonists appear most frequently, drive the plot, and have POV scenes.
   - `aliases`: Alternative names or nicknames used for the same character.
   - `description`: Summarise who the character is from context clues.
   - `gender`: Infer from pronouns or explicit mentions.
   - `age`: If stated or implied.
   - `occupation` / `affiliation`: From role in the story.
   - `personality`: From behaviour, dialogue, and narrative descriptions.
   - `appearance`: From physical descriptions in the text.
   - `background`: Origin or backstory clues.
   - `relationship`: Inter-character relationships described in the text.
   - `skill` / `ability`: Powers, talents, or specialties.
4. **Choose a target file:**
   - If a character file already exists under `novel-helper/<package>/`, add new characters there.
   - Otherwise, create `novel-helper/<package-name>/roles.md` (e.g., `novel-helper/characters/roles.md`) — "characters" here is just an example package name.
5. **Write in Markdown format (preferred)** — use the template in Section 3b. For each extracted character, write a `## <name>` block with all inferred fields.
6. **Present a summary** to the user listing every character created, and ask if any data needs correction.

**Important:** Do not blindly extract every word that looks like a name. Limit to characters that have dialogue, actions, or recurring mentions. Filter out places and objects.

---

### Mode B: Create from Scratch (Interactive)

When the user wants to create a character without source material, follow this interactive question-and-answer process. **Ask questions one group at a time; do not dump all questions at once.**

**Phase 1 — Core identity (always ask)**

Ask the user each of the following, offering concrete options where appropriate:

| Question | Options to offer |
|---|---|
| 角色名是什么？ | (free text) |
| 这是哪种角色？ | `主角` / `配角` / `联动角色` / `词汇` / 其他（自定义）|
| 性别？ | 男 / 女 / 不明 / 其他 |
| 大概多大？ | 数字，或"未知"/"不详" |

**Phase 2 — Appearance & personality (ask next)**

| Question | Options or guidance |
|---|---|
| 外貌特征是什么？ | 自由描述（身高、发色、眼色、服装风格等） |
| 性格如何？ | 自由描述，或选择典型词语：开朗 / 冷静 / 腹黑 / 热血 / 内敛 / 傲慢 / 善良 |

**Phase 3 — Background & role (ask next)**

| Question | Options or guidance |
|---|---|
| 从属什么组织 / 阵营 / 势力？ | 自由描述，或"无" |
| 职业或在故事中的身份？ | 自由描述 |
| 有什么特殊技能或能力？ | 自由描述，或"普通人" |
| 这个角色的核心目标/动机是什么？ | 自由描述 |

**Phase 4 — Optional details (offer as optional)**

Offer to fill in: `background`（背景故事）, `secret`（秘密）, `fear`（恐惧）, `quote`（代表台词）, `note`（备注）, custom fields. Tell the user they can skip if not needed.

**After collecting answers:**

1. Generate the character entry in **Markdown format** (see Section 3b template).
2. Show the preview to the user and ask: "请确认以上内容是否正确，或告诉我需要修改哪里？"
3. After confirmation, write to `novel-helper/characters/roles.md` (create file and directory if they don't exist).
4. Inform the user the file has been saved and ANH will reload automatically.

---

## 9. External Resource Directories

External resource directories are folders **outside** `novel-helper/` that ANH automatically detects and scans for character/relationship files.

### How ANH Detects an External Resource Directory

ANH scans all non-ignored folders in the workspace and marks a folder as an external resource directory when it contains **at least one** of the following "marker files":

| Condition | Example |
|---|---|
| File with auto-marker extension (always triggers) | Any `*.ojson5`, `*.rjson5`, `*.ojson`, `*.rjson`, `*.tjson5` file |
| Legacy init file | `__init__.ojson5` (any content, even empty `{}`) |
| `.json5` or `.txt` file whose **filename** contains a marker keyword (see below) | `my-characters.json5`, `角色库.txt` |
| `.md` file with a recognised library basename or suffix | `roles.md`, `character-gallery.md`, `*_character.md` |

**Default marker keywords** (case-insensitive match inside filename):

```
character-gallery, character, role, roles,
sensitive-words, sensitive, vocabulary, vocab,
regex-patterns, regex,
relationship, relation, connections, links,
timeline,
角色, 人物, 敏感词, 词汇, 词庫, 词库,
正则, 正則, 正则表达式, 正則表達式,
关系, 关联, 连接, 联系,
时间线, 時間線
```

**Recognised `.md` library basenames** (exact): `character-gallery`, `sensitive-words`, `vocabulary`
**Recognised `.md` library suffixes**: `_character`, `_sensitive`, `_vocabulary`, `-character`, `-sensitive`, `-vocabulary`

**Ignored directories** (never scanned): `.git`, `.vscode`, `.idea`, `node_modules`, `dist`, `build`, `out`

A folder can also be **manually excluded** by placing an empty `.anh-ignore` file inside it.

### How to Create an External Resource Directory

To make ANH scan a folder outside `novel-helper/` for characters:

1. **Create the folder** anywhere in the workspace (not inside `novel-helper/`).
   ```
   <workspace-root>/
   └── my-characters/         ← new external resource folder
   ```

2. **Add a marker file** so ANH detects it. The simplest and most reliable method is to create a character file with a recognised name — **`roles.md`** is recommended:
   ```
   my-characters/
   └── roles.md               ← marker file (also the character file)
   ```
   Alternative marker approaches:
   - Any `*.ojson5` or `*.rjson5` file (auto-detected by extension alone)
   - A `__init__.ojson5` file with content `{}` (legacy but still supported)
   - A `.json5` file whose name contains `character`, `role`, `角色`, etc.

3. **Add character data** to the marker file (or other files in the same folder) using the formats described in Section 3.

4. **Verify detection** — After saving, ANH will rescan and the folder will appear in the Package Manager sidebar under the external resources section.

### Excluding a Folder from ANH Scanning

To prevent ANH from scanning a directory that was accidentally detected:

1. Create an empty file named `.anh-ignore` inside that directory.
   ```
   some-folder/
   └── .anh-ignore            ← presence of this file tells ANH to skip the folder
   ```
2. ANH will exclude this folder on the next scan.

### Recommended Structure for an External Resource Directory

```
<workspace-root>/
└── characters/                     # External resource directory
    ├── roles.md                    # Main character file (marker + data)
    ├── side-characters.md          # Additional character file
    └── relationships.rjson5        # Relationship file (optional)
```

---

## 10. Common Tasks (Updated)

### Add a new character to an existing Markdown file (preferred)

1. Open the `.md` character file under `novel-helper/<package>/` (or an external resource directory).
2. Append `---` then `## <角色名>` with `### 类型` as a minimum.
3. Add additional `###` field headings as needed.

### Add a new character to an existing JSON5 file

1. Open the `.json5` (or `.ojson5`) character file under `novel-helper/<package>/`.
2. Append a new object to the array with at minimum `name` and `type`.
3. Optionally add `uuid` (UUID v7), `aliases`, `description`, `color`, extended fields.
4. Save the file. ANH will hot-reload automatically.

### Create characters from novel text (Mode A)

Follow the step-by-step process described in **Section 8, Mode A**.

### Create a character interactively from scratch (Mode B)

Follow the interactive Q&A process described in **Section 8, Mode B**.

### Create a new character package inside novel-helper

1. Create a new subdirectory under `novel-helper/`, e.g., `novel-helper/side-characters/`.
2. Create `roles.md` inside it (preferred) or `characters.json5`.
3. Add character entries following the formats above.

### Create an external resource directory

Follow the step-by-step process described in **Section 9**.

### Read what characters are defined in a project

1. Enumerate all files under `novel-helper/` and all detected external resource directories with extensions `.json5`, `.ojson5`, `.md`.
2. For each file, parse according to its extension (JSON5 array or Markdown headings).
3. Merge characters from all files, respecting file-type priority.

### Identify which chapter mentions a specific character

1. Read the character's `name` and `aliases` from the character files.
2. Search for occurrences of those strings in the workspace's `.md` and `.txt` chapter files.
