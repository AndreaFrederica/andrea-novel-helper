/**
 * UUID v7 工具模块
 * 提供 UUID v7 生成和管理功能
 */

import * as crypto from 'crypto';

/**
 * 生成 UUID v7
 * UUID v7 格式：时间戳 + 随机数，保证时间有序性
 * 格式：xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
 * 其中 x 是时间戳和随机数，y 的前两位是版本和变体标识
 */
export function generateUUIDv7(): string {
    // 获取当前时间戳（毫秒）
    const timestamp = Date.now();
    
    // 生成随机字节
    const randomBytes = crypto.randomBytes(10);
    
    // 构建 UUID v7
    // 前 48 位：时间戳（毫秒）
    const timestampHex = timestamp.toString(16).padStart(12, '0');
    
    // 接下来 12 位：版本号（7）+ 随机数
    const versionAndRandom1 = '7' + randomBytes[0].toString(16).padStart(2, '0').slice(1);
    
    // 接下来 14 位：变体标识（10）+ 随机数
    const variantAndRandom = (0x80 | (randomBytes[1] & 0x3f)).toString(16) + randomBytes[2].toString(16).padStart(2, '0');
    
    // 最后 48 位：随机数
    const finalRandom = randomBytes.slice(3, 9).toString('hex');
    
    // 组装 UUID
    const uuid = [
        timestampHex.slice(0, 8),
        timestampHex.slice(8, 12),
        versionAndRandom1,
        variantAndRandom,
        finalRandom
    ].join('-');
    
    return uuid;
}

/**
 * 验证 UUID 格式是否正确
 * @param uuid 要验证的 UUID 字符串
 * @returns 是否为有效的 UUID 格式
 */
export function isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
}

/**
 * 验证是否为 UUID v7 格式
 * @param uuid 要验证的 UUID 字符串
 * @returns 是否为有效的 UUID v7 格式
 */
export function isValidUUIDv7(uuid: string): boolean {
    if (!isValidUUID(uuid)) {
        return false;
    }
    
    // 检查版本号是否为 7
    const versionChar = uuid.charAt(14);
    return versionChar === '7';
}

/**
 * 从角色名生成类似 UUID 格式的哈希
 * 用于 txt 格式角色，因为无法修改文件内容
 * @param roleName 角色名称
 * @returns 类似 UUID 格式的哈希字符串
 */
export function generateRoleNameHash(roleName: string): string {
    // 使用 SHA-256 生成哈希
    const hash = crypto.createHash('sha256').update(roleName, 'utf8').digest('hex');
    
    // 将哈希转换为 UUID 格式
    // 取前 32 个字符，按 UUID 格式分组
    const uuid = [
        hash.slice(0, 8),
        hash.slice(8, 12),
        hash.slice(12, 16),
        hash.slice(16, 20),
        hash.slice(20, 32)
    ].join('-');
    
    return uuid;
}

/**
 * 从 UUID 中提取时间戳（仅适用于 UUID v7）
 * @param uuid UUID v7 字符串
 * @returns 时间戳（毫秒），如果不是有效的 UUID v7 则返回 null
 */
export function extractTimestampFromUUIDv7(uuid: string): number | null {
    if (!isValidUUIDv7(uuid)) {
        return null;
    }
    
    // 提取前 48 位时间戳
    const timestampHex = uuid.replace(/-/g, '').slice(0, 12);
    const timestamp = parseInt(timestampHex, 16);
    
    return timestamp;
}

/**
 * 比较两个 UUID v7 的时间顺序
 * @param uuid1 第一个 UUID v7
 * @param uuid2 第二个 UUID v7
 * @returns 负数表示 uuid1 更早，正数表示 uuid2 更早，0 表示同时
 */
export function compareUUIDv7Timestamps(uuid1: string, uuid2: string): number {
    const timestamp1 = extractTimestampFromUUIDv7(uuid1);
    const timestamp2 = extractTimestampFromUUIDv7(uuid2);
    
    if (timestamp1 === null || timestamp2 === null) {
        return 0;
    }
    
    return timestamp1 - timestamp2;
}
