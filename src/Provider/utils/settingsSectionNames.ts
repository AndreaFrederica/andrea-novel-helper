import * as vscode from 'vscode';
import { getTranslation } from '../../utils/i18n';

type SectionLocale = 'zh' | 'ja' | 'en';

const sectionNames: Record<string, Record<SectionLocale, string>> = {
    'AndreaNovelHelper.allRoles': {
        zh: '全部角色',
        ja: 'すべてのキャラクター',
        en: 'All Roles'
    },
    'AndreaNovelHelper.autoGit': {
        zh: '自动 Git',
        ja: '自動 Git',
        en: 'Auto Git'
    },
    'AndreaNovelHelper.autoScroll': {
        zh: '自动滚动',
        ja: '自動スクロール',
        en: 'Auto Scroll'
    },
    'AndreaNovelHelper.comments': {
        zh: '批注设置',
        ja: 'コメント設定',
        en: 'Comments'
    },
    'AndreaNovelHelper.completion': {
        zh: '自动补全',
        ja: '自動補完',
        en: 'Completion'
    },
    'AndreaNovelHelper.database': {
        zh: '数据库设置',
        ja: 'データベース設定',
        en: 'Database'
    },
    'AndreaNovelHelper.debug': {
        zh: '调试设置',
        ja: 'デバッグ設定',
        en: 'Debug'
    },
    'AndreaNovelHelper.decorations': {
        zh: '装饰设置',
        ja: '装飾設定',
        en: 'Decorations'
    },
    'AndreaNovelHelper.docRoles': {
        zh: '文档角色',
        ja: 'ドキュメント内キャラクター',
        en: 'Document Roles'
    },
    'AndreaNovelHelper.externalFolder': {
        zh: '外部文件夹',
        ja: '外部フォルダー',
        en: 'External Folders'
    },
    'AndreaNovelHelper.fileTracker': {
        zh: '文件追踪',
        ja: 'ファイル追跡',
        en: 'File Tracking'
    },
    'AndreaNovelHelper.hello': {
        zh: '欢迎页',
        ja: 'ウェルカムページ',
        en: 'Welcome Page'
    },
    'AndreaNovelHelper.hugeFile': {
        zh: '大文件处理',
        ja: '大容量ファイル処理',
        en: 'Large File Handling'
    },
    'AndreaNovelHelper.lookupKeys': {
        zh: '查找键',
        ja: '検索キー',
        en: 'Lookup Keys'
    },
    'AndreaNovelHelper.outline': {
        zh: '大纲设置',
        ja: 'アウトライン設定',
        en: 'Outline'
    },
    'AndreaNovelHelper.package': {
        zh: '包管理器',
        ja: 'パッケージマネージャー',
        en: 'Package Manager'
    },
    'AndreaNovelHelper.roleEditor': {
        zh: '角色编辑器',
        ja: 'キャラクターエディター',
        en: 'Role Editor'
    },
    'AndreaNovelHelper.roles': {
        zh: '角色设置',
        ja: 'キャラクター設定',
        en: 'Roles'
    },
    'AndreaNovelHelper.scripts': {
        zh: '脚本设置',
        ja: 'スクリプト設定',
        en: 'Scripts'
    },
    'AndreaNovelHelper.sensitiveWords': {
        zh: '敏感词设置',
        ja: 'センシティブワード設定',
        en: 'Sensitive Words'
    },
    'AndreaNovelHelper.obsidian': {
        zh: 'Obsidian 兼容',
        ja: 'Obsidian 互換',
        en: 'Obsidian Compatibility'
    },
    'AndreaNovelHelper.smartTabGroupLock': {
        zh: '智能标签组锁定',
        ja: 'スマートタブグループロック',
        en: 'Smart Tab Group Lock'
    },
    'AndreaNovelHelper.startupSnapshot': {
        zh: '启动快照',
        ja: '起動時スナップショット',
        en: 'Startup Snapshot'
    },
    'AndreaNovelHelper.timeStats': {
        zh: '时间统计',
        ja: '時間統計',
        en: 'Time Statistics'
    },
    'AndreaNovelHelper.translate': {
        zh: '翻译设置',
        ja: '翻訳設定',
        en: 'Translation'
    },
    'AndreaNovelHelper.typo': {
        zh: '拼写检查',
        ja: '誤字チェック',
        en: 'Proofing'
    },
    'AndreaNovelHelper.webdav': {
        zh: 'WebDAV',
        ja: 'WebDAV',
        en: 'WebDAV'
    },
    'AndreaNovelHelper.whatsNew': {
        zh: '更新说明',
        ja: '更新情報',
        en: "What's New"
    },
    'AndreaNovelHelper.wordCount': {
        zh: '字数统计',
        ja: '文字数統計',
        en: 'Word Count'
    },
    'AndreaNovelHelper.wordSegment': {
        zh: '分词设置',
        ja: '単語分割設定',
        en: 'Word Segmentation'
    },
    'AndreaNovelHelper.writingDashboard': {
        zh: '创作工作台',
        ja: '執筆ダッシュボード',
        en: 'Writing Dashboard'
    },
    'andrea.roleJson5': {
        zh: '角色 JSON5',
        ja: 'キャラクター JSON5',
        en: 'Role JSON5'
    },
    'andrea.typeset': {
        zh: '排版设置',
        ja: '組版設定',
        en: 'Typesetting'
    },
    'andrea.typst': {
        zh: 'Typst 设置',
        ja: 'Typst 設定',
        en: 'Typst'
    },
    'editor': {
        zh: 'VS Code 编辑器',
        ja: 'VS Code エディター',
        en: 'VS Code Editor'
    },
    'other': {
        zh: '其它设置',
        ja: 'その他の設定',
        en: 'Other Settings'
    }
};

export function formatSettingsSectionName(sectionId: string): string {
    const translated = getTranslation(`settings.section.${sectionId}`, '');
    if (translated) {
        return translated;
    }

    const direct = getBuiltInSectionName(sectionId);
    if (direct) {
        return direct;
    }

    const firstDot = sectionId.indexOf('.');
    let lastDot = sectionId.lastIndexOf('.');
    while (firstDot >= 0 && lastDot > firstDot) {
        const parentId = sectionId.substring(0, lastDot);
        const parent = getBuiltInSectionName(parentId);
        if (parent) {
            return parent;
        }
        lastDot = parentId.lastIndexOf('.');
    }

    return humanizeSectionId(sectionId);
}

function getBuiltInSectionName(sectionId: string): string | undefined {
    const names = sectionNames[sectionId];
    if (!names) {
        return undefined;
    }

    const locale = getSectionLocale();
    return names[locale] || names.en || names.zh;
}

function getSectionLocale(): SectionLocale {
    const language = (vscode.env.language || 'en').toLowerCase();
    if (language.startsWith('zh')) {
        return 'zh';
    }
    if (language.startsWith('ja')) {
        return 'ja';
    }
    return 'en';
}

function humanizeSectionId(sectionId: string): string {
    const segment = sectionId.split('.').pop() || sectionId;
    return segment
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/^\w/, first => first.toUpperCase());
}
