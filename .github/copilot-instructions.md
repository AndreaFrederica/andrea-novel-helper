# Andrea Novel Helper (ANH) — Copilot Context

This repository is the source of **Andrea Novel Helper (ANH)**, a VS Code extension that turns VS Code into a professional novel-writing IDE. It provides character/vocabulary/sensitivity-word management, reference tracking, async highlighting, dual outline views, writing-time and word-count statistics, regex completion, file tracking, timelines, and character-relationship graphs.

## Key Directories

| Path | Contents |
|---|---|
| `src/` | Extension TypeScript source (VS Code extension API) |
| `templates/typst/` | Built-in Typst export templates |
| `syntaxes/` | TextMate grammar injections for ANH Markdown extensions |
| `.github/agents/` | Deep-knowledge skill files for the GitHub Copilot coding agent |
| `.github/prompts/` | VS Code Copilot Chat prompt files (use `/` commands below) |

## ANH Project Structure (consumer side)

When a user opens a novel project with ANH installed, the workspace contains:

- `anhproject.md` — project config (Markdown with `##` section keys)
- `novel-helper/` — ANH data root: character packages, `mcp.json`, file-tracking DB
- `novel-helper/scripts/` — user automation scripts (Script Runner)
- `novel-helper/templates/typst/` — user-created Typst export templates

## Available Prompt Files

For deeper context on specific subsystems, attach the relevant prompt in Copilot Chat:

| Command | Topic |
|---|---|
| `/anh-project` | Project file formats: `anhproject.md`, character files (JSON5/Markdown/OJSON5), relationship graphs, file-tracking DB |
| `/anh-script-runtime` | Script Runner: `run(ctx, args)` contract, `ctx` API, MCP client integration, `mcp.json` schema |
| `/anh-typst-templates` | Typst export templates: Liquid rendering context, block types, custom filters (`md2typst`, `forum`, `imgpath`), built-in templates |

## Language

ANH's UI strings are primarily in Chinese (Simplified). Code, settings keys, and API surface are in English.
