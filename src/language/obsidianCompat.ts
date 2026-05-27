/* eslint-disable curly */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getObsidianProjectIndex, isObsidianIndexEnabled, OBSIDIAN_INDEX_EXCLUDE, registerObsidianIndex, stripKnownExtension } from './obsidianIndex';

type WikiLinkAtPosition = {
  range: vscode.Range;
  raw: string;
  target: string;
};

type WikiTarget = {
  filePart: string;
  heading?: string;
};

const DOCUMENT_SELECTOR: vscode.DocumentSelector = [
  { scheme: 'file', language: 'markdown' },
  { scheme: 'file', language: 'plaintext' },
];

const WIKI_LINK_RE = /!??\[\[([^\]\n]+)\]\]/g;
const LINK_EXTENSIONS = ['.md', '.markdown'];

export function registerObsidianCompat(context: vscode.ExtensionContext) {
  registerObsidianIndex(context);
  context.subscriptions.push(
    vscode.languages.registerDocumentLinkProvider(DOCUMENT_SELECTOR, new ObsidianDocumentLinkProvider()),
    vscode.languages.registerDefinitionProvider(DOCUMENT_SELECTOR, new ObsidianDefinitionProvider()),
    vscode.languages.registerCompletionItemProvider(DOCUMENT_SELECTOR, new ObsidianCompletionProvider(), '[', '#'),
  );
}

class ObsidianDocumentLinkProvider implements vscode.DocumentLinkProvider {
  async provideDocumentLinks(document: vscode.TextDocument): Promise<vscode.DocumentLink[]> {
    const links: vscode.DocumentLink[] = [];
    for (const wikiLink of findWikiLinks(document)) {
      const location = await resolveWikiLocation(document, wikiLink.target);
      if (!location) continue;
      const link = new vscode.DocumentLink(wikiLink.range, location.uri);
      link.tooltip = `打开 ${wikiLink.target}`;
      links.push(link);
    }
    return links;
  }
}

class ObsidianDefinitionProvider implements vscode.DefinitionProvider {
  async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Definition | undefined> {
    const wikiLink = findWikiLinkAtPosition(document, position);
    if (!wikiLink) return undefined;
    return await resolveWikiLocation(document, wikiLink.target) || undefined;
  }
}

class ObsidianCompletionProvider implements vscode.CompletionItemProvider {
  async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[] | undefined> {
    const wikiContext = getWikiCompletionContext(document, position);
    if (wikiContext) {
      if (wikiContext.headingPrefix !== undefined) {
        const targetUri = await resolveWikiFile(document, wikiContext.filePart);
        if (!targetUri) return [];
        return headingItems(targetUri, wikiContext.headingPrefix);
      }
      return fileItems(await getWorkspaceTextFiles(), wikiContext.prefix);
    }

    const tagPrefix = getTagCompletionPrefix(document, position);
    if (tagPrefix !== undefined) {
      return tagItems(await collectWorkspaceTags(), tagPrefix);
    }

    return undefined;
  }
}

function findWikiLinks(document: vscode.TextDocument): WikiLinkAtPosition[] {
  const result: WikiLinkAtPosition[] = [];
  for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
    const line = document.lineAt(lineIndex).text;
    WIKI_LINK_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = WIKI_LINK_RE.exec(line))) {
      const fullText = match[0];
      const raw = match[1].trim();
      const target = raw.split('|')[0].trim();
      if (!target) continue;
      result.push({
        raw,
        target,
        range: new vscode.Range(lineIndex, match.index, lineIndex, match.index + fullText.length),
      });
    }
  }
  return result;
}

function findWikiLinkAtPosition(document: vscode.TextDocument, position: vscode.Position): WikiLinkAtPosition | undefined {
  const line = document.lineAt(position.line).text;
  WIKI_LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKI_LINK_RE.exec(line))) {
    const range = new vscode.Range(position.line, match.index, position.line, match.index + match[0].length);
    if (!range.contains(position)) continue;
    const raw = match[1].trim();
    const target = raw.split('|')[0].trim();
    if (!target) return undefined;
    return { raw, target, range };
  }
  return undefined;
}

