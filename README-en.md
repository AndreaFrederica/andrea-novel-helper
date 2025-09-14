# Andrea Novel Helper

[![Version](https://img.shields.io/visual-studio-marketplace/v/AndreaZhang.andrea-novel-helper)](https://marketplace.visualstudio.com/items?itemName=AndreaZhang.andrea-novel-helper)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/AndreaZhang.andrea-novel-helper)](https://marketplace.visualstudio.com/items?itemName=AndreaZhang.andrea-novel-helper)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/AndreaZhang.andrea-novel-helper)](https://marketplace.visualstudio.com/items?itemName=AndreaZhang.andrea-novel-helper)

> 🚀 **Major Update: Added WebDAV cloud synchronization feature, supporting cross-device collaborative writing without relying on Git!**

A powerful VS Code extension designed specifically for novel writing, providing comprehensive character management, word count statistics, sensitive word detection, and many other practical features to enhance your creative writing experience.

## ✨ Core Features

### 📚 Character Management
- **Smart Character Recognition**: Automatically identify and highlight character names in your text
- **Character Library**: Support for multiple formats (Markdown, TXT, JSON5) to manage character information
- **Quick Navigation**: Jump to character definitions with one click
- **Auto-completion**: Intelligent character name suggestions while typing
- **Color Coding**: Assign unique colors to different characters for better visual distinction

### 📊 Writing Statistics
- **Real-time Word Count**: Track character count, word count, and paragraph statistics
- **Progress Tracking**: Monitor your daily writing progress
- **Time Statistics**: Record writing time and efficiency analysis
- **Visual Charts**: Intuitive data visualization of your writing habits

### 🔍 Content Detection
- **Sensitive Word Detection**: Built-in sensitive word library with customizable rules
- **Vocabulary Management**: Create and manage custom vocabulary lists
- **Regex Pattern Matching**: Advanced text pattern recognition and replacement
- **Content Filtering**: Flexible content filtering and highlighting
- **Typo Statistics**: Intelligent identification and statistics of typos in documents, providing detailed error analysis and correction suggestions

### 🎨 Writing Enhancement
- **Markdown Toolbar**: Rich text formatting tools
- **Smart Auto-pairing**: Intelligent bracket and quote pairing
- **Comment System**: Add and manage comments within your manuscripts
- **Preview Mode**: Real-time Markdown preview with character highlighting
- **Annotation Feature**: Support adding, editing, and managing annotations in documents for notes and collaborative communication during writing

### 🔄 Synchronization & Backup
- **WebDAV Sync**: Synchronize your work across multiple devices
- **Cloud Storage**: Support for various cloud storage services
- **Version Control**: Git integration for manuscript version management
- **Backup Management**: Automatic backup and recovery features

## 🚀 Quick Start

### Installation
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "Andrea Novel Helper"
4. Click Install

### First Setup
When you open an empty workspace, the Project Initialization Wizard will automatically appear to guide you through the setup process. You can also manually start it using:
- Command Palette (Ctrl+Shift+P) → "Andrea Novel Helper: Project Setup Wizard"
- Or use the "Get Started" walkthrough in the Welcome tab

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
      "pattern": "\"[^\"]*\"",
      "description": "Matches quoted dialogue"
    }
  }
}
```

## 🛠️ Other Useful Tools

### Markdown Toolbar
- Quick formatting buttons for headers, lists, links, etc.
- Character insertion shortcuts
- Custom snippet support

### Comment System
- Add inline comments to your manuscripts
- Track revision notes and feedback
- Collaborative writing support

### Time Statistics
- Track writing sessions and productivity
- Set daily writing goals
- Analyze writing patterns and habits

## ⚙️ Configuration

Access extension settings through:
- File → Preferences → Settings → Extensions → Andrea Novel Helper
- Or use Command Palette: "Preferences: Open Settings (UI)"

### Key Settings
- **Character Detection**: Enable/disable automatic character recognition
- **Word Count Display**: Customize word count display format
- **Sensitive Word Filtering**: Configure content filtering rules
- **Sync Settings**: Set up WebDAV synchronization
- **UI Customization**: Adjust colors, fonts, and layout preferences

## 🤝 Contributing & Feedback

### 📢 Community Discussion
Join our community discussions on [GitHub Discussions](https://github.com/AndreaZhang2024/andrea-novel-helper/discussions) to:
- Share feature requests and suggestions
- Exchange writing tips and experiences
- Get help from other users
- Discuss best practices for novel writing in VS Code

### 🐛 Issue Reporting
For bug reports and feature requests, please use:
- **GitHub Issues**: Report bugs, request features, and track development progress
- **Pull Requests**: Contribute code improvements and new features

### Development
Want to contribute? Check out our [development guide](https://github.com/AndreaZhang2024/andrea-novel-helper) for:
- Setting up the development environment
- Code contribution guidelines
- Testing procedures
- Release process

## 📺 Demonstrations (Partially Using Legacy Examples)

### Legacy Examples

The following demonstrations are from version 0.0.x, showcasing the core functionality of the extension:

- **Creating Characters**
  ![Creating Characters](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/%E5%88%9B%E5%BB%BA%E8%A7%92%E8%89%B2.gif)

- **Creating Colors for Characters**
  ![Creating Colors for Characters](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/为角色创建颜色.gif)

- **Chinese Word Segmentation**
  ![Chinese Word Segmentation](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/中文分词.gif)

- **Auto-completion**
  ![Auto-completion](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/自动补全.gif)

- **Jump to Definition**
  ![Jump to Definition](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/转跳定义.gif)

- **Word Count Statistics**
  ![Word Count Statistics](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/字数统计.gif)

- **Sensitive Word Detection**
  ![Sensitive Word Detection](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/敏感词识别.gif)

- **Experimental Outline**
  ![Experimental Outline](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/实验性大纲.gif)

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Thanks to all contributors and beta testers
- Special thanks to the VS Code extension development community
- Inspired by the needs of creative writers worldwide

---

**Happy Writing! 📝✨**

For more information, visit our [GitHub repository](https://github.com/AndreaZhang2024/andrea-novel-helper) or check out the [VS Code Marketplace page](https://marketplace.visualstudio.com/items?itemName=AndreaZhang.andrea-novel-helper).