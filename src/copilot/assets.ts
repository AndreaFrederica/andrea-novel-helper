import * as fs from 'fs';
import * as path from 'path';

export const BUNDLED_COPILOT_DOC_IDS = [
  'copilot-instructions',
  'anh-project',
  'anh-script-runtime',
  'anh-typst-templates',
] as const;

export type BundledCopilotDocId = typeof BUNDLED_COPILOT_DOC_IDS[number];
export type BundledCopilotDocKind = 'instructions' | 'prompt';

export interface BundledCopilotDocDescriptor {
  id: BundledCopilotDocId;
  title: string;
  description: string;
  kind: BundledCopilotDocKind;
  extensionRelativePath: string;
  workspaceRelativePath: string;
}

export interface BundledCopilotDocContent extends BundledCopilotDocDescriptor {
  sourcePath: string;
  content: string;
}

export interface ExportBundledCopilotDocsResult {
  written: string[];
  skipped: string[];
  missing: string[];
}

const bundledCopilotDocs: readonly BundledCopilotDocDescriptor[] = [
  {
    id: 'copilot-instructions',
    title: 'ANH Copilot 指令',
    description: '扩展仓库的 Copilot 工作区指令文件。',
    kind: 'instructions',
    extensionRelativePath: '.github/copilot-instructions.md',
    workspaceRelativePath: '.github/copilot-instructions.md',
  },
  {
    id: 'anh-project',
    title: 'ANH 项目结构 Prompt',
    description: 'ANH 项目文件结构、角色文件与追踪数据库的领域知识。',
    kind: 'prompt',
    extensionRelativePath: '.github/prompts/anh-project.prompt.md',
    workspaceRelativePath: '.github/prompts/anh-project.prompt.md',
  },
  {
    id: 'anh-script-runtime',
    title: 'ANH Script Runtime Prompt',
    description: 'ANH 脚本运行器、ctx API 与 MCP 集成说明。',
    kind: 'prompt',
    extensionRelativePath: '.github/prompts/anh-script-runtime.prompt.md',
    workspaceRelativePath: '.github/prompts/anh-script-runtime.prompt.md',
  },
  {
    id: 'anh-typst-templates',
    title: 'ANH Typst Template Prompt',
    description: 'ANH Typst 模板格式、上下文与自定义过滤器说明。',
    kind: 'prompt',
    extensionRelativePath: '.github/prompts/anh-typst-templates.prompt.md',
    workspaceRelativePath: '.github/prompts/anh-typst-templates.prompt.md',
  },
] as const;

export function listBundledCopilotDocs(): BundledCopilotDocDescriptor[] {
  return bundledCopilotDocs.map(doc => ({ ...doc }));
}

export function getBundledCopilotDocDescriptor(id: string): BundledCopilotDocDescriptor | undefined {
  return bundledCopilotDocs.find(doc => doc.id === id);
}

export function getBundledCopilotDocSourcePath(extensionPath: string, id: string): string | undefined {
  const doc = getBundledCopilotDocDescriptor(id);
  if (!doc) { return undefined; }
  return path.join(extensionPath, ...doc.extensionRelativePath.split('/'));
}

export function readBundledCopilotDoc(extensionPath: string, id: string): BundledCopilotDocContent | undefined {
  const doc = getBundledCopilotDocDescriptor(id);
  if (!doc) { return undefined; }

  const sourcePath = getBundledCopilotDocSourcePath(extensionPath, id);
  if (!sourcePath || !fs.existsSync(sourcePath)) { return undefined; }

  return {
    ...doc,
    sourcePath,
    content: fs.readFileSync(sourcePath, 'utf8'),
  };
}

export const MCP_STDIO_SCRIPT_NAME = 'andrea-mcp-stdio.js';

export interface ExportMcpStdioResult {
  success: boolean;
  sourcePath: string;
  targetPath: string;
  existed: boolean;
}

export function exportMcpStdioScript(
  extensionPath: string,
  workspaceRoot: string,
  overwrite = false,
): ExportMcpStdioResult {
  const sourcePath = path.join(extensionPath, 'bin', MCP_STDIO_SCRIPT_NAME);
  const targetDir = path.join(workspaceRoot, '.vscode');
  const targetPath = path.join(targetDir, MCP_STDIO_SCRIPT_NAME);

  const existed = fs.existsSync(targetPath);
  if (!overwrite && existed) {
    return { success: false, sourcePath, targetPath, existed };
  }

  if (!fs.existsSync(sourcePath)) {
    return { success: false, sourcePath, targetPath, existed };
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(sourcePath, targetPath);
  return { success: true, sourcePath, targetPath, existed };
}

export function exportBundledCopilotDocsToWorkspace(
  extensionPath: string,
  workspaceRoot: string,
  overwrite = false,
): ExportBundledCopilotDocsResult {
  const result: ExportBundledCopilotDocsResult = {
    written: [],
    skipped: [],
    missing: [],
  };

  for (const doc of bundledCopilotDocs) {
    const sourcePath = path.join(extensionPath, ...doc.extensionRelativePath.split('/'));
    const targetPath = path.join(workspaceRoot, ...doc.workspaceRelativePath.split('/'));

    if (!fs.existsSync(sourcePath)) {
      result.missing.push(doc.id);
      continue;
    }

    if (!overwrite && fs.existsSync(targetPath)) {
      result.skipped.push(doc.workspaceRelativePath);
      continue;
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);
    result.written.push(doc.workspaceRelativePath);
  }

  return result;
}