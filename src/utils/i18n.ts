import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// 缓存加载的语言文件
let languageCache: Map<string, Record<string, string>> = new Map();
let extensionPath: string = '';

// 初始化函数，在扩展激活时调用
export function initI18n(extPath: string) {
  extensionPath = extPath;
  loadLanguageFiles();
}

// 加载所有语言文件
function loadLanguageFiles() {
  if (!extensionPath) { return; }
  
  const l10nDir = path.join(extensionPath, 'l10n');
  if (!fs.existsSync(l10nDir)) { return; }
  
  try {
    const files = fs.readdirSync(l10nDir);
    for (const file of files) {
      if (file.startsWith('bundle.l10n') && file.endsWith('.json')) {
        const filePath = path.join(l10nDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const translations = JSON.parse(content);
          
          // 从文件名提取语言代码
          let langCode = 'en'; // 默认英文
          if (file === 'bundle.l10n.zh-cn.json') {
            langCode = 'zh-cn';
          } else if (file === 'bundle.l10n.zh-tw.json') {
            langCode = 'zh-tw';
          } else if (file.includes('.')) {
            // bundle.l10n.{lang}.json 格式
            const parts = file.split('.');
            if (parts.length >= 3) {
              langCode = parts[2];
            }
          }
          
          languageCache.set(langCode, translations);
        } catch (err) {
          console.warn('[i18n] Failed to load', file, ':', err);
        }
      }
    }
  } catch (err) {
    console.warn('[i18n] Failed to read l10n directory:', err);
  }
}

// 获取翻译，优先使用vscode.l10n，fallback到手动加载的文件
function getTranslation(key: string, fallback: string): string {
  // 首先尝试VS Code的l10n
  try {
    const vscodeTranslation = vscode.l10n.t(key);
    // 如果vscode.l10n.t返回的不是原始key，说明找到了翻译
    if (vscodeTranslation !== key) {
      return vscodeTranslation;
    }
  } catch (err) {
    // vscode.l10n.t可能出错，继续使用fallback
  }
  
  // fallback到手动加载的语言文件
  const locale = vscode.env.language || 'en';
  
  // 尝试精确匹配
  let translations = languageCache.get(locale);
  if (translations && translations[key]) {
    return translations[key];
  }
  
  // 尝试语言主代码匹配 (zh-cn -> zh)
  const mainLang = locale.split('-')[0];
  if (mainLang !== locale) {
    translations = languageCache.get(mainLang);
    if (translations && translations[key]) {
      return translations[key];
    }
  }
  
  // 尝试相似语言 (zh -> zh-cn)
  for (const [lang, trans] of languageCache) {
    if (lang.startsWith(mainLang) && trans[key]) {
      return trans[key];
    }
  }
  
  // 回退到英文
  translations = languageCache.get('en');
  if (translations && translations[key]) {
    return translations[key];
  }
  
  return fallback;
}

function humanize(s: string): string {
  if (!s) { return s; }
  // turn snake/camel to Title Case roughly
  const norm = s.replace(/[_\-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
  return norm.charAt(0).toUpperCase() + norm.slice(1);
}

export function labelForRoleKey(rawKey: string): string {
  if (!rawKey) { return rawKey; }
  
  // 若传入已是 l10n id（role.key.*），直接查找翻译
  if (rawKey.startsWith('role.key.')) {
    const suf = rawKey.slice('role.key.'.length);
    return getTranslation(rawKey, humanize(suf));
  }
  
  // 对于自定义键或者非标准键，先检查是否有直接翻译
  const directTranslation = getTranslation(rawKey, '');
  if (directTranslation) {
    return directTranslation;
  }
  
  // 尝试构建role.key.* 格式的键名
  const standardId = `role.key.${rawKey}`;
  const standardTranslation = getTranslation(standardId, '');
  if (standardTranslation) {
    return standardTranslation;
  }
  
  // 如果都没找到，返回人性化的原始键名
  return humanize(rawKey);
}
