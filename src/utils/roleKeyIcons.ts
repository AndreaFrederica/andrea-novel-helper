import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

let iconMap: Record<string, string> | null = null;

function loadIcons() {
  if (iconMap) { return; }
  try {
    const ext = vscode.extensions.getExtension('AndreaFrederica.andrea-novel-helper');
    const base = ext?.extensionPath || path.resolve(__dirname, '..', '..'); // out/utils -> root
    const file = path.join(base, 'resources', 'role-detail-icons.json');
    const txt = fs.readFileSync(file, 'utf8');
    const obj = JSON.parse(txt) as Record<string, string>;
    const map: Record<string, string> = Object.create(null);
    for (const [k, v] of Object.entries(obj)) { map[k.toLowerCase()] = v; }
    iconMap = map;
  } catch (e) {
    console.warn('[ANH] load role-detail-icons.json failed', e);
    iconMap = { '__default__': 'symbol-field' };
  }
}

export function toL10nKey(rawKey: string): string {
  const k = (rawKey || '').toString();
  return k.startsWith('role.key.') ? k : `role.key.${k}`;
}

export function iconForRoleKey(rawKey: string): vscode.ThemeIcon {
  loadIcons();
  const k = toL10nKey(rawKey).toLowerCase();
  const name = (iconMap as any)?.[k] || (iconMap as any)?.['__default__'] || 'symbol-field';
  return new vscode.ThemeIcon(name);
}