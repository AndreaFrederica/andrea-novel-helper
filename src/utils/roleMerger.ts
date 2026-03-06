/**
 * 角色合并器
 * 负责处理具有相同UUID的角色数据合并
 */

import { Role } from '../extension';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * 优先级构成记录
 */
export interface PriorityBreakdown {
    total: number;  // 总优先级
    source: {
        fileDefined?: number;  // 文件中定义的优先级
        location?: number;     // 位置优先级
        fileName?: number;     // 文件名优先级
        fileType?: number;     // 文件类型优先级
        default?: number;      // 默认优先级
    };
}

/**
 * 角色优先级配置
 */
export interface RolePriorityConfig {
    // 基础策略
    strategy: 'loadOrder' | 'custom';  // 按加载顺序或自定义优先级

    // 自定义优先级组件（每个都可以独立启用/禁用）
    enableFileNamePriority?: boolean;  // 是否启用文件名优先级
    enableFileTypePriority?: boolean;  // 是否启用文件类型优先级
    enableLocationPriority?: boolean;  // 是否启用位置优先级（外部vs内部）

    // 文件名优先级配置
    fileNamePriority?: {
        prefixes?: { [prefix: string]: number };  // 前缀和对应的优先级
        naturalSort?: boolean;  // 是否使用自然排序（file1 < file2）
    };

    // 文件类型优先级配置
    fileTypePriority?: { [ext: string]: number };

    // 位置优先级配置
    locationPriority?: {
        external?: number;  // 外部文件（外部资源目录）的优先级
        internal?: number;  // 内部文件的优先级
    };

    // 默认优先级
    defaultPriority?: number;
}

/**
 * 默认的文件类型优先级
 */
export const DEFAULT_FILE_TYPE_PRIORITY: { [key: string]: number } = {
    '.md': 1,        // MD文件默认最低优先级
    '.json5': 2,     // JSON5文件中等优先级
    '.ojson5': 3,    // OJSON5文件高优先级
    '.txt': 0        // TXT文件最低优先级
};

/**
 * 默认的文件名前缀优先级
 */
export const DEFAULT_PREFIX_PRIORITY: { [key: string]: number } = {
    '__': 1000,      // 双下划线前缀
    '!!': 2000,      // 双感叹号前缀
    '!!!': 3000,     // 三感叹号前缀
    'override_': 1500, // 覆盖前缀
    'config_': 500,   // 配置前缀
};

/**
 * 智能角色添加器
 * 在添加角色时自动处理合并
 */
export class SmartRoleAdder {
    private roles: Role[];
    private uuidMap = new Map<string, Role>();
    private nameMap = new Map<string, Role>();
    private priorityConfig: RolePriorityConfig;
    private externalFoldersNormalized = new Set<string>();

    constructor(rolesArray: Role[], priorityConfig?: Partial<RolePriorityConfig>) {
        this.roles = rolesArray;
        // 获取配置
        const cfg = vscode.workspace.getConfiguration('AndreaNovelHelper');
        const configFromSettings = cfg.get<object>('rolePriority') || {};

        // 默认配置
        this.priorityConfig = {
            strategy: 'loadOrder',
            enableFileNamePriority: false,
            enableFileTypePriority: false,
            enableLocationPriority: false,
            fileNamePriority: {
                prefixes: DEFAULT_PREFIX_PRIORITY,
                naturalSort: true
            },
            fileTypePriority: DEFAULT_FILE_TYPE_PRIORITY,
            locationPriority: {
                external: 100,
                internal: 0
            },
            defaultPriority: 0,
            ...priorityConfig,
            ...configFromSettings
        };
        // 初始化时构建映射表
        this.rebuildMaps();
    }

    /**
     * 更新外部资源目录列表（由 loadRoles 扫描结果提供）
     */
    public setExternalFolders(folders: string[]): void {
        this.externalFoldersNormalized.clear();
        for (const folder of folders) {
            this.externalFoldersNormalized.add(this.normalizePathForCompare(folder));
        }
    }

    private normalizePathForCompare(p: string): string {
        const normalized = path.resolve(p).replace(/[\\/]+/g, path.sep);
        return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    }

