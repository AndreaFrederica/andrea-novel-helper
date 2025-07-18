import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import JSON5 from "json5";

// 角色定义接口
type Role = {
  /** 插入的主名称 */
  name: string;
  /** 可选别名数组 */
  aliases?: string[];
  /** 补全列表中显示的简介 */
  description?: string;
  /** 颜色十六进制，如 '#E60033' */
  color?: string;
};

// 全局角色列表
let roles: Role[] = [];
// 装饰器 Map，存储每个角色对应的装饰类型
let decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();

// 中文分词器 (词级别)
const segmenter = new Intl.Segmenter("zh", { granularity: "word" });

/**
 * 从工作区根目录加载 JSON5 字典文件，解析到 roles 数组
 */
function loadRoles() {
  roles = [];
  const config = vscode.workspace.getConfiguration("markdownRoleCompletion");
  const rolesFile = config.get<string>("rolesFile")!;
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return;

  const root = folders[0].uri.fsPath;
  const filePath = path.join(root, rolesFile);
  if (!fs.existsSync(filePath)) {
    vscode.window.showWarningMessage(`角色库文件未找到: ${rolesFile}`);
    return;
  }
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const arr = JSON5.parse(content) as Role[];
    roles = arr.filter((r) => !!r.name);
  } catch (err) {
    vscode.window.showErrorMessage(`解析角色库失败: ${err}`);
  }
}

/**
 * 提取光标前的“前缀”：用 Intl.Segmenter 拆分词，取最后一个词
 */
function getPrefix(text: string): string {
  let last = "";
  for (const { segment, isWordLike } of segmenter.segment(text)) {
    if (isWordLike) {
      last = segment;
    }
  }
  return last;
}

export function activate(context: vscode.ExtensionContext) {
  // 初次加载角色库
  loadRoles();

  // 监听配置变更，重新加载并更新装饰
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration("markdownRoleCompletion.rolesFile") ||
        e.affectsConfiguration("markdownRoleCompletion.minChars")
      ) {
        loadRoles();
        updateDecorations();
      }
    })
  );

  // 注册补全提供者
  const provider = vscode.languages.registerCompletionItemProvider(
    { language: "markdown" },
    {
      provideCompletionItems(document, position) {
        const line = document
          .lineAt(position)
          .text.slice(0, position.character);
        const prefix = getPrefix(line);
        if (!prefix) return;

        const minChars = vscode.workspace
          .getConfiguration("markdownRoleCompletion")
          .get<number>("minChars")!;
        if (prefix.length < minChars) return;

        const items: vscode.CompletionItem[] = [];
        for (const role of roles) {
          const matchName = role.name.includes(prefix);
          const matchAlias = role.aliases?.some((a) => a.includes(prefix));
          if (matchName || matchAlias) {
            const item = new vscode.CompletionItem(
              role.name,
              vscode.CompletionItemKind.Text
            );
            item.range = new vscode.Range(
              position.line,
              position.character - prefix.length,
              position.line,
              position.character
            );
            if (role.description) item.detail = role.description;
            if (role.color) {
              const md = new vscode.MarkdownString();
              md.appendMarkdown(
                `**颜色**: <span style=\"color:${role.color}\">■</span> \`${role.color}\``
              );
              md.isTrusted = true;
              item.documentation = md;
            }
            items.push(item);
          }
        }
        return items;
      },
    }
  );
  context.subscriptions.push(provider);

  // 更新装饰函数
  function updateDecorations(editor?: vscode.TextEditor) {
    const active = editor || vscode.window.activeTextEditor;
    if (!active || active.document.languageId !== "markdown") return;
    const text = active.document.getText();

    // 清理旧装饰
    decorationTypes.forEach((deco) => deco.dispose());
    decorationTypes.clear();

    // 为每个角色应用装饰
    for (const role of roles) {
      const decoType = vscode.window.createTextEditorDecorationType({
        color: role.color || undefined,
      });
      const ranges: vscode.Range[] = [];
      const regex = new RegExp(role.name, "g");
      let match;
      while ((match = regex.exec(text))) {
        const start = active.document.positionAt(match.index);
        const end = active.document.positionAt(match.index + match[0].length);
        ranges.push(new vscode.Range(start, end));
      }
      active.setDecorations(decoType, ranges);
      decorationTypes.set(role.name, decoType);
    }
  }

  // 初次装饰 & 监听编辑/激活切换
  updateDecorations();
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateDecorations),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (
        vscode.window.activeTextEditor &&
        e.document === vscode.window.activeTextEditor.document
      ) {
        updateDecorations();
      }
    })
  );

  // 注册 Hover 提示
  const hoverProv = vscode.languages.registerHoverProvider(
    { language: "markdown" },
    {
      provideHover(document, position) {
        const wordRange = document.getWordRangeAtPosition(
          position,
          /[\p{L}\p{N}\u4e00-\u9fa5]+/u
        );
        if (!wordRange) return;
        const word = document.getText(wordRange);
        const role = roles.find(
          (r) => r.name === word || r.aliases?.includes(word)
        );
        if (role) {
          const md = new vscode.MarkdownString();
          md.appendMarkdown(`**${role.name}**`);
          if (role.description) md.appendMarkdown(`\n\n${role.description}`);
          if (role.color) {
            md.appendMarkdown(
              `\n\n颜色： <span style=\"color:${role.color}\">■</span> \`${role.color}\``
            );
            md.isTrusted = true;
          }
          return new vscode.Hover(md, wordRange);
        }
      },
    }
  );
  context.subscriptions.push(hoverProv);
}

export function deactivate() {
  decorationTypes.forEach((deco) => deco.dispose());
}
