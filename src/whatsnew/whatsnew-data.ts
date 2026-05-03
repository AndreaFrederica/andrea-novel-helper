import * as fs from 'fs';
import * as path from 'path';

export interface WhatsNewSection {
    header: string;
    items: string[];
    type?: 'list' | 'html';
}

export interface WhatsNewData {
    version: string;
    date: string;
    sections: WhatsNewSection[];
    source: 'manual' | 'changelog';
}

export interface WhatsNewVersionInfo {
    version: string;
    date: string;
    source: 'manual' | 'changelog';
}

const WHATSNEW_DIR = 'whatsnew';

/**
 * 获取所有可用的 What's New 版本列表（按版本号降序）
 */
export function getAllWhatsNewVersions(extensionPath: string): WhatsNewVersionInfo[] {
    const versions = new Map<string, WhatsNewVersionInfo>();

    // 1. 扫描手动编写的 whatsnew/ 目录
    const manualDir = path.join(extensionPath, WHATSNEW_DIR);
    if (fs.existsSync(manualDir)) {
        for (const file of fs.readdirSync(manualDir)) {
            const match = file.match(/^v?([\d.]+(?:\s*\([^)]*\))?)\.md$/i);
            if (!match) { continue; }
            const version = match[1].trim();
            const filePath = path.join(manualDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            const date = extractDateFromManual(content) || '';
            versions.set(version, { version, date, source: 'manual' });
        }
    }

    // 2. 扫描 CHANGELOG.md 补充没有手动内容的版本
    const changelogPath = path.join(extensionPath, 'CHANGELOG.md');
    if (fs.existsSync(changelogPath)) {
        const content = fs.readFileSync(changelogPath, 'utf-8');
        const changelogVersions = extractAllVersionsFromChangelog(content);
        for (const info of changelogVersions) {
            if (!versions.has(info.version)) {
                versions.set(info.version, { ...info, source: 'changelog' });
            }
        }
    }

    // 按版本号降序排列
    return Array.from(versions.values()).sort((a, b) => {
        return compareVersionDesc(a.version, b.version);
    });
}

/**
 * 获取指定版本的 What's New 数据
 * 优先使用手动编写的内容，不存在则回退到 CHANGELOG.md
 */
export function getWhatsNewData(extensionPath: string, targetVersion: string): WhatsNewData | null {
    const normalizedTarget = targetVersion.replace(/^v/, '').trim();

    // 1. 先尝试读取手动编写的内容
    const manualData = loadManualWhatsNew(extensionPath, normalizedTarget);
    if (manualData) {
        return manualData;
    }

    // 2. 回退到 CHANGELOG.md
    const changelogPath = path.join(extensionPath, 'CHANGELOG.md');
    if (fs.existsSync(changelogPath)) {
        const content = fs.readFileSync(changelogPath, 'utf-8');
        const changelogData = parseChangelogContent(content, normalizedTarget);
        if (changelogData) {
            return { ...changelogData, source: 'changelog' };
        }
    }

    return null;
}

/**
 * 读取手动编写的 What's New 文件
 */
function loadManualWhatsNew(extensionPath: string, targetVersion: string): WhatsNewData | null {
    const manualDir = path.join(extensionPath, WHATSNEW_DIR);
    if (!fs.existsSync(manualDir)) {
        return null;
    }

    // 尝试匹配文件：v0.4.65.md 或 0.4.65.md
    const candidates = [
        `v${targetVersion}.md`,
        `${targetVersion}.md`,
    ];

    for (const candidate of candidates) {
        const filePath = path.join(manualDir, candidate);
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            return parseManualContent(content, targetVersion);
        }
    }

    return null;
}

/**
 * 解析手动编写的 What's New markdown 内容
 * 支持格式：
 *   # What's New in vX.X.X
 *   > 📅 YYYY-MM-DD
 *   ## ✨ Section Title
 *   - item 1
 *   - item 2
 */