    /**
     * 检查是否为外部文件（外部资源目录，兼容 legacy __init__.ojson5）
     */
    private isExternalFile(filePath: string): boolean {
        const normalizedFilePath = this.normalizePathForCompare(filePath);

        // 优先使用 loadRoles 的外部目录扫描结果
        if (this.externalFoldersNormalized.size > 0) {
            for (const folder of this.externalFoldersNormalized) {
                if (normalizedFilePath === folder || normalizedFilePath.startsWith(folder + path.sep)) {
                    return true;
                }
            }
        }

        // 兼容旧机制：沿父目录向上查找 __init__.ojson5
        let dir = path.dirname(filePath);
        while (true) {
            try {
                if (fs.existsSync(path.join(dir, '__init__.ojson5'))) {
                    return true;
                }
            } catch {
                // ignore
            }
            const parent = path.dirname(dir);
            if (parent === dir) break;
            dir = parent;
        }

        // 兜底：保持旧行为（同目录 __init__.ojson5）
        try {
            if (fs.existsSync(path.join(path.dirname(filePath), '__init__.ojson5'))) {
                return true;
            }
        } catch {
            // 忽略错误
        }
        return false;
    }

    /**
     * 自然排序比较
     * 处理文件名中的数字（file1.txt < file2.txt < file10.txt）
     */
    private naturalCompare(a: string, b: string): number {
        const regex = /(\d+)|(\D+)/g;
        const aParts = a.match(regex) || [];
        const bParts = b.match(regex) || [];

        const len = Math.min(aParts.length, bParts.length);

        for (let i = 0; i < len; i++) {
            const aPart = aParts[i];
            const bPart = bParts[i];

            if (aPart !== bPart) {
                const aIsNum = /^\d+$/.test(aPart);
                const bIsNum = /^\d+$/.test(bPart);

                if (aIsNum && bIsNum) {
                    return parseInt(aPart) - parseInt(bPart);
                } else if (aIsNum) {
                    return -1;
                } else if (bIsNum) {
                    return 1;
                } else {
                    return aPart.localeCompare(bPart);
                }
            }
        }

        return aParts.length - bParts.length;
    }

    /**
     * 计算角色的优先级（返回详细的构成）
     */
    private calculateRolePriority(role: Role): PriorityBreakdown {
        const breakdown: PriorityBreakdown = {
            total: 0,
            source: {}
        };

        if (!role.sourcePath || this.priorityConfig.strategy === 'loadOrder') {
            // 加载顺序策略使用预设的优先级
            const fileDefinedPriority = (role as any)._priority || role.priority || 0;
            breakdown.total = fileDefinedPriority;
            breakdown.source.fileDefined = fileDefinedPriority;
            return breakdown;
        }

        const fileName = path.basename(role.sourcePath);
        const ext = path.extname(role.sourcePath).toLowerCase();
        const isExternal = this.isExternalFile(role.sourcePath);

        // 1. 文件中定义的优先级（最高优先级）
        const fileDefinedPriority = (role as any)._priority || 0;
        if (fileDefinedPriority !== 0) {
            breakdown.source.fileDefined = fileDefinedPriority;
            breakdown.total += fileDefinedPriority;
        }

        // 2. 位置优先级（外部vs内部）
        if (this.priorityConfig.enableLocationPriority) {
            const locationBonus = isExternal
                ? (this.priorityConfig.locationPriority?.external || 0)
                : (this.priorityConfig.locationPriority?.internal || 0);
            if (locationBonus !== 0) {
                breakdown.source.location = locationBonus;
                breakdown.total += locationBonus;
            }
        }

        // 3. 文件名优先级
        if (this.priorityConfig.enableFileNamePriority) {
            let fileNameBonus = 0;

            // 前缀优先级
            const prefixes = this.priorityConfig.fileNamePriority?.prefixes || {};
            for (const [prefix, value] of Object.entries(prefixes)) {
                if (fileName.startsWith(prefix)) {
                    fileNameBonus = value;
                    break;
                }
            }

            // 自然排序（按文件名字母顺序）
            if (fileNameBonus === 0 && this.priorityConfig.fileNamePriority?.naturalSort) {
                // 这里我们需要一个基准来比较，暂时返回0
                // 实际使用时需要和所有文件进行比较
            }

            if (fileNameBonus !== 0) {
                breakdown.source.fileName = fileNameBonus;
                breakdown.total += fileNameBonus;
            }
        }

        // 4. 文件类型优先级
        if (this.priorityConfig.enableFileTypePriority) {
            const typePriority = this.priorityConfig.fileTypePriority?.[ext] || 0;
            if (typePriority !== 0) {
                breakdown.source.fileType = typePriority;
                breakdown.total += typePriority;
            }
        }

        // 5. 默认优先级
        const defaultPriority = this.priorityConfig.defaultPriority || 0;
        if (defaultPriority !== 0) {
            breakdown.source.default = defaultPriority;
            breakdown.total += defaultPriority;
        }

        return breakdown;
    }

