import * as vscode from 'vscode';

export interface RoleDetailWrappingOptions {
    enableWrappingConfigKey?: string;
    wrapColumnConfigKey?: string;
}

const DEFAULT_ENABLE_WRAPPING_KEY = 'roles.details.enableWrapping';
const DEFAULT_WRAP_COLUMN_KEY = 'roles.details.wrapColumn';

const NON_WRAPPABLE_KEY_RE = /(^|[._\s-])(path|uri|url|href|uuid|regex|svg|icon|file|folder|directory)([._\s-]|$)|路径|源文件|文件|目录|文件夹|图标|正则|链接|地址|UUID/i;
const PATH_LIKE_VALUE_RE = /^(?:[a-zA-Z]:[\\/]|\\\\|\/|~[\\/]|file:\/\/|https?:\/\/|vscode-resource:|data:image\/|[.\w-]+[\\/])/;

export function getRoleDetailWrapColumn(
    cfg: vscode.WorkspaceConfiguration,
    options: RoleDetailWrappingOptions = {},
): number {
    return Math.max(5, Math.min(200, cfg.get<number>(options.wrapColumnConfigKey ?? DEFAULT_WRAP_COLUMN_KEY, 20) || 20));
}

export function isRoleDetailWrappingEnabled(
    cfg: vscode.WorkspaceConfiguration,
    options: RoleDetailWrappingOptions = {},
): boolean {
    return cfg.get<boolean>(options.enableWrappingConfigKey ?? DEFAULT_ENABLE_WRAPPING_KEY, true);
}

export function shouldWrapRoleDetail(
    key: string | undefined,
    value: string,
    cfg: vscode.WorkspaceConfiguration,
    options: RoleDetailWrappingOptions = {},
): boolean {
    if (!isRoleDetailWrappingEnabled(cfg, options)) {
        return false;
    }
    if (isNonWrappableRoleDetail(key, value)) {
        return false;
    }
    return true;
}

export function roleDetailNeedsExpansion(
    key: string | undefined,
    value: string | undefined,
    cfg: vscode.WorkspaceConfiguration,
    options: RoleDetailWrappingOptions = {},
): boolean {
    if (!value) {
        return false;
    }
    if (value.includes('\n')) {
        return true;
    }
    return shouldWrapRoleDetail(key, value, cfg, options) && value.length > getRoleDetailWrapColumn(cfg, options);
}

export function splitRoleDetailLines(
    key: string | undefined,
    value: string,
    cfg: vscode.WorkspaceConfiguration,
    options: RoleDetailWrappingOptions = {},
): string[] {
    const lines: string[] = [];
    const shouldWrap = shouldWrapRoleDetail(key, value, cfg, options);
    const wrapColumn = getRoleDetailWrapColumn(cfg, options);

    const pushLine = (part: string) => {
        if (!shouldWrap || part.length <= wrapColumn) {
            lines.push(part);
            return;
        }
        let i = 0;
        while (i < part.length) {
            lines.push(part.slice(i, i + wrapColumn));
            i += wrapColumn;
        }
    };

    for (const part of value.split(/\r?\n/)) {
        pushLine(part);
    }
    return lines;
}

function isNonWrappableRoleDetail(key: string | undefined, value: string): boolean {
    const normalizedKey = String(key ?? '').trim();
    if (NON_WRAPPABLE_KEY_RE.test(normalizedKey)) {
        return true;
    }

    const trimmed = value.trim();
    if (PATH_LIKE_VALUE_RE.test(trimmed)) {
        return true;
    }

    return false;
}
