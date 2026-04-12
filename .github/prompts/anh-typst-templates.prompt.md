---
mode: ask
description: ANH Typst 导出模板系统的领域知识：模板格式、Liquid 渲染上下文、自定义过滤器、预览集成
---


# ANH Typst Template System — Agent Knowledge Base

This skill gives you the domain knowledge needed to create, edit, and manage **Typst export templates** inside an **ANH (Andrea Novel Helper)** project.

---

## 1. What Is the ANH Typst System?

ANH can export Markdown documents (novel chapters, articles, etc.) to **PDF, PNG, SVG, or HTML** using the [Typst](https://typst.app) typesetting engine. The workflow is:

```
Markdown file  →  Markdown parser  →  Liquid template  →  .typ source  →  typst compile  →  PDF/PNG/SVG/HTML
```

The **Liquid template** step is what you author when creating or editing a template. Templates receive the parsed Markdown as structured data and produce a `.typ` source file, which is then compiled by the `typst` CLI.

---

## 2. Template Locations

Templates are loaded from **two** locations and merged (external templates override internal ones if names collide):

| Location | Description | Config setting |
|---|---|---|
| `<extensionDir>/templates/typst/` | Built-in templates bundled with ANH | Read-only (do not edit) |
| `<workspace>/novel-helper/templates/typst/` | Project-level external templates | `andrea.typst.externalTemplatesDir` |

**Default external template root:** `<workspace-root>/novel-helper/templates/typst/`

To add a custom template, create a subdirectory (or a single file) under the **external templates root**.

---

## 3. Template Formats

### Format A: Package directory (recommended)

A directory containing `template.json` and a Liquid entry file:

```
novel-helper/templates/typst/
└── my-template/
    ├── template.json          ← metadata & config
    └── entry.typ.liquid       ← main Liquid template
```

**`template.json` fields:**

```json
{
  "name": "my-template",
  "engine": "liquid",
  "entry": "entry.typ.liquid",
  "mapping": "inline",
  "defaults": {
    "ppi": 144
  }
}
```

| Field | Required | Description |
|---|---|---|
| `name` | Yes | Template identifier (used in settings and commands) |
| `engine` | Yes | Always `"liquid"` |
| `entry` | Yes | Entry Liquid file path relative to the template directory |
| `mapping` | No | Always `"inline"` in current built-ins |
| `defaults` | No | Default values for template-level settings (e.g. `ppi`) |

### Format B: Single-file template

A single `.typ.liquid` file, placed either directly in the templates root or inside a subdirectory:

```
novel-helper/templates/typst/
└── my-template/
    └── my-template.typ.liquid     ← single-file template (no template.json needed)
```

Or as a flat file:

```
novel-helper/templates/typst/
└── my-template.typ.liquid
```

A single-file template may optionally contain an **inline meta header** to set its name:

```liquid
--- meta ---
{"name": "my-template", "entry": "entry"}
--- end ---

#set page(width: 21cm, height: 29.7cm, margin: 2cm)
...rest of template...
```

A single-file template may also be split into a **prelude** and an **entry** part using part markers:

```liquid
--- part: prelude ---
// shared definitions go here
#let my-fn() = { ... }

--- part: entry ---
// the main document body
#my-fn()
...
```

Both parts are combined before rendering, with the prelude prepended to the entry.

---

## 4. The Liquid Rendering Context

Every template receives a `ctx` object with two top-level keys: **`meta`** and **`blocks`**.

### 4a. `meta` — Document Metadata

`meta` is a flat key-value map. Values come from three sources (later sources override earlier):

1. **Auto-derived from the document:** `title` (from first `# heading`), `filename`, `doc_dir`
2. **`&Def` directives** in the Markdown source (see Section 5)
3. **Template defaults** from `template.json` `defaults` object

**Common `meta` keys:**

| Key | Source | Description |
|---|---|---|
| `meta.title` | Auto (first H1) | Document title |
| `meta.filename` | Auto | Source filename without extension |
| `meta.doc_dir` | Auto | Absolute directory of the source file |
| `meta.assets_dir` | Auto | Temp directory for copied image assets |
| `meta.subtitle` | `&Def subtitle = ...` | Subtitle |
| `meta.category` | `&Def category = ...` | Category / section label |
| `meta.text_font` | `&Def text_font = ...` | Body text font name |
| `meta.heading_font` | `&Def heading_font = ...` | Heading font name |
| `meta.text_size` | `&Def text_size = ...` | Body text size (number, pt) |
| `meta.title_size` | `&Def title_size = ...` | Title size (number, pt) |
| `meta.sub_size` | `&Def sub_size = ...` | Subtitle/caption size (number, pt) |
| `meta.line_height` | `&Def line_height = ...` | Line height multiplier |
| `meta.mono_font` | `&Def mono_font = ...` | Monospace font name |
| `meta.auto_time` | `&Def auto_time = ...` | Default time for forum dialog blocks |
| `meta.main_title_text` | `&Def main_title_text = ...` | H1 text to suppress (already shown in header) |
| `meta.ppi` | Template defaults | PNG PPI (dots per inch) |

**In Liquid templates, access with:** `{{ meta.title }}`, `{{ meta.text_size | default: 18 }}`, etc.

### 4b. `blocks` — Parsed Content Blocks

`blocks` is an array of typed block objects produced by the Markdown parser. Each block has a `type` field.

**Block types:**

#### `heading`
```liquid
{% if b.type == 'heading' %}
  #heading(level: {{ b.level }}, [{{ b.text }}])
{% endif %}
```
| Field | Type | Description |
|---|---|---|
| `b.level` | `1`–`6` | Heading depth |
| `b.text` | string | Heading text (raw Markdown inline) |

#### `paragraph`
```liquid
{% elsif b.type == 'paragraph' %}
  {{ b.text | md2typst }}
{% endif %}
```
| Field | Type | Description |
|---|---|---|
| `b.text` | string | Paragraph text (may contain inline Markdown: `**bold**`, `_italic_`, `[link](url)`) |

#### `list`
```liquid
{% elsif b.type == 'list' %}
  {% if b.ordered %}
    {% for it in b.items %}{{ forloop.index }}. {{ it | md2typst }}{% endfor %}
  {% else %}
    {% for it in b.items %}• {{ it | md2typst }}{% endfor %}
  {% endif %}
{% endif %}
```
| Field | Type | Description |
|---|---|---|
| `b.ordered` | boolean | `true` = numbered list |
| `b.items` | string[] | List item texts |

#### `code`
```liquid
{% elsif b.type == 'code' %}
  #set text(font: "Consolas", size: 12pt)
  [{{ b.code }}]
{% endif %}
```
| Field | Type | Description |
|---|---|---|
| `b.lang` | string? | Fenced code language hint |
| `b.code` | string | Code content |

#### `blockquote`
```liquid
{% elsif b.type == 'blockquote' %}
  #box(inset: 8pt)[{{ b.text | md2typst }}]
{% endif %}
```
| Field | Type | Description |
|---|---|---|
| `b.text` | string | Blockquote text |

#### `image`
```liquid
{% elsif b.type == 'image' %}
  #image("{{ b.src | imgpath: meta.doc_dir, meta.assets_dir }}")
{% endif %}
```
| Field | Type | Description |
|---|---|---|
| `b.alt` | string | Alt text |
| `b.src` | string | Image path or URL |

#### `hr`
```liquid
{% elsif b.type == 'hr' %}
  #line(length: 100%, stroke: 0.6pt + rgb(229, 231, 235))
{% endif %}
```

#### `dialog` (forum-thread style)

Forum-thread blocks are written in the source Markdown with the `@user: text` syntax:

```markdown
@Alice[2025-01-01]: 这是第一层回复
> @Bob[2024-12-31]: 被引用的内容
继续 Alice 的发言
```

In the template:

```liquid
{% if b.type == 'dialog' %}
  // speaker: {{ b.user }}
  // time: {{ b.time }}
  // text: {{ b.text | md2typst | forum }}
  // quotes: see b.quotes array below
{% endif %}
```

| Field | Type | Description |
|---|---|---|
| `b.user` | string | Speaker / username |
| `b.time` | string? | Timestamp in brackets (e.g. `2025-01-01`) |
| `b.text` | string | Dialog body text |
| `b.quotes` | QuoteEntry[]? | Quoted/nested replies |

**QuoteEntry fields:**

| Field | Type | Description |
|---|---|---|
| `q.level` | number | Quote nesting depth (`>` count) |
| `q.user` | string? | Quoted username |
| `q.time` | string? | Quoted timestamp |
| `q.text` | string | Quoted text |

---

## 5. `&Def` Directives

In any Markdown source file, you can set `meta` values using `&Def` directives. These lines are stripped from the parsed content before block extraction — they are metadata only.

**Syntax:**

```markdown
&Def title = 我的文章
&Def subtitle = 副标题
&Def category = 奇幻
&Def text_size = 16
&Def main_title_text = 我的文章
```

- Key names are **case-insensitive** and stored in lowercase.
- Special aliases: `主标题` → `defTitle` (overrides auto-derived title), `副标题` → `subtitle`.
- Any other key is stored as `def_<key>` on `meta`.

---

## 6. Liquid Custom Filters

Three custom filters are available in all ANH Liquid templates:

### `md2typst`

Converts Markdown inline syntax to Typst inline syntax.

| Input | Output |
|---|---|
| `**bold**` | `#text(lang: "zh", weight: "bold")[bold]` |
| `__bold__` | `#text(lang: "zh", weight: "bold")[bold]` |
| `*italic*` | `#text(lang: "zh", style: "italic")[italic]` |
| `_italic_` | `#text(lang: "zh", style: "italic")[italic]` |
| `[label](url)` | `#link("url", [label])` |

Usage: `{{ b.text | md2typst }}`

### `forum`

Converts `@username` mentions to coloured Typst text (blue: `rgb(37, 99, 235)`).

Usage: `{{ b.text | md2typst | forum }}`

### `imgpath`

Resolves an image path for use in a Typst `#image()` call. Handles:
- Absolute paths (returned as-is with forward slashes)
- Relative paths (resolved from `doc_dir`)
- Falls back to `<doc_dir>/images/<filename>` if path not found
- If `assets_dir` is provided, copies the image there and returns a relative `./assets/<filename>` path

Usage: `{{ b.src | imgpath: meta.doc_dir, meta.assets_dir }}`

Always use `imgpath` for image blocks to ensure the Typst compiler can find the image file.

---

## 7. VS Code Settings

| Setting | Default | Description |
|---|---|---|
| `andrea.typst.cliPath` | `"typst"` | Path to the Typst CLI binary |
| `andrea.typst.defaultTemplate` | `"sample"` | Default template name |
| `andrea.typst.externalTemplatesDir` | `"${workspaceFolder}/novel-helper/templates/typst"` | External project templates directory |
| `andrea.typst.templatesDir` | `"${workspaceFolder}/templates/typst"` | Alternative external templates root (rarely used) |
| `andrea.typst.output.format` | `"pdf"` | Export format: `pdf`, `png`, `svg`, `html` |
| `andrea.typst.output.ppi` | `144` | PNG export resolution (PPI) |
| `andrea.typst.pages` | `""` | Page range, e.g. `"2,3-6,8-"` |
| `andrea.typst.font.paths` | `[]` | Extra font search paths |
| `andrea.typst.cleanupTemp` | `false` | Delete `build/typst/tmp-*` after export |
| `andrea.typst.preview.storage` | `"memory"` | Preview storage: `memory` (virtual FS) or `file` |
| `andrea.typst.preview.tempDir` | `"${workspaceFolder}/build/typst/preview"` | Preview temp dir when `storage = "file"` |

---

## 8. Built-In Templates

| Name | Description |
|---|---|
| `sample` | Basic A4 document with headings and paragraphs |
| `sample-single` | Single-file variant of `sample` (no `template.json`) |
| `article-card` | Card layout with title, category, subtitle, body text |
| `forum-thread` | Forum/BBS style with `@user:` dialog blocks |
| `title-only` | Title + subtitle header followed by body text |

All built-in templates are located under `<extensionDir>/templates/typst/`. **Do not edit these.** Create custom templates in the external templates directory instead.

---

## 9. Preview Integration

ANH supports **live preview** of the generated Typst source via the VS Code Typst extension:

- When `andrea.typst.preview.storage = "memory"` (default), the rendered `.typ` source is stored on an in-memory virtual filesystem at `andrea-typst://typst/current/<docname>.typ`.
- The Typst VS Code extension can open and preview this URI in real time.
- When storage is `"file"`, the `.typ` file is written to the configured `preview.tempDir` on disk.

Use the command **`andrea.typst.exportCurrent`** to trigger an export from the active editor.

---

## 10. Common Tasks

### Create a new template from scratch

1. Create a directory: `<workspace>/novel-helper/templates/typst/<my-template>/`
2. Create `template.json`:
   ```json
   {
     "name": "my-template",
     "engine": "liquid",
     "entry": "entry.typ.liquid",
     "mapping": "inline",
     "defaults": { "ppi": 144 }
   }
   ```
3. Create `entry.typ.liquid`. Start from the `sample` template as a base (see Section 8). At minimum include:
   ```liquid
   #set page(width: 21cm, height: 29.7cm, margin: 2cm)

   {% for b in blocks %}
   {% if b.type == 'heading' %}
   #heading(level: {{ b.level | default: 1 }}, [{{ b.text }}])
   {% elsif b.type == 'paragraph' %}
   {{ b.text | md2typst }}
   {% endif %}
   {% endfor %}
   ```
4. ANH auto-detects the new template. Trigger a rescan via the command **`andrea.typst.refreshTemplates`** if it doesn't appear immediately.

### Create a single-file template

1. Create `<workspace>/novel-helper/templates/typst/my-template.typ.liquid`
2. Optionally add an inline meta header:
   ```
   --- meta ---
   {"name": "my-template"}
   --- end ---
   ```
3. Write the full Typst + Liquid template below the meta block.

### Override font in a template

Use `meta` variables to let the document control fonts via `&Def` directives:

```liquid
#set text(
  font: "{{ meta.text_font | default: 'Noto Sans SC' }}",
  size: {{ meta.text_size | default: 18 }}pt
)
```

The user can then write `&Def text_font = Source Han Serif SC` in their document.

### Handle all block types safely

Use an `{% if %}` / `{% elsif %}` chain in the `{% for b in blocks %}` loop:

```liquid
{% for b in blocks %}
{% if b.type == 'heading' %}
  #heading(level: {{ b.level | default: 1 }}, [{{ b.text }}])
{% elsif b.type == 'paragraph' %}
  {{ b.text | md2typst }}
{% elsif b.type == 'list' %}
  {% for it in b.items %}• {{ it | md2typst }}
  {% endfor %}
{% elsif b.type == 'code' %}
  #set text(font: "Consolas"); [{{ b.code }}]
{% elsif b.type == 'blockquote' %}
  #box(inset: 8pt)[{{ b.text | md2typst }}]
{% elsif b.type == 'image' %}
  #image("{{ b.src | imgpath: meta.doc_dir, meta.assets_dir }}")
{% elsif b.type == 'hr' %}
  #line(length: 100%)
{% endif %}
{% endfor %}
```

---

## 11. Key Rules

1. **Never edit built-in templates** under `<extensionDir>/templates/typst/`. Create custom templates in the project's external templates directory.
2. **`template.json` is required** for package-directory templates. Without it, ANH will only detect the template if a `.typ.liquid` file exists directly in the folder.
3. **Always use `| imgpath`** on image sources to ensure they resolve correctly for the Typst compiler.
4. **Use `| md2typst`** on all paragraph/list/dialog text to correctly convert bold, italic, and link syntax to Typst.
5. **`meta.main_title_text`** — if the document's H1 text matches this value, the heading block is suppressed in the loop (because it was already displayed in the template header). Set this if your template renders the title separately.
6. **Liquid template errors silently fall back** — if rendering fails, an empty string is returned (no crash), but the Typst compile step will produce an empty or broken document.
7. **The `assets_dir` is a temp directory** created fresh each compile. Images are copied there so that the Typst compiler (which runs in a temp directory) can find them. Always pass `meta.assets_dir` as the second argument to `imgpath`.
