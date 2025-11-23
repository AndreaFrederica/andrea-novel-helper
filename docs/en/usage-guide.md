## 📖 Usage Guide

### Character Library Setup
Create character files in your project directory. The extension supports multiple formats:

#### Markdown Format Example
```markdown
# Alicia

## Description
Alicia is a mysterious mage with silver hair and deep blue eyes. She possesses ancient magical knowledge and serves as a mentor to the protagonist.

## Appearance
- **Hair**: Long silver hair that shimmers in moonlight
- **Eyes**: Deep blue eyes that seem to hold ancient wisdom
- **Height**: 165cm
- **Clothing**: Usually wears a dark blue robe with silver embroidery

## Personality
- Wise and patient, but can be stern when necessary
- Has a dry sense of humor
- Deeply cares for her students despite her aloof exterior
- Haunted by past mistakes

## Background
- Former court mage of the fallen kingdom of Astoria
- Lost her homeland in a magical catastrophe she partially caused
- Now dedicates her life to preventing similar disasters
- Has been alive for over 300 years due to magical longevity

## Abilities
- **Elemental Magic**: Master of ice and wind magic
- **Divination**: Can glimpse possible futures
- **Magical Theory**: Extensive knowledge of magical principles
- **Combat**: Skilled in magical combat and strategy

## Relationships
- **Protagonist**: Reluctant mentor, grows to see them as family
- **Marcus**: Old friend and fellow survivor of Astoria
- **Council of Mages**: Maintains a tense relationship due to past events
```

### Package Manager

The extension includes a powerful package management system for organizing your writing resources:

#### 📦 Core Features
- **Multi-format Support**: Handles Markdown (.md), Text (.txt), and JSON5 (.json5) files
- **Intelligent Scanning**: Automatically detects and imports character libraries, vocabulary lists, and configuration files
- **Hierarchical Organization**: Supports nested folder structures for better resource management
- **Real-time Updates**: Automatically refreshes when files are added, modified, or removed

#### 📁 Resource Types

| Resource Type | File Extensions | Keywords | Description |
|---------------|----------------|----------|-------------|
| **Character Library** | `.md`, `.txt`, `.json5` | `role`, `character`, `人物`, `角色` | Character definitions and profiles |
| **Sensitive Words** | `.txt`, `.json5` | `sensitive`, `敏感`, `屏蔽` | Content filtering and moderation lists |
| **Vocabulary** | `.md`, `.txt`, `.json5` | `vocabulary`, `vocab`, `词汇`, `术语` | Custom terminology and word lists |
| **Regex Patterns** | `.json5`, `.txt` | `regex`, `pattern`, `正则`, `规则` | Text pattern matching rules |

#### 🏗️ Recommended Package Structure

```
novel-project/
├── characters/
│   ├── main-characters.md
│   ├── supporting-roles.json5
│   └── antagonists/
│       ├── villain-profiles.md
│       └── minor-enemies.txt
├── settings/
│   ├── world-building.md
│   ├── locations.json5
│   └── cultures/
│       ├── kingdom-north.md
│       └── empire-south.md
├── vocabulary/
│   ├── magic-terms.md
│   ├── technical-vocab.json5
│   └── specialized/
│       ├── medical-terms.txt
│       └── military-ranks.md
├── filters/
│   ├── sensitive-words.txt
│   ├── content-filters.json5
│   └── regex-patterns.json5
└── manuscripts/
    ├── chapter-01.md
    ├── chapter-02.md
    └── drafts/
```

#### 📝 Example Character Entry

**Markdown Format** (`characters/protagonist.md`):
```markdown
# Elena Brightblade

## Basic Info
- **Age**: 22
- **Occupation**: Knight Apprentice
- **Origin**: Village of Millbrook

## Physical Description
- **Height**: 170cm
- **Hair**: Auburn, shoulder-length
- **Eyes**: Green with gold flecks
- **Build**: Athletic, trained fighter

## Personality Traits
- Determined and brave
- Sometimes impulsive
- Strong sense of justice
- Loyal to friends and family

## Background
- Grew up in a small farming village
- Lost parents in a monster attack
- Trained under Sir Marcus the Bold
- Seeks to become a full knight

## Skills & Abilities
- **Swordsmanship**: Advanced level
- **Magic**: Minor healing abilities
- **Leadership**: Natural charisma
- **Tactics**: Basic military strategy
```