function parseWikiTarget(input: string): WikiTarget {
  const withoutAlias = input.split('|')[0].trim();
  const hashIndex = withoutAlias.indexOf('#');
  if (hashIndex >= 0) {
    return {
      filePart: withoutAlias.slice(0, hashIndex).trim(),
      heading: withoutAlias.slice(hashIndex + 1).trim() || undefined,
    };
  }
  return { filePart: withoutAlias };
}

async function resolveWikiLocation(document: vscode.TextDocument, input: string): Promise<vscode.Location | undefined> {
  const target = parseWikiTarget(input);
  const targetUri = target.filePart ? await resolveWikiFile(document, target.filePart) : document.uri;
  if (!targetUri) return undefined;
  const position = target.heading ? await findHeadingPosition(targetUri, target.heading) : new vscode.Position(0, 0);
  return new vscode.Location(targetUri, position || new vscode.Position(0, 0));
}

async function resolveWikiFile(document: vscode.TextDocument, filePart: string): Promise<vscode.Uri | undefined> {
  const normalized = normalizeWikiFilePart(filePart);
  if (!normalized) return document.uri;

  const explicitCandidate = await resolveExplicitPath(document, normalized);
  if (explicitCandidate) return explicitCandidate;

  const normalizedLower = stripKnownExtension(path.basename(normalized)).toLowerCase();
  if (!normalizedLower) return undefined;
  const index = getObsidianProjectIndex();
  const indexedMatch = await index?.resolveWikiFileByName(normalized);
  if (indexedMatch || !isObsidianIndexEnabled()) return indexedMatch;
  return await findExistingWorkspaceWikiFile(document, normalized);
}

async function resolveExplicitPath(document: vscode.TextDocument, filePart: string): Promise<vscode.Uri | undefined> {
  if (!/[\\/]/.test(filePart) && !path.extname(filePart)) return undefined;
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
  const bases = [path.dirname(document.uri.fsPath)];
  if (workspaceRoot) bases.push(workspaceRoot);
  const variants = path.extname(filePart) ? [filePart] : LINK_EXTENSIONS.map(ext => filePart + ext);
  for (const base of bases) {
    for (const variant of variants) {
      const candidate = path.resolve(base, variant);
      if (await existsFile(candidate)) return vscode.Uri.file(candidate);
    }
  }
  return undefined;
}

async function findHeadingPosition(uri: vscode.Uri, heading: string): Promise<vscode.Position | undefined> {
  return getObsidianProjectIndex()?.findHeadingPosition(uri, heading);
}

async function headingItems(uri: vscode.Uri, prefix: string): Promise<vscode.CompletionItem[]> {
  const prefixLower = prefix.toLowerCase();
  const headings = await getObsidianProjectIndex()?.getHeadings(uri) || [];
  return headings.flatMap(({ heading }) => {
    if (prefix && !heading.toLowerCase().includes(prefixLower)) return [];
    const item = new vscode.CompletionItem(heading, vscode.CompletionItemKind.Reference);
    item.insertText = heading;
    item.detail = 'Obsidian 标题链接';
    return [item];
  });
}

function fileItems(files: vscode.Uri[], prefix: string): vscode.CompletionItem[] {
  const prefixLower = prefix.toLowerCase();
  return files.flatMap(uri => {
    const label = stripKnownExtension(path.basename(uri.fsPath));
    if (prefix && !label.toLowerCase().includes(prefixLower)) return [];
    const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.File);
    item.insertText = label;
    item.detail = 'Obsidian 双链';
    item.documentation = vscode.workspace.asRelativePath(uri);
    return [item];
  });
}

