/**
 * UUID v7 工具模块 (Webview 版本)
 * 提供 UUID v7 生成功能
 */

/**
 * 生成 UUID v7
 * UUID v7 格式：时间戳 + 随机数，保证时间有序性
 * 格式：xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
 * 其中 x 是时间戳和随机数，y 的前两位是版本和变体标识
 */
export function generateUUIDv7(): string {
    // 获取当前时间戳（毫秒）
    const timestamp = Date.now();
    
    // 生成随机字节（使用 Web Crypto API 或 Math.random 作为后备）
    const randomBytes = new Uint8Array(10);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(randomBytes);
    } else {
        // 后备方案：使用 Math.random
        for (let i = 0; i < randomBytes.length; i++) {
            randomBytes[i] = Math.floor(Math.random() * 256);
        }
    }
    
    // 构建 UUID v7
    // 前 48 位：时间戳（毫秒）
    const timestampHex = timestamp.toString(16).padStart(12, '0');
    
    // 接下来 12 位：版本号（7）+ 随机数
    const versionAndRandom1 = '7' + (randomBytes[0] ?? 0).toString(16).padStart(2, '0').slice(1);
    
    // 接下来 14 位：变体标识（10）+ 随机数
    const variantAndRandom = (0x80 | ((randomBytes[1] ?? 0) & 0x3f)).toString(16) + (randomBytes[2] ?? 0).toString(16).padStart(2, '0');
    
    // 最后 48 位：随机数
    const finalRandom = Array.from(randomBytes.slice(3, 9))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    
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
 * 验证是否为有效的 UUID v7
 * @param uuid 要验证的 UUID 字符串
 * @returns 是否为有效的 UUID v7
 */
export function isValidUUIDv7(uuid: string): boolean {
    if (!isValidUUID(uuid)) {
        return false;
    }
    // 检查版本号是否为 7
    return uuid.charAt(14) === '7';
}