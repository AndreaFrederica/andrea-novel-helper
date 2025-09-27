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
    // 前 48 位：时间戳（毫秒） => 12 hex
    const timestampHex = timestamp.toString(16).padStart(12, '0');

    // 接下来 16 位（4 hex）：版本号（7）放在高位的 4-bit，剩余 12-bit 取随机数
    const randA = (randomBytes[0] << 8) | randomBytes[1];
    const third = (0x7000 | (randA & 0x0fff)).toString(16).padStart(4, '0');

    // 接下来 16 位（4 hex）：变体（10xx）填到高两位（0x8000）并保留低 14-bit 随机
    const randB = (randomBytes[2] << 8) | randomBytes[3];
    const fourth = (0x8000 | (randB & 0x3fff)).toString(16).padStart(4, '0');

    // 最后 48 位：剩余 6 bytes -> 12 hex
    const finalRandom = randomBytes.slice(4, 10).toString('hex');

    const uuid = [
        timestampHex.slice(0, 8),
        timestampHex.slice(8, 12),
        third,
        fourth,
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
    if (!uuid || typeof uuid !== 'string') { return false; }
    const s = uuid.trim();
    // 支持 urn:uuid: 前缀和大括号包裹
    const stripped = s.replace(/^urn:uuid:/i, '').replace(/^\{|\}$/g, '');
    // 接受带连字符的标准格式或不带连字符的 32 位十六进制字符串
    const hyphenated = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const plain = /^[0-9a-f]{32}$/i;
    if (hyphenated.test(stripped)) { return true; }
    if (plain.test(stripped)) { return true; }
    // 也接受只包含十六进制且长度接近 32 的字符串（去掉所有非十六进制字符后判断）
    // 有些历史/自定义生成器可能产生略短于 32 的 hex（例如 30），我们这里兼容 30-32 长度
    const compact = stripped.replace(/[^0-9a-f]/ig, '');
    return compact.length >= 30 && compact.length <= 32 && new RegExp(`^[0-9a-f]{${Math.max(30, compact.length)}}$`, 'i').test(compact);
}

/**
 * 验证是否为 UUID v7 格式
 * @param uuid 要验证的 UUID 字符串
 * @returns 是否为有效的 UUID v7 格式
 */
export function isValidUUIDv7(uuid: string): boolean {
    if (!isValidUUID(uuid)) { return false; }
    // 统一提取纯十六进制字符串（不含连字符/大括号/前缀）
    const hex = uuid.replace(/[^0-9a-f]/ig, '').toLowerCase();
    // 只要存在第 13 个十六进制字符，就可以读取版本号进行判断；兼容少量分组或短一些的生成器
    if (hex.length < 13) { return false; }
    // UUID 的第 13 个十六进制字符（index 12）为版本号
    const versionChar = hex.charAt(12);
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