    /**
     * 更新优先级配置
     */
    updatePriorityConfig(config: Partial<RolePriorityConfig>) {
        this.priorityConfig = { ...this.priorityConfig, ...config };
    }

    /**
     * 重建映射表
     */
    private rebuildMaps() {
        this.uuidMap.clear();
        this.nameMap.clear();

        for (const role of this.roles) {
            if (role.uuid) {
                this.uuidMap.set(role.uuid, role);
            }
            this.nameMap.set(role.name, role);
        }
    }

    /**
     * 智能添加角色
     * 如果已存在相同UUID的角色，则合并
     * @param newRole 要添加的角色
     */
    addRole(newRole: Role) {
        // 如果有UUID，检查是否已存在
        if (newRole.uuid) {
            const existingRole = this.uuidMap.get(newRole.uuid);
            if (existingRole) {
                // 根据优先级策略决定哪个作为基础角色
                let baseRole = existingRole;
                let mergeRole = newRole;

                if (this.priorityConfig.strategy === 'custom') {
                    // 计算优先级
                    const existingBreakdown = this.calculateRolePriority(existingRole);
                    const newBreakdown = this.calculateRolePriority(newRole);

                    console.log(`[SmartRoleAdder] 优先级对比: ${existingRole.name}(${existingBreakdown.total}) vs ${newRole.name}(${newBreakdown.total})`);
                    console.log(`[SmartRoleAdder] ${existingRole.name} 优先级构成:`, existingBreakdown.source);
                    console.log(`[SmartRoleAdder] ${newRole.name} 优先级构成:`, newBreakdown.source);

                    // 如果新角色优先级更高，则调换顺序
                    if (newBreakdown.total > existingBreakdown.total) {
                        baseRole = newRole;
                        mergeRole = existingRole;
                    }
                }

                // 合并角色
                const merged = mergeRoles(baseRole, mergeRole);

                // 更新合并后的优先级信息（使用基础角色的优先级）
                if (this.priorityConfig.strategy === 'custom') {
                    const baseBreakdown = this.calculateRolePriority(baseRole);
                    (merged as any)._computedPriority = baseBreakdown.total;
                    (merged as any)._priorityBreakdown = baseBreakdown;
                }

                // 更新映射表中的角色对象
                if (baseRole.uuid) {
                    this.uuidMap.set(baseRole.uuid, merged);
                }
                if (merged.name) {
                    this.nameMap.set(merged.name, merged);
                }

                // 更新原数组中的角色对象
                const index = this.roles.indexOf(existingRole);
                if (index !== -1) {
                    this.roles[index] = merged;
                }

                console.log(`[SmartRoleAdder] 合并角色: ${baseRole.name} + ${mergeRole.name} = ${merged.name} (UUID: ${baseRole.uuid})`);
                if ((merged as any)._priorityBreakdown) {
                    console.log(`[SmartRoleAdder] 合并后优先级构成:`, (merged as any)._priorityBreakdown.source);
                }
                return;
            }
        }

        // 没有UUID或UUID不冲突，直接添加
        // 为角色计算并保存优先级信息
        const priorityBreakdown = this.calculateRolePriority(newRole);
        (newRole as any)._computedPriority = priorityBreakdown.total;
        (newRole as any)._priorityBreakdown = priorityBreakdown;

        this.roles.push(newRole);
        if (newRole.uuid) {
            this.uuidMap.set(newRole.uuid, newRole);
        }
        this.nameMap.set(newRole.name, newRole);

        console.log(`[SmartRoleAdder] 添加角色: ${newRole.name} (UUID: ${newRole.uuid}, 优先级: ${priorityBreakdown.total})`);
        console.log(`[SmartRoleAdder] 优先级构成:`, priorityBreakdown.source);
    }

    /**
     * 根据UUID获取角色
     */
    getRoleByUuid(uuid: string): Role | undefined {
        return this.uuidMap.get(uuid);
    }