function tagItems(tags: string[], prefix: string): vscode.CompletionItem[] {
  const prefixLower = prefix.toLowerCase();
  return tags.flatMap(tag => {
    if (prefix && !tag.toLowerCase().includes(prefixLower)) return [];
    const item = new vscode.CompletionItem(tag, vscode.CompletionItemKind.Keyword);
    item.insertText = tag;
    item.detail = 'Obsidian 标签';
    return [item];
  });
}

function getWikiCompletionContext(document: vscode.TextDocument, position: vscode.Position): { prefix: string; filePart: string; headingPrefix?: string } | undefined {
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
  const openIndex = linePrefix.lastIndexOf('[[');
  if (openIndex < 0) return undefined;
  const closeIndex = linePrefix.lastIndexOf(']]');
  if (closeIndex > openIndex) return undefined;
  const content = linePrefix.slice(openIndex + 2);
  if (content.includes('|')) return undefined;
  const hashIndex = content.indexOf('#');
  if (hashIndex >= 0) {
    return {
      prefix: content,
      filePart: content.slice(0, hashIndex).trim(),
      headingPrefix: content.slice(hashIndex + 1),
    };
  }
  return { prefix: content, filePart: content };
}

function getTagCompletionPrefix(document: vscode.TextDocument, position: vscode.Position): string | undefined {
  const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
  const match = /(^|[\s([{>])#([A-Za-z0-9_\-\u4e00-\u9fff\/]{0,80})$/.exec(linePrefix);
  return match ? `#${match[2]}` : undefined;
}

async function collectWorkspaceTags(): Promise<string[]> {
  if (!isObsidianIndexEnabled()) return [];
  return getObsidianProjectIndex()?.getTags() || [];
}

async function getWorkspaceTextFiles(): Promise<vscode.Uri[]> {
  return getObsidianProjectIndex()?.getWikiFiles() || vscode.workspace.findFiles('**/*.{md,markdown}', OBSIDIAN_INDEX_EXCLUDE, 5000);
}

async function findExistingWorkspaceWikiFile(document: vscode.TextDocument, filePart: string): Promise<vscode.Uri | undefined> {
  const wantedPath = normalizeWikiFilePart(filePart).toLowerCase();
  const wantedName = stripKnownExtension(path.basename(wantedPath)).toLowerCase();
  if (!wantedName) return undefined;

  const index = getObsidianProjectIndex();
  const candidates = await vscode.workspace.findFiles('**/*.{md,markdown}', OBSIDIAN_INDEX_EXCLUDE, 10000);
  const matches = candidates.filter(uri => {
    if (index && !index.isIndexableUri(uri)) return false;
    const rel = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/').toLowerCase();
    const basename = stripKnownExtension(path.basename(rel)).toLowerCase();
    if (/[\/]/.test(filePart)) {
      const withoutExt = stripKnownExtension(rel).toLowerCase();
      return withoutExt.endsWith(stripKnownExtension(wantedPath)) || rel.endsWith(wantedPath);
    }
    return basename === wantedName;
  });
  if (!matches.length) return undefined;
  matches.sort((left, right) => wikiCandidateScore(document, left) - wikiCandidateScore(document, right)
    || vscode.workspace.asRelativePath(left).localeCompare(vscode.workspace.asRelativePath(right), 'zh-CN'));
  return matches[0];
}

function wikiCandidateScore(document: vscode.TextDocument, candidate: vscode.Uri): number {
  const currentDir = path.dirname(document.uri.fsPath);
  const candidateDir = path.dirname(candidate.fsPath);
  if (sameFsPath(currentDir, candidateDir)) return 0;
  const workspace = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
  const rel = workspace ? path.relative(workspace, candidate.fsPath) : candidate.fsPath;
  return rel.split(/[\\/]+/).length;
}

function sameFsPath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function normalizeWikiFilePart(input: string): string {
  return input.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

async function existsFile(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.promises.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}
