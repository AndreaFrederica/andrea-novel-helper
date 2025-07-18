import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import JSON5 from 'json5';

// 角色定义接口，新增类型(type)与从属标签(affiliation)
interface Role {
  /** 插入的主名称 */
  name: string;
  /** 角色类型：主角、配角、联动角色 */
  type: '主角' | '配角' | '联动角色';
  /** 从属标签，如所属阵营、组织等 */
  affiliation?: string;
  /** 可选别名数组 */
  aliases?: string[];
  /** 补全列表中显示的简介 */
  description?: string;
  /** 颜色十六进制，如 '#E60033'，优先级高于类型默认色 */
  color?: string;
}

// 全局角色列表
let roles: Role[] = [];
// editor 装饰类型存储
let decorationTypes: Map<string, vscode.TextEditorDecorationType> = new Map();
// 中文分词器(词级别)
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });

// 类型到默认颜色映射
const typeColorMap: Record<string, string> = {
  主角: '#FFD700',       // 金色
  配角: '#ADD8E6',       // 淡蓝
  '联动角色': '#90EE90'  // 淡绿
};

/**
 * 加载角色库 JSON5，支持注释与尾逗号
 */
function loadRoles() {
  roles = [];
  const cfg = vscode.workspace.getConfiguration('markdownRoleCompletion');
  const file = cfg.get<string>('rolesFile')!;
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || !folders.length) return;
  const root = folders[0].uri.fsPath;
  const full = path.join(root, file);
  if (!fs.existsSync(full)) {
    vscode.window.showWarningMessage(`角色库未找到: ${file}`);
    return;
  }
  try {
    const text = fs.readFileSync(full, 'utf8');
    roles = JSON5.parse(text) as Role[];
  } catch (e) {
    vscode.window.showErrorMessage(`解析角色库失败: ${e}`);
  }
}

/**
 * 用 Intl.Segmenter 拆分成词，取最后一个词作为补全前缀
 */
function getPrefix(line: string): string {
  let last = '';
  for (const { segment, isWordLike } of segmenter.segment(line)) {
    if (isWordLike) last = segment;
  }
  return last;
}

export function activate(context: vscode.ExtensionContext) {
  loadRoles();
  // 配置变更监听
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (
        e.affectsConfiguration('markdownRoleCompletion.rolesFile') ||
        e.affectsConfiguration('markdownRoleCompletion.minChars') ||
        e.affectsConfiguration('markdownRoleCompletion.defaultColor')
      ) {
        loadRoles();
        updateDecorations();
      }
    })
  );

  // Completion provider
  const provider = vscode.languages.registerCompletionItemProvider(
    { language: 'markdown' },
    {
      provideCompletionItems(doc, pos) {
        const line = doc.lineAt(pos).text.slice(0, pos.character);
        const prefix = getPrefix(line);
        if (!prefix) return;
        const min = vscode.workspace.getConfiguration('markdownRoleCompletion').get<number>('minChars')!;
        if (prefix.length < min) return;
        return roles.filter(r =>
          r.name.includes(prefix) || r.aliases?.some(a => a.includes(prefix))
        ).map(r => {
          const item = new vscode.CompletionItem(r.name, vscode.CompletionItemKind.Text);
          item.range = new vscode.Range(pos.line, pos.character - prefix.length, pos.line, pos.character);
          // detail 显示简介 + 类型 + 从属
          const details = [];
          if (r.description) details.push(r.description);
          details.push(`类型: ${r.type}`);
          if (r.affiliation) details.push(`从属: ${r.affiliation}`);
          item.detail = details.join(' | ');
          // documentation 展示颜色方块和类型信息
          const md = new vscode.MarkdownString();
          const color = r.color || typeColorMap[r.type] || '#CCCCCC';
          md.appendMarkdown(`**颜色**: <span style=\"color:${color}\">■</span> \`${color}\``);
          md.appendMarkdown(`\n\n**类型**: ${r.type}`);
          if (r.affiliation) md.appendMarkdown(`\n\n**从属**: ${r.affiliation}`);
          md.isTrusted = true;
          item.documentation = md;
          return item;
        });
      }
    }
  );
  context.subscriptions.push(provider);

  // 更新装饰
  function updateDecorations(editor?: vscode.TextEditor) {
    const active = editor || vscode.window.activeTextEditor;
    if (!active || active.document.languageId !== 'markdown') return;
    const docText = active.document.getText();
    // 清理旧装饰
    decorationTypes.forEach(d => d.dispose());
    decorationTypes.clear();
    // 取默认颜色配置
    const defaultColor = vscode.workspace
      .getConfiguration('markdownRoleCompletion')
      .get<string>('defaultColor')!;
    for (const r of roles) {
      const c = r.color || typeColorMap[r.type] || defaultColor;
      const deco = vscode.window.createTextEditorDecorationType({ color: c });
      const ranges: vscode.Range[] = [];
      const regex = new RegExp(r.name, 'g');
      let m: RegExpExecArray | null;
      while ((m = regex.exec(docText))) {
        const s = active.document.positionAt(m.index);
        const e = active.document.positionAt(m.index + m[0].length);
        ranges.push(new vscode.Range(s, e));
      }
      active.setDecorations(deco, ranges);
      decorationTypes.set(r.name, deco);
    }
  }
  // 初始 & 监听
  updateDecorations();
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateDecorations),
    vscode.workspace.onDidChangeTextDocument(e => {
      if (vscode.window.activeTextEditor && e.document === vscode.window.activeTextEditor.document) {
        updateDecorations(vscode.window.activeTextEditor);
      }
    })
  );

  // Hover provider 显示名称、简介、类型、从属、颜色
  const hoverProv = vscode.languages.registerHoverProvider(
    { language: 'markdown' },
    {
      provideHover(doc, pos) {
		const defaultColor = vscode.workspace
        	.getConfiguration('markdownRoleCompletion')
        	.get<string>('defaultColor')!;
        const range = doc.getWordRangeAtPosition(pos, /[\p{L}\p{N}\u4e00-\u9fa5]+/u);
        if (!range) return;
        const wd = doc.getText(range);
        const r = roles.find(x => x.name === wd || x.aliases?.includes(wd));
        if (!r) return;
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${r.name}**`);
        if (r.description) md.appendMarkdown(`\n\n${r.description}`);
        md.appendMarkdown(`\n\n**类型**: ${r.type}`);
        if (r.affiliation) md.appendMarkdown(`\n\n**从属**: ${r.affiliation}`);
        const c = r.color || typeColorMap[r.type] || defaultColor;
        md.appendMarkdown(`\n\n**颜色**: <span style=\"color:${c}\">■</span> \`${c}\``);
        md.isTrusted = true;
        return new vscode.Hover(md, range);
      }
    }
  );
  context.subscriptions.push(hoverProv);
}

export function deactivate() {
  decorationTypes.forEach(d => d.dispose());
}