    /**
     * 根据名称获取角色
     */
    getRoleByName(name: string): Role | undefined {
        return this.nameMap.get(name);
    }

    /**
     * 获取所有UUID映射
     */
    getAllUuidMappings(): Map<string, Role> {
        return new Map(this.uuidMap);
    }

    /**
     * 移除指定文件的所有角色并重建映射表
     * @param filePath 文件路径
     */
    removeRolesByFile(filePath: string): void {
        const removed = new Set<Role>();
        // 从数组中删除
        for (let i = this.roles.length - 1; i >= 0; i--) {
            if (this.roles[i].sourcePath === filePath) {
                const role = this.roles[i];
                removed.add(role);
                this.roles.splice(i, 1);
            }
        }
        // 重建映射表（移除已删除的角色）
        if (removed.size > 0) {
            this.rebuildMaps();
            console.log(`[SmartRoleAdder] 移除了 ${removed.size} 个来自 ${filePath} 的角色`);
        }
    }
}

/**
 * 合并两个角色对象
 * @param baseRole 基础角色对象（优先保留其属性）
 * @param mergeRole 要合并的角色对象
 * @returns 合并后的角色对象
 */
export function mergeRoles(baseRole: Role, mergeRole: Role): Role {
    // 创建一个新对象，避免修改原始对象
    const merged: Role = { ...baseRole };

    // 合并策略：
    // 1. 保留基础角色的UUID和类型等核心属性
    // 2. 如果两个角色名称不同，将不同的名称添加到别名中
    // 3. 合并非空属性，基础角色优先
    // 4. 特殊处理数组和对象属性

    // 处理名称：如果名称不同，将非基础角色的名称添加到别名中
    const allNames = new Set<string>();
    allNames.add(baseRole.name);
    if (mergeRole.name && mergeRole.name !== baseRole.name) {
        allNames.add(mergeRole.name);
    }

    // 合并描述
    if (mergeRole.description && !baseRole.description) {
        merged.description = mergeRole.description;
    }

    // 合并颜色（基础角色优先）
    if (mergeRole.color && !baseRole.color) {
        merged.color = mergeRole.color;
    }

    // 合并从属信息
    if (mergeRole.affiliation && !baseRole.affiliation) {
        merged.affiliation = mergeRole.affiliation;
    }

    // 合并别名：包含基础别名、合并角色的别名，以及不同的名称
    const baseAliases = baseRole.aliases || [];
    const mergeAliases = mergeRole.aliases || [];
    const allAliases = new Set<string>(baseAliases);

    // 添加合并角色的别名
    for (const alias of mergeAliases) {
        allAliases.add(alias);
    }

    // 移除已经存在于名称集合中的别名
    for (const alias of allAliases) {
        if (allNames.has(alias)) {
            allAliases.delete(alias);
        }
    }

    // 设置最终的别名
    merged.aliases = Array.from(allAliases);

    // 合并修复候选（数组合并去重）
    if (mergeRole.fixes && mergeRole.fixes.length > 0) {
        const baseFixes = baseRole.fixes || [];
        merged.fixes = [...new Set([...baseFixes, ...mergeRole.fixes])];
    }

    // 合并优先级（取较小值，表示更高优先级）
    if (mergeRole.priority !== undefined && baseRole.priority !== undefined) {
        merged.priority = Math.min(baseRole.priority, mergeRole.priority);
    } else if (mergeRole.priority !== undefined) {
        merged.priority = mergeRole.priority;
    }

    // 合并分词过滤设置
    if (mergeRole.wordSegmentFilter !== undefined && baseRole.wordSegmentFilter === undefined) {
        merged.wordSegmentFilter = mergeRole.wordSegmentFilter;
    }

    // 合并 style 字段（深度合并）
    try {
        const baseStyle = (baseRole.style && typeof baseRole.style === 'object') ? baseRole.style : {};
        const mergeStyle = (mergeRole.style && typeof mergeRole.style === 'object') ? mergeRole.style : {};
        const mergedStyle: any = { ...baseStyle };

        // 合并 style 对象的各个属性（基础角色优先）
        for (const key of Object.keys(mergeStyle)) {
            if (mergedStyle[key] === undefined) {
                mergedStyle[key] = mergeStyle[key];
            }
        }
        // 只有当有实际内容时才设置 style
        if (Object.keys(mergedStyle).length > 0) {
            merged.style = mergedStyle;
        }
    } catch (error) {
        console.error('[mergeRoles] style 字段合并失败:', error, 'baseRole:', baseRole.name, 'mergeRole:', mergeRole.name);
        // 发生错误时，保留基础角色的 style（如果有）
        if (baseRole.style) {
            merged.style = baseRole.style;
        } else if (mergeRole.style) {
            merged.style = mergeRole.style;
        }
    }

    // 合并正则表达式（仅适用于正则表达式角色）
    if (mergeRole.regex && !baseRole.regex) {
        merged.regex = mergeRole.regex;
    }
    if (mergeRole.regexFlags && !baseRole.regexFlags) {
        merged.regexFlags = mergeRole.regexFlags;
    }

    // 合并计算优先级（保留基础角色的优先级）
    const baseComputedPriority = (baseRole as any)._computedPriority;
    const mergeComputedPriority = (mergeRole as any)._computedPriority;
    if (baseComputedPriority !== undefined && mergeComputedPriority !== undefined) {
        // 取较高值（合并角色中优先级高的保留）
        (merged as any)._computedPriority = Math.max(baseComputedPriority, mergeComputedPriority);
    } else if (baseComputedPriority !== undefined) {
        (merged as any)._computedPriority = baseComputedPriority;
    }

    // 合并文件中定义的优先级（取较大值）
    const baseFilePriority = (baseRole as any)._priority;
    const mergeFilePriority = (mergeRole as any)._priority;
    if (baseFilePriority !== undefined && mergeFilePriority !== undefined) {
        (merged as any)._priority = Math.max(baseFilePriority, mergeFilePriority);
    } else if (baseFilePriority !== undefined) {
        (merged as any)._priority = baseFilePriority;
    } else if (mergeFilePriority !== undefined) {
        (merged as any)._priority = mergeFilePriority;
    }

    // 合并优先级构成（合并两个来源）
    const baseBreakdown = (baseRole as any)._priorityBreakdown;
    const mergeBreakdown = (mergeRole as any)._priorityBreakdown;
    if (baseBreakdown || mergeBreakdown) {
        const combinedBreakdown: PriorityBreakdown = {
            total: (merged as any)._computedPriority || 0,
            source: {}
        };

        // 合并各个来源
        const sources = ['fileDefined', 'location', 'fileName', 'fileType', 'default'] as const;
        for (const source of sources) {
            const baseValue = baseBreakdown?.source?.[source];
            const mergeValue = mergeBreakdown?.source?.[source];
            if (baseValue !== undefined || mergeValue !== undefined) {
                combinedBreakdown.source[source] = Math.max(
                    baseValue || 0,
                    mergeValue || 0
                );
            }
        }

        (merged as any)._priorityBreakdown = combinedBreakdown;
    }

    // 合并其他自定义属性
    for (const key in mergeRole) {
        if (key === 'name' || key === 'uuid' || key === 'type' ||
            key === 'description' || key === 'color' || key === 'affiliation' ||
            key === 'aliases' || key === 'fixes' || key === 'priority' ||
            key === 'wordSegmentFilter' || key === 'regex' || key === 'regexFlags' ||
            key === 'style') {
            continue; // 已处理的属性
        }

        // 如果基础角色没有该属性，而要合并的角色有，则复制
        if (baseRole[key as keyof Role] === undefined && mergeRole[key as keyof Role] !== undefined) {
            (merged as any)[key] = mergeRole[key as keyof Role];
        }
    }

    return merged;
}

/**
 * 基于UUID合并角色数组
 * @param roles 角色数组
 * @returns 合并后的角色数组（每个UUID只保留一个角色）
 */
export function mergeRolesByUUID(roles: Role[]): Role[] {
    // 创建UUID到角色的映射
    const uuidMap = new Map<string, Role>();

    for (const role of roles) {
        if (!role.uuid) {
            // 没有UUID的角色直接添加
            uuidMap.set(role.name, role);
            continue;
        }

        const existing = uuidMap.get(role.uuid);
        if (existing) {
            // 合并角色
            const merged = mergeRoles(existing, role);
            uuidMap.set(role.uuid, merged);
        } else {
            // 首次遇到该UUID，直接添加
            uuidMap.set(role.uuid, role);
        }
    }

    // 转换回数组
    return Array.from(uuidMap.values());
}
