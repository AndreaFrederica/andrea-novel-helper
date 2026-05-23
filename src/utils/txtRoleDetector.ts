import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/** 从 VS Code 设置读取关键词，带默认值 */
function getDetectionKeywords(): string[] {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const keywords = cfg.get<string[]>('txtMigration.detectionKeywords');
    return (keywords && keywords.length) ? keywords : [
        '角色', '人物', 'character', 'role', '主角', '配角',
        '登场', '设定', '信息', '档案', '介绍',
    ];
}

function getHighConfidenceDirs(): string[] {
    const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
    const dirs = cfg.get<string[]>('txtMigration.highConfidenceDirs');
    return (dirs && dirs.length) ? dirs : ['角色', '人物', 'characters', 'roles'];
}

function getScoreThreshold(): number {
    return vscode.workspace.getConfiguration('AndreaNovelHelper')
        .get<number>('txtMigration.scoreThreshold', 50);
}

function getHighConfidenceThreshold(): number {
    return vscode.workspace.getConfiguration('AndreaNovelHelper')
        .get<number>('txtMigration.highConfidenceScoreThreshold', 30);
}

export interface TxtRoleFileCandidate {
    filePath: string;
    fileName: string;
    score: number;          // 0-100 内容特征评分
    lineCount: number;
    summary: string;        // 简短摘要
    rationale: string[];    // 判定理由
}

/** 检查文件名是否包含角色相关关键词 */
function fileNameHasKeyword(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    return getDetectionKeywords().some(kw => lower.includes(kw.toLowerCase()));
}

/** 检查文件是否在高置信度目录下 */
function isInHighConfidenceDir(filePath: string, workspaceRoot: string): boolean {
    const relative = path.relative(workspaceRoot, path.dirname(filePath)).toLowerCase();
    return getHighConfidenceDirs().some(dir => relative.includes(dir.toLowerCase()));
}

/** 对文件内容进行特征评分 */
function scoreFileContent(content: string): { score: number; rationale: string[] } {
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 10) {
        return { score: 0, rationale: ['文件行数过少 (< 10)'] };
    }

    const totalLines = lines.length;
    const rationale: string[] = [];

    // 1. 属性行密度：包含中文冒号的行（称号：xxx、年龄：xx 等）
    const attrLines = lines.filter(l => /[：:]/.test(l) && l.trim().length > 1);
    const attrDensity = attrLines.length / totalLines;
    let score = 0;

    if (attrDensity >= 0.20) {
        score += 30;
        rationale.push(`属性行密度 ${(attrDensity * 100).toFixed(0)}% (≥20%)`);
    } else if (attrDensity >= 0.10) {
        score += 15;
        rationale.push(`属性行密度 ${(attrDensity * 100).toFixed(0)}% (≥10%)`);
    }

    // 2. 名称行密度：短行（≤10字）且无中文标点
    const nameLines = lines.filter(l => {
        const t = l.trim();
        return t.length <= 10 && t.length >= 1 && !/[：。，！？；、""''（）【】《》…—]/.test(t);
    });
    const nameDensity = nameLines.length / totalLines;
    if (nameDensity >= 0.15) {
        score += 25;
        rationale.push(`名称行密度 ${(nameDensity * 100).toFixed(0)}% (≥15%)`);
    } else if (nameDensity >= 0.08) {
        score += 12;
        rationale.push(`名称行密度 ${(nameDensity * 100).toFixed(0)}% (≥8%)`);
    }

    // 3. 章节/分类标题（一、二、三… 或 （一）（二）等）
    const sectionHeaders = lines.filter(l =>
        /^[一二三四五六七八九十\d]+[、．.)）]/.test(l.trim()) ||
        /^[（(][一二三四五六七八九十\d]+[）)]/.test(l.trim())
    );
    const sectionDensity = sectionHeaders.length / totalLines;
    if (sectionDensity >= 0.03) {
        score += 20;
        rationale.push(`章节标题 ${sectionHeaders.length} 个`);
    } else if (sectionHeaders.length >= 2) {
        score += 10;
        rationale.push(`章节标题 ${sectionHeaders.length} 个`);
    }

    // 4. 分段结构：空行分隔的段数
    const blocks = content.split(/\r?\n\r?\n/).filter(b => b.trim());
    if (blocks.length >= 5) {
        score += 15;
        rationale.push(`分段结构 ${blocks.length} 块`);
    } else if (blocks.length >= 3) {
        score += 8;
        rationale.push(`分段结构 ${blocks.length} 块`);
    }

    // 5. 长段落密度（负面分）：>100 字的行过多则扣分
    const longLines = lines.filter(l => l.trim().length > 100);
    const longDensity = longLines.length / totalLines;
    if (longDensity > 0.30) {
        score -= 20;
        rationale.push(`长段落密度 ${(longDensity * 100).toFixed(0)}% (扣除)`);
    }

    // 确保分数在 0-100 之间
    score = Math.max(0, Math.min(100, score));
    rationale.unshift(`总分: ${score}/100`);

    return { score, rationale };
}