function parseManualContent(content: string, version: string): WhatsNewData | null {
    const lines = content.split(/\r?\n/);
    const sections: WhatsNewSection[] = [];
    let currentSection: WhatsNewSection | null = null;
    let inHtmlBlock = false;
    let htmlBuffer: string[] = [];
    let date = '';

    // 提取日期（从 > 📅 YYYY-MM-DD 格式）
    const dateMatch = content.match(/>?\s*[📅\-]\s*(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
        date = dateMatch[1];
    }

    const sectionRegex = /^##\s+(.+)/;
    const itemRegex = /^-\s+(.+)/;

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const trimmedLine = rawLine.trim();

        // 跳过一级标题和日期行
        if (trimmedLine.startsWith('# ')) { continue; }
        if (trimmedLine.startsWith('>')) { continue; }

        const sectionMatch = trimmedLine.match(sectionRegex);
        if (sectionMatch) {
            // 保存之前的 section
            if (currentSection) {
                if (inHtmlBlock && htmlBuffer.length > 0) {
                    currentSection.items.push(htmlBuffer.join('\n'));
                    htmlBuffer = [];
                }
                sections.push(currentSection);
            }
            const header = sectionMatch[1].trim();
            const isHtml = /^html$/i.test(header);
            currentSection = {
                header: isHtml ? '' : header,
                items: [],
                type: isHtml ? 'html' : 'list'
            };
            inHtmlBlock = isHtml;
            continue;
        }

        if (!currentSection) {
            continue;
        }

        // HTML 区块：收集所有非 section 行直到下一个 section
        if (inHtmlBlock) {
            htmlBuffer.push(rawLine);
            continue;
        }

        // 列表项
        const itemMatch = trimmedLine.match(itemRegex);
        if (itemMatch) {
            let fullText = itemMatch[1].trim();
            // 处理续行（缩进的行）
            let j = i + 1;
            while (j < lines.length) {
                const nextLine = lines[j];
                if (nextLine.trim() === '' || nextLine.match(sectionRegex) || nextLine.match(itemRegex)) {
                    break;
                }
                if (nextLine.startsWith('  ') || nextLine.startsWith('\t')) {
                    fullText += '\n' + nextLine.trim();
                    j++;
                    i = j - 1;
                } else {
                    break;
                }
            }
            currentSection.items.push(fullText);
        }
    }

    // 收尾最后一个 section
    if (currentSection) {
        if (inHtmlBlock && htmlBuffer.length > 0) {
            currentSection.items.push(htmlBuffer.join('\n'));
        }
        sections.push(currentSection);
    }

    // 清理空的 HTML section
    const cleanedSections = sections.filter(s => s.type === 'html' ? s.items.some(it => it.trim()) : s.items.length > 0);

    return {
        version,
        date,
        sections: cleanedSections,
        source: 'manual'
    };
}

/**
 * 从手动文件内容中提取日期
 */
function extractDateFromManual(content: string): string | null {
    const match = content.match(/>?\s*[📅\-]\s*(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : null;
}

/**
 * 从 CHANGELOG.md 中提取所有版本列表
 */
function extractAllVersionsFromChangelog(content: string): WhatsNewVersionInfo[] {
    const versions: WhatsNewVersionInfo[] = [];
    const versionRegex = /^##\s*\[([^\]]+)\]\s*-\s*(\d{4}-\d{2}-\d{2})/gm;
    let match;
    while ((match = versionRegex.exec(content)) !== null) {
        versions.push({
            version: match[1].trim(),
            date: match[2].trim(),
            source: 'changelog'
        });
    }
    return versions;
}

/**
 * 解析 CHANGELOG.md 文本内容（指定版本）
 */
function parseChangelogContent(content: string, targetVersion: string): WhatsNewData | null {
    const lines = content.split(/\r?\n/);

    const versionRegex = /^##\s*\[([^\]]+)\]\s*-\s*(\d{4}-\d{2}-\d{2})/;
    const sectionRegex = /^###\s+(.+)/;
    const itemRegex = /^-\s+(.+)/;

    let foundVersion: WhatsNewData | null = null;
    let inTargetVersion = false;
    let currentSection: WhatsNewSection | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const versionMatch = line.match(versionRegex);
        if (versionMatch) {
            const version = versionMatch[1].trim();
            if (inTargetVersion) {
                break;
            }
            const normalizedTarget = targetVersion.replace(/^v/, '').trim();
            const normalizedVersion = version.replace(/^v/, '').trim();
            if (normalizedVersion === normalizedTarget || normalizedVersion.startsWith(normalizedTarget)) {
                inTargetVersion = true;
                foundVersion = {
                    version,
                    date: versionMatch[2].trim(),
                    sections: [],
                    source: 'changelog'
                };
            }
            continue;
        }

        if (!inTargetVersion || !foundVersion) {
            continue;
        }

        const sectionMatch = line.match(sectionRegex);
        if (sectionMatch) {
            if (currentSection) {
                foundVersion.sections.push(currentSection);
            }
            currentSection = {
                header: sectionMatch[1].trim(),
                items: []
            };
            continue;
        }

        const itemMatch = line.match(itemRegex);
        if (itemMatch && currentSection) {
            let fullText = itemMatch[1].trim();
            let j = i + 1;
            while (j < lines.length) {
                const nextLine = lines[j];
                if (nextLine.trim() === '' || nextLine.match(itemRegex) || nextLine.match(sectionRegex) || nextLine.match(versionRegex)) {
                    break;
                }
                if (nextLine.startsWith('  ')) {
                    fullText += '\n' + nextLine.trim();
                    j++;
                    i = j - 1;
                } else {
                    break;
                }
            }
            currentSection.items.push(fullText);
        }
    }

    if (foundVersion && currentSection) {
        foundVersion.sections.push(currentSection);
    }

    return foundVersion;
}

/**
 * 版本号降序比较（用于排序）
 * 返回正值表示 a 排在 b 前面（a 版本更新）
 */
function compareVersionDesc(a: string, b: string): number {
    const normalize = (v: string) => v.replace(/^v/, '').replace(/\s*\(.+\)/, '').trim().split('.').map(Number);
    const aParts = normalize(a);
    const bParts = normalize(b);
    const maxLen = Math.max(aParts.length, bParts.length);

    for (let i = 0; i < maxLen; i++) {
        const aNum = aParts[i] || 0;
        const bNum = bParts[i] || 0;
        if (aNum !== bNum) {
            return bNum - aNum; // 降序
        }
    }
    return 0;
}
