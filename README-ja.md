# Andrea Novel Helper（小説アシスタント）

[![Version](https://img.shields.io/visual-studio-marketplace/v/AndreaZhang.andrea-novel-helper)](https://marketplace.visualstudio.com/items?itemName=AndreaZhang.andrea-novel-helper)
[![Downloads](https://img.shields.io/visual-studio-marketplace/d/AndreaZhang.andrea-novel-helper)](https://marketplace.visualstudio.com/items?itemName=AndreaZhang.andrea-novel-helper)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/AndreaZhang.andrea-novel-helper)](https://marketplace.visualstudio.com/items?itemName=AndreaZhang.andrea-novel-helper)

> 🚀 **重要なアップデート：WebDAVクラウド同期機能を追加、Gitに依存しないクロスデバイス協作執筆をサポート！**

小説執筆に特化して設計された強力なVS Code拡張機能です。包括的なキャラクター管理、文字数統計、センシティブワード検出、その他多くの実用的な機能を提供し、創作体験を向上させます。

## ✨ 主要機能

### 📚 キャラクター管理
- **スマートキャラクター認識**: テキスト内のキャラクター名を自動識別・ハイライト
- **キャラクターライブラリ**: 複数形式（Markdown、TXT、JSON5）でキャラクター情報を管理
- **クイックナビゲーション**: ワンクリックでキャラクター定義にジャンプ
- **自動補完**: 入力中のインテリジェントなキャラクター名提案
- **カラーコーディング**: 異なるキャラクターに固有の色を割り当てて視覚的に区別

### 📊 執筆統計
- **リアルタイム文字数カウント**: 文字数、単語数、段落統計を追跡
- **進捗追跡**: 日々の執筆進捗を監視
- **時間統計**: 執筆時間と効率分析を記録
- **視覚的チャート**: 執筆習慣の直感的なデータ可視化

### 🔍 コンテンツ検出
- **センシティブワード検出**: カスタマイズ可能なルールを持つ内蔵センシティブワードライブラリ
- **語彙管理**: カスタム語彙リストの作成と管理
- **正規表現パターンマッチング**: 高度なテキストパターン認識と置換
- **コンテンツフィルタリング**: 柔軟なコンテンツフィルタリングとハイライト
- **誤字統計機能**: 文書内の誤字を智能的に識別・統計し、詳細なエラー分析と修正提案を提供

### 🎨 執筆強化
- **Markdownツールバー**: リッチテキスト書式設定ツール
- **スマート自動ペアリング**: インテリジェントな括弧と引用符のペアリング
- **コメントシステム**: 原稿内でのコメント追加と管理
- **プレビューモード**: キャラクターハイライト付きリアルタイムMarkdownプレビュー
- **注釈機能**: 文書内での注釈の追加、編集、管理をサポート、執筆過程でのメモや協作交流に便利

### 🔄 同期とバックアップ
- **WebDAV同期**: 複数デバイス間での作業同期
- **クラウドストレージ**: 様々なクラウドストレージサービスをサポート
- **バージョン管理**: 原稿バージョン管理のためのGit統合
- **バックアップ管理**: 自動バックアップと復旧機能

## 🚀 クイックスタート

### インストール
1. VS Codeを開く
2. 拡張機能に移動（Ctrl+Shift+X）
3. "Andrea Novel Helper"を検索
4. インストールをクリック

### 初期設定
空のワークスペースを開くと、プロジェクト初期化ウィザードが自動的に表示され、設定プロセスをガイドします。手動で開始することも可能です：
- コマンドパレット（Ctrl+Shift+P）→「Andrea Novel Helper: Project Setup Wizard」
- またはウェルカムタブの「Get Started」ウォークスルーを使用

## 📖 使用ガイド

### キャラクターライブラリ設定
プロジェクトディレクトリにキャラクターファイルを作成します。拡張機能は複数の形式をサポートしています：

#### Markdown形式の例
```markdown
# アリシア

## 説明
アリシアは銀髪と深い青い瞳を持つ神秘的な魔法使いです。古代の魔法知識を持ち、主人公の師として仕えています。

## 外見
- **髪**: 月光に輝く長い銀髪
- **瞳**: 古代の知恵を宿しているような深い青い瞳
- **身長**: 165cm
- **服装**: 通常は銀の刺繍が施された濃紺のローブを着用

## 性格
- 賢明で忍耐強いが、必要な時は厳格になることも
- 辛辣なユーモアのセンスを持つ
- よそよそしい外見にも関わらず、生徒を深く気にかけている
- 過去の過ちに悩まされている

## 背景
- 滅亡したアストリア王国の元宮廷魔法使い
- 部分的に自分が原因となった魔法的大災害で故郷を失う
- 現在は同様の災害を防ぐことに人生を捧げている
- 魔法による長寿により300年以上生きている

## 能力
- **元素魔法**: 氷と風の魔法の達人
- **占術**: 可能な未来を垣間見ることができる
- **魔法理論**: 魔法原理の広範な知識
- **戦闘**: 魔法戦闘と戦略に熟練

## 関係性
- **主人公**: 不本意な師だが、家族のように思うようになる
- **マーカス**: アストリアの古い友人で仲間の生存者
- **魔法使い評議会**: 過去の出来事により緊張した関係を維持
```

### パッケージマネージャー

拡張機能には、執筆リソースを整理するための強力なパッケージ管理システムが含まれています：

#### 📦 主要機能
- **マルチフォーマットサポート**: Markdown（.md）、テキスト（.txt）、JSON5（.json5）ファイルを処理
- **インテリジェントスキャン**: キャラクターライブラリ、語彙リスト、設定ファイルを自動検出・インポート
- **階層組織**: より良いリソース管理のためのネストされたフォルダ構造をサポート
- **リアルタイム更新**: ファイルの追加、変更、削除時に自動更新

#### 📁 リソースタイプ

| リソースタイプ | ファイル拡張子 | キーワード | 説明 |
|---------------|----------------|----------|------|
| **キャラクターライブラリ** | `.md`, `.txt`, `.json5` | `role`, `character`, `人物`, `角色` | キャラクター定義とプロフィール |
| **センシティブワード** | `.txt`, `.json5` | `sensitive`, `敏感`, `屏蔽` | コンテンツフィルタリングとモデレーションリスト |
| **語彙** | `.md`, `.txt`, `.json5` | `vocabulary`, `vocab`, `词汇`, `术语` | カスタム用語と単語リスト |
| **正規表現パターン** | `.json5`, `.txt` | `regex`, `pattern`, `正则`, `规则` | テキストパターンマッチングルール |

#### 🏗️ 推奨パッケージ構造

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

#### 📝 キャラクターエントリの例

**Markdown形式**（`characters/protagonist.md`）：
```markdown
# エレナ・ブライトブレード

## 基本情報
- **年齢**: 22歳
- **職業**: 騎士見習い
- **出身**: ミルブルック村

## 身体的特徴
- **身長**: 170cm
- **髪**: 肩までの赤褐色
- **瞳**: 金の斑点がある緑色
- **体格**: 運動選手的、訓練された戦士

## 性格特性
- 決意が固く勇敢
- 時々衝動的
- 強い正義感
- 友人と家族に忠実

## 背景
- 小さな農村で育つ
- モンスターの攻撃で両親を失う
- 勇敢なるマーカス卿の下で訓練
- 正式な騎士になることを目指している

## スキルと能力
- **剣術**: 上級レベル
- **魔法**: 軽微な治癒能力
- **リーダーシップ**: 天性のカリスマ
- **戦術**: 基本的な軍事戦略
```

**JSON5形式**（`characters/supporting-cast.json5`）：
```json5
{
  // サポートキャラクター
  characters: [
    {
      name: "勇敢なるマーカス卿",
      role: "師匠",
      age: 45,
      description: "ベテラン騎士でエレナの訓練者",
      personality: ["賢明", "忍耐強い", "厳格だが公正"],
      background: "元王室警備隊、現在は新人騎士を訓練",
      color: "#4A90E2" // 青テーマ
    },
    {
      name: "リラ・ムーンウィスパー",
      role: "魔法使いの仲間",
      age: 28,
      description: "自然魔法を専門とするエルフの魔法使い",
      personality: ["神秘的", "心優しい", "自然を保護する"],
      abilities: ["植物魔法", "治癒", "動物との意思疎通"],
      color: "#50C878" // 緑テーマ
    }
  ]
}
```

#### 📚 Markdown & TXT構文

**キャラクター認識パターン**：
- ヘッダー: `# キャラクター名`, `## キャラクター名`
- 箇条書き: `- 名前: キャラクター名`
- キー値: `名前: キャラクター名`, `角色: キャラクター名`
- JSON風: `"name": "キャラクター名"`

**サポートされるフィールドエイリアス**：
- **名前**: `name`, `名字`, `姓名`, `角色名`, `character`, `role`
- **説明**: `description`, `desc`, `描述`, `简介`, `介绍`
- **年齢**: `age`, `年龄`, `岁数`
- **外見**: `appearance`, `外貌`, `外観`, `長相`
- **性格**: `personality`, `性格`, `个性`, `特点`
- **背景**: `background`, `背景`, `経歴`, `历史`
- **能力**: `abilities`, `ability`, `技能`, `能力`, `特長`
- **色**: `color`, `colour`, `颜色`, `主题色`

#### 📋 ファイル命名規則

**効果的な命名例**：
- `main-characters.md` ✅
- `world-roles.json5` ✅
- `character-gallery.txt` ✅
- `supporting-cast.md` ✅

**避けるべきパターン**：
- `role.md` ❌（汎用的すぎる）
- `a.txt` ❌（説明的でない）
- `temp.json5` ❌（一時的な命名）

**開発者注記**: 解析検出のキーワードリストは、ソースコード`src/utils/utils.ts`の定数`roleKeywords`にあります。

ファイル名（小文字）がこれらの部分文字列のいずれかを含み、有効な拡張子を持つ場合のみスキャンされます。自分で拡張機能をコンパイルしてキーワードを拡張したい場合は、この配列を変更して再パッケージしてください（一貫性のためにREADMEテーブルの更新も忘れずに）。

クイック命名参考：
```
novel-helper/
  main/character-gallery.json5
  main/world_roles.md
  main/sensitive-words.txt
  main/tech_vocabulary.md
  main/regex-patterns.json5
```

### 画像パス処理
Markdown内の相対画像`![](images/a.png)`は、より安定したホバー/レンダリングのために自動的に絶対`file://` URIに変換されます。

### カラーフィールド解析
サポート: HEX（#RGB/#RRGGBB/#RRGGBBAA/#RGBA）、rgb()/rgba()、hsl()/hsla()、hsv()/hsva()；テキストと混在していても抽出可能（`#ff1e40 (プライマリカラー)`）。

### カスタム/拡張フィールド

拡張機能はカスタムフィールド解析戦略をサポートしています：

1. **標準フィールド**: 一般的なフィールド（名前、説明、年齢など）を自動認識
2. **カスタムフィールド**: キャラクターファイル内の追加フィールドは保持され、アクセス可能
3. **ネストされたオブジェクト**: JSON5形式は複雑なネストされたデータ構造をサポート
4. **配列**: リスト型データ（スキル、関係性など）をサポート
5. **メタデータ**: 整理のためのファイルレベルメタデータとタグ

#### 複雑な設定例（JSON5）

```json5
{
  // キャラクターライブラリ設定
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
  
  // センシティブワードライブラリ
  "sensitiveWords": {
    "enabled": true,
    "categories": {
      "violence": ["殺す", "殺人", "血"],
      "profanity": ["くそ", "地獄"],
      "custom": ["プレースホルダー1", "プレースホルダー2"]
    },
    "severity": {
      "high": ["極端なコンテンツ"],
      "medium": ["中程度のコンテンツ"],
      "low": ["軽度のコンテンツ"]
    }
  },
  
  // 語彙ライブラリ
  "vocabulary": {
    "technical": {
      "magic": ["マナ", "呪文", "エンチャント"],
      "combat": ["剣", "盾", "鎧"]
    },
    "worldBuilding": {
      "locations": ["王国", "城", "村"],
      "cultures": ["エルフ", "ドワーフ", "人間"]
    }
  },
  
  // 正規表現ルール
  "regexRules": {
    "namePatterns": {
      "pattern": "\\b[A-Z][a-z]+\\s[A-Z][a-z]+\\b",
      "description": "フルネーム（名 姓）にマッチ"
    },
    "dialogueMarkers": {
      "pattern": "\"[^\"]*\"",
      "description": "引用された対話にマッチ"
    }
  }
}
```

## 🛠️ その他の便利なツール

### Markdownツールバー
- ヘッダー、リスト、リンクなどのクイック書式設定ボタン
- キャラクター挿入ショートカット
- カスタムスニペットサポート

### コメントシステム
- 原稿にインラインコメントを追加
- 修正ノートとフィードバックを追跡
- 協力執筆サポート

### 時間統計
- 執筆セッションと生産性を追跡
- 日々の執筆目標を設定
- 執筆パターンと習慣を分析

## ⚙️ 設定

拡張機能設定にアクセス：
- ファイル → 設定 → 設定 → 拡張機能 → Andrea Novel Helper
- またはコマンドパレットを使用：「設定: 設定を開く（UI）」

### 主要設定
- **キャラクター検出**: 自動キャラクター認識の有効/無効
- **文字数表示**: 文字数表示形式のカスタマイズ
- **センシティブワードフィルタリング**: コンテンツフィルタリングルールの設定
- **同期設定**: WebDAV同期の設定
- **UI カスタマイズ**: 色、フォント、レイアウト設定の調整

## 🤝 貢献とフィードバック

### 📢 コミュニティディスカッション
[GitHub Discussions](https://github.com/AndreaZhang2024/andrea-novel-helper/discussions)でコミュニティディスカッションに参加：
- 機能リクエストと提案を共有
- 執筆のコツと経験を交換
- 他のユーザーからヘルプを得る
- VS Codeでの小説執筆のベストプラクティスを議論

### 🐛 問題報告
バグレポートと機能リクエストには以下をご利用ください：
- **GitHub Issues**: バグ報告、機能リクエスト、開発進捗の追跡
- **プルリクエスト**: コード改善と新機能の貢献

### 開発
貢献したいですか？[開発ガイド](https://github.com/AndreaZhang2024/andrea-novel-helper)をチェック：
- 開発環境のセットアップ
- コード貢献ガイドライン
- テスト手順
- リリースプロセス

## 📺 デモンストレーション（一部旧例を使用）

### 旧例

以下のデモンストレーションは0.0.xバージョンからのもので、拡張機能の主要機能を紹介しています：

- **キャラクター作成**
  ![キャラクター作成](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/%E5%88%9B%E5%BB%BA%E8%A7%92%E8%89%B2.gif)

- **キャラクターの色作成**
  ![キャラクターの色作成](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/为角色创建颜色.gif)

- **中国語分詞**
  ![中国語分詞](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/中文分词.gif)

- **自動補完**
  ![自動補完](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/自动补全.gif)

- **定義へのジャンプ**
  ![定義へのジャンプ](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/转跳定义.gif)

- **文字数統計**
  ![文字数統計](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/字数统计.gif)

- **センシティブワード検出**
  ![センシティブワード検出](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/敏感词识别.gif)

- **実験的アウトライン**
  ![実験的アウトライン](https://raw.githubusercontent.com/AndreaFrederica/andrea-novel-helper/master/resources/实验性大纲.gif)

## 📄 ライセンス

このプロジェクトはMITライセンスの下でライセンスされています - 詳細は[LICENSE](LICENSE)ファイルをご覧ください。

## 🙏 謝辞

- すべての貢献者とベータテスターに感謝
- VS Code拡張機能開発コミュニティに特別な感謝
- 世界中の創作者のニーズにインスパイアされて

---

**ハッピーライティング！📝✨**

詳細については、[GitHubリポジトリ](https://github.com/AndreaZhang2024/andrea-novel-helper)をご覧いただくか、[VS Code Marketplaceページ](https://marketplace.visualstudio.com/items?itemName=AndreaZhang.andrea-novel-helper)をチェックしてください。