function generateSummary(content: string): string {
    const lines = content.split(/\r?\n/).filter(l => l.trim());
    // 找第一个看起来像角色名的行（短、无标点）
    const nameLine = lines.find(l => {
        const t = l.trim();
        return t.length >= 2 && t.length <= 8 &&
            !/[：。，！？；、""''（）【】《》…—:\s\/\\&]/.test(t) &&
            !/^[（(【\[]/.test(t) &&
            !/^[一二三四五六七八九十\d]+[、．.)）]/.test(t);
    });
    const firstLine = lines[0]?.trim().substring(0, 60) || '';
    const candidateName = nameLine?.trim() || '';
    return candidateName ? `含角色"${candidateName}"等` : firstLine;
}

/** 扫描工作区，返回候选角色 TXT 文件列表 */
export function detectTxtRoleFiles(workspaceRoot: string): TxtRoleFileCandidate[] {
    const candidates: TxtRoleFileCandidate[] = [];

    if (!fs.existsSync(workspaceRoot)) return candidates;

    // 收集所有 .txt 文件（排除 node_modules、.git、.vscode 等）
    function walkDir(dir: string, depth: number = 0) {
        if (depth > 6) return;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const baseName = entry.name.toLowerCase();

            // 跳过无关目录
            if (entry.isDirectory()) {
                if (['node_modules', '.git', '.vscode', '.anh-fsdb', 'build', 'dist', 'out'].includes(baseName)) continue;
                walkDir(fullPath, depth + 1);
                continue;
            }

            if (!entry.isFile() || !baseName.endsWith('.txt')) continue;

            // 第一层：文件名关键词
            if (!fileNameHasKeyword(entry.name)) continue;

            // 第二层：目录置信度
            const highConf = isInHighConfidenceDir(fullPath, workspaceRoot);

            // 第三层：内容评分
            let content: string;
            try {
                content = fs.readFileSync(fullPath, 'utf8');
            } catch { continue; }

            const { score, rationale } = scoreFileContent(content);

            // 高置信度目录使用更低的阈值
            const threshold = highConf ? getHighConfidenceThreshold() : getScoreThreshold();
            if (score < threshold) continue;

            candidates.push({
                filePath: fullPath,
                fileName: path.relative(workspaceRoot, fullPath),
                score,
                lineCount: content.split(/\r?\n/).filter(l => l.trim()).length,
                summary: generateSummary(content),
                rationale: highConf
                    ? [`高置信度目录 (阈值: ≥${threshold})`, ...rationale]
                    : rationale,
            });
        }
    }

    walkDir(workspaceRoot);

    // 按分数降序排列
    candidates.sort((a, b) => b.score - a.score);
    return candidates;
}

/** 扫描所有工作区文件夹 */
export function detectTxtRoleFilesAll(): TxtRoleFileCandidate[] {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) return [];

    const all: TxtRoleFileCandidate[] = [];
    for (const folder of folders) {
        all.push(...detectTxtRoleFiles(folder.uri.fsPath));
    }
    all.sort((a, b) => b.score - a.score);
    return all;
}