**JSON5 Format** (`characters/supporting-cast.json5`):
```json5
{
  // Supporting Characters
  characters: [
    {
      name: "Sir Marcus the Bold",
      role: "Mentor",
      age: 45,
      description: "Veteran knight and Elena's trainer",
      personality: ["Wise", "Patient", "Strict but fair"],
      background: "Former royal guard, now trains new knights",
      color: "#4A90E2" // Blue theme
    },
    {
      name: "Lyra Moonwhisper",
      role: "Mage Ally",
      age: 28,
      description: "Elven mage specializing in nature magic",
      personality: ["Mysterious", "Kind-hearted", "Protective of nature"],
      abilities: ["Plant magic", "Healing", "Animal communication"],
      color: "#50C878" // Green theme
    }
  ]
}
```

#### 📚 Markdown & TXT Syntax

**Character Recognition Patterns**:
- Headers: `# Character Name`, `## Character Name`
- Bullet points: `- Name: Character Name`
- Key-value: `Name: Character Name`, `角色: Character Name`
- JSON-like: `"name": "Character Name"`

**Supported Field Aliases**:
- **Name**: `name`, `名字`, `姓名`, `角色名`, `character`, `role`
- **Description**: `description`, `desc`, `描述`, `简介`, `介绍`
- **Age**: `age`, `年龄`, `岁数`
- **Appearance**: `appearance`, `外貌`, `外观`, `长相`
- **Personality**: `personality`, `性格`, `个性`, `特点`
- **Background**: `background`, `背景`, `经历`, `历史`
- **Abilities**: `abilities`, `ability`, `技能`, `能力`, `特长`
- **Color**: `color`, `colour`, `颜色`, `主题色`

#### 📋 File Naming Conventions

**Effective Naming Examples**:
- `main-characters.md` ✅
- `world-roles.json5` ✅
- `character-gallery.txt` ✅
- `supporting-cast.md` ✅

**Avoid These Patterns**:
- `role.md` ❌ (too generic)
- `a.txt` ❌ (not descriptive)
- `temp.json5` ❌ (temporary naming)

**Developer Note**: The keyword list for parsing detection is in the source code constant `roleKeywords` in `src/utils/utils.ts`.

Files are only scanned when the filename (lowercase) contains any of these substrings and has a valid extension. If you compile the extension yourself and want to extend keywords, modify this array and repackage (don't forget to update the README table for consistency).

Quick naming reference:
```
novel-helper/
  main/character-gallery.json5
  main/world_roles.md
  main/sensitive-words.txt
  main/tech_vocabulary.md
  main/regex-patterns.json5
```

### Image Path Processing
Relative images in Markdown `![](images/a.png)` are automatically converted to absolute `file://` URIs for more stable hover/rendering.

### Color Field Parsing
Supports: HEX (#RGB/#RRGGBB/#RRGGBBAA/#RGBA), rgb()/rgba(), hsl()/hsla(), hsv()/hsva(); can extract colors even when mixed with text (`#ff1e40 (primary color)`).

### Custom / Extended Fields

The extension supports custom field parsing strategies:

1. **Standard Fields**: Automatically recognized common fields (name, description, age, etc.)
2. **Custom Fields**: Any additional fields in your character files are preserved and accessible
3. **Nested Objects**: JSON5 format supports complex nested data structures
4. **Arrays**: Support for list-type data (skills, relationships, etc.)
5. **Metadata**: File-level metadata and tags for organization

#### Complex Configuration Example (JSON5)

```json5
{
  // Character Library Configuration
  "characterLibrary": {
    "version": "2.1",
    "lastUpdated": "2024-01-15",
    "categories": {
      "protagonists": {
        "color": "#FF6B6B",
        "priority": 1
      },
      "antagonists": {
        "color": "#4ECDC4", 
        "priority": 2
      }
    }
  },
  
  // Sensitive Word Library
  "sensitiveWords": {
    "enabled": true,
    "categories": {
      "violence": ["kill", "murder", "blood"],
      "profanity": ["damn", "hell"],
      "custom": ["placeholder1", "placeholder2"]
    },
    "severity": {
      "high": ["extreme content"],
      "medium": ["moderate content"],
      "low": ["mild content"]
    }
  },
  
  // Vocabulary Library
  "vocabulary": {
    "technical": {
      "magic": ["mana", "spell", "enchantment"],
      "combat": ["sword", "shield", "armor"]
    },
    "worldBuilding": {
      "locations": ["kingdom", "castle", "village"],
      "cultures": ["elven", "dwarven", "human"]
    }
  },
  
  // Regex Rules
  "regexRules": {
    "namePatterns": {
      "pattern": "\\b[A-Z][a-z]+\\s[A-Z][a-z]+\\b",
      "description": "Matches full names (First Last)"
    },
    "dialogueMarkers": {
      "pattern": '"[^"\\]*"',
      "description": "Matches quoted dialogue"
    }
  }
}
```
