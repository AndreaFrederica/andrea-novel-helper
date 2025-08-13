/**
 * 文件内容缓存管理器
 * 提供文件内容缓存、变化检测和增量更新功能
 */

import * as fs from 'fs';
import * as crypto from 'crypto';

interface FileCacheEntry {
    content: string;
    mtime: number;
    hash: string;
}

export class FileCache {
    private cache = new Map<string, FileCacheEntry>();

    /**
     * 获取文件内容，优先从缓存读取
     * @param filePath 文件绝对路径
     * @returns 文件内容，如果文件不存在或读取失败返回 null
     */
    getFileContent(filePath: string): string | null {
        try {
            const stat = fs.statSync(filePath);
            const mtime = stat.mtimeMs;
            const cached = this.cache.get(filePath);

            // 如果缓存存在且文件未修改，直接返回缓存内容
            if (cached && cached.mtime === mtime) {
                return cached.content;
            }

            // 读取文件内容
            const content = fs.readFileSync(filePath, 'utf8');
            const hash = this.calculateHash(content);

            // 更新缓存
            this.cache.set(filePath, {
                content,
                mtime,
                hash
            });

            return content;
        } catch (error) {
            // 文件不存在或读取失败，从缓存中移除
            this.cache.delete(filePath);
            return null;
        }
    }

    /**
     * 检查文件是否已变化
     * @param filePath 文件绝对路径
     * @returns true 如果文件已变化或不存在缓存
     */
    hasFileChanged(filePath: string): boolean {
        try {
            const stat = fs.statSync(filePath);
            const cached = this.cache.get(filePath);
            
            if (!cached) {
                return true; // 没有缓存，认为已变化
            }

            return cached.mtime !== stat.mtimeMs;
        } catch (error) {
            // 文件不存在，如果有缓存则认为已变化
            return this.cache.has(filePath);
        }
    }

    /**
     * 获取已变化的文件列表
     * @param filePaths 要检查的文件路径列表
     * @returns 已变化的文件路径数组
     */
    getChangedFiles(filePaths: string[]): string[] {
        return filePaths.filter(filePath => this.hasFileChanged(filePath));
    }

    /**
     * 强制刷新指定文件的缓存
     * @param filePath 文件绝对路径
     */
    refreshFile(filePath: string): void {
        this.cache.delete(filePath);
        this.getFileContent(filePath); // 重新读取并缓存
    }

    /**
     * 移除文件缓存
     * @param filePath 文件绝对路径
     */
    removeFile(filePath: string): void {
        this.cache.delete(filePath);
    }

    /**
     * 清空所有缓存
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * 获取缓存统计信息
     */
    getStats(): { cachedFiles: number; totalSize: number } {
        let totalSize = 0;
        for (const entry of this.cache.values()) {
            totalSize += entry.content.length;
        }
        return {
            cachedFiles: this.cache.size,
            totalSize
        };
    }

    /**
     * 计算内容哈希值
     */
    private calculateHash(content: string): string {
        return crypto.createHash('md5').update(content, 'utf8').digest('hex');
    }

    /**
     * 获取所有缓存的文件路径
     */
    getCachedFilePaths(): string[] {
        return Array.from(this.cache.keys());
    }
}

// 全局文件缓存实例
export const globalFileCache = new FileCache();
