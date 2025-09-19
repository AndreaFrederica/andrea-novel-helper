import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface GitStatus {
    hasChanges: boolean;
    stagedFiles: string[];
    unstagedFiles: string[];
    untrackedFiles: string[];
    currentBranch: string;
    headCommit: string;
    remoteStatus: 'ahead' | 'behind' | 'up-to-date' | 'diverged' | 'unknown';
    aheadCount: number;
    behindCount: number;
}

export interface CommitOptions {
    message: string;
    includeUntracked: boolean;
    excludePatterns: string[];
}

export class AutoGitUtils {
    private _workspaceRoot: string;
    private _outputChannel: vscode.OutputChannel;
    private _lastHeadCommit: string = '';
    private _remoteStatusCache: Map<string, { hasRemote: boolean; timestamp: number }> = new Map();
    private _cacheTimeout = 30000; // 30秒缓存

    constructor(workspaceRoot: string) {
        this._workspaceRoot = workspaceRoot;
        this._outputChannel = vscode.window.createOutputChannel('ANH:AutoGit Utils');
    }

    /**
     * 检查是否为Git仓库
     */
    async isGitRepository(): Promise<boolean> {
        try {
            const gitDir = path.join(this._workspaceRoot, '.git');
            return fs.existsSync(gitDir);
        } catch (error) {
            return false;
        }
    }

        /**
         * 获取Git状态（使用 porcelain v2 -z，结构化解析）
         */
        async getGitStatus(): Promise<GitStatus> {
            try {
                // 基础信息
                const branchResult = await this._execGitInternal('rev-parse --abbrev-ref HEAD');
                const currentBranch = branchResult.stdout.trim();

                const headResult = await this._execGitInternal('rev-parse HEAD');
                const headCommit = headResult.stdout.trim();

                // 使用 porcelain v2 + NUL 分隔，保证解析鲁棒
                const statusResult = await this._execGitInternal('status --porcelain=v2 -z');
                const { stagedFiles, unstagedFiles, untrackedFiles } = this._parsePorcelainV2(statusResult.stdout);

                // 远端状态（保持你的原逻辑）
                let remote: { status: GitStatus['remoteStatus']; ahead: number; behind: number } = {
                    status: 'unknown',
                    ahead: 0,
                    behind: 0,
                };
                const remoteInfo = await this._getRemoteStatus(currentBranch);
                remote = { status: remoteInfo.status as GitStatus['remoteStatus'], ahead: remoteInfo.ahead, behind: remoteInfo.behind };

                const result: GitStatus = {
                    hasChanges: stagedFiles.length > 0 || unstagedFiles.length > 0 || untrackedFiles.length > 0,
                    stagedFiles,
                    unstagedFiles,
                    untrackedFiles,
                    currentBranch,
                    headCommit,
                    remoteStatus: remote.status,
                    aheadCount: remote.ahead,
                    behindCount: remote.behind,
                };

                this._log(`Git状态: staged=${stagedFiles.length}, unstaged=${unstagedFiles.length}, untracked=${untrackedFiles.length}`);
                return result;
            } catch (error) {
                this._log(`获取Git状态失败: ${error}`);
                throw error;
            }
        }

        /**
         * 解析 `git status --porcelain=v2 -z` 输出
         * 参考: https://git-scm.com/docs/git-status#_porcelain_format_version_2
         * - 记录以 \0 分隔
         * - 行首标识：
         *   '1' 普通变更：1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
         *   '2' 重命名/复制：2 <XY> <sub> ... <score> <src> <dst>
         *   'u' 未合并：u <XY> ...
         *   '?' 未跟踪：? <path>
         *   '!' 忽略：! <path>
         */
        private _parsePorcelainV2(raw: string): {
            stagedFiles: string[];
            unstagedFiles: string[];
            untrackedFiles: string[];
        } {
            // stdout 在 Node 里是 UTF-8 字符串；用 \0 分割
            // 注意：末尾通常有一个空的分段，过滤掉
            const records = raw.split('\0').filter(Boolean);

            // 用 Set 去重
            const staged = new Set<string>();
            const unstaged = new Set<string>();
            const untracked = new Set<string>();

                    for (let i = 0; i < records.length; i++) {
                        const rec = records[i];
                        if (!rec || rec.length === 0) {
                            continue;
                        }

                const kind = rec[0];

                if (kind === '1') {
                    // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
                    // 为稳妥：只拆分有限次，path 可能包含空格
                    const parts = rec.split(' ');
                    const xy = parts[1] || '..';
                    // path 在 v2 中通常是最后一个字段
                    const pathStartIdx = 8; // parts[0]='1', parts[1]=XY, parts[2]=sub, parts[3..7]=mH..hI (共8项之前)
                    const path = parts.slice(pathStartIdx).join(' ');

                    const x = xy[0] || '.';
                    const y = xy[1] || '.';

                                if (x !== '.') {
                                    staged.add(path);
                                }
                                if (y !== '.') {
                                    unstaged.add(path);
                                }
                } else if (kind === '2') {
                    // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <score> <src> <dst>
                    // 在 -z 模式下，Git 输出为连续 NUL 项：一项包含前缀和 src，下一项为 dst
                    // 因此我们严格处理：如果下一条 records 存在，则它是 dst
                    const parts = rec.split(' ');
                    const xy = parts[1] || '..';
                    const x = xy[0] || '.';
                    const y = xy[1] || '.';

                    // 获取 dst：如果下一条存在且不是以数字/问号/感叹号开头，视作 dst
                    let dst = '';
                    if (i + 1 < records.length && records[i + 1].length > 0 && !/^[12u?!]/.test(records[i + 1][0])) {
                        dst = records[i + 1];
                        // consume next record as dst
                        i++;
                    } else {
                        // 回退策略：尝试从当前 rec 提取最后字段
                        dst = this._extractLastPathField(rec) || '';
                    }

                                if (dst) {
                                    if (x !== '.') {
                                        staged.add(dst);
                                    }
                                    if (y !== '.') {
                                        unstaged.add(dst);
                                    }
                                }
                } else if (kind === 'u') {
                    // 合并冲突：视为未暂存的冲突文件
                                const p = this._extractLastPathField(rec);
                                if (p) {
                                    unstaged.add(p);
                                }
                } else if (kind === '?') {
                    // 未跟踪
                                const p = rec.substring(2);
                                if (p) {
                                    untracked.add(p);
                                }
                } else if (kind === '!') {
                    // 忽略，跳过
                    continue;
                } else {
                    this._log(`[DEBUG] 未识别的porcelain v2记录: ${rec}`);
                }
            }

            return {
                stagedFiles: Array.from(staged),
                unstagedFiles: Array.from(unstaged),
                untrackedFiles: Array.from(untracked),
            };
        }

        /**
         * 安全提取记录里的“最后一个路径字段”（适用于 '1'/'u'）
         */
        private _extractLastPathField(rec: string): string | null {
            const idx = rec.lastIndexOf(' ');
            if (idx >= 0 && idx + 1 < rec.length) {
                return rec.substring(idx + 1);
            }
            return null;
        }

        /**
         * 严格解析 '2' 记录的占位函数（当前实现用不到，可扩展）
         */
        private _parseRenameCopyRecordStrict(rec: string): { dstPath: string } {
            const dst = this._extractLastPathField(rec) || rec;
            return { dstPath: dst };
        }

    /**
     * 检查HEAD是否有变更
     */
    async checkHeadChanged(): Promise<boolean> {
        try {
            const status = await this.getGitStatus();
            const changed = this._lastHeadCommit !== '' && this._lastHeadCommit !== status.headCommit;
            this._lastHeadCommit = status.headCommit;
            return changed;
        } catch (error) {
            this._log(`检查HEAD变更失败: ${error}`);
            return false;
        }
    }

    /**
     * 自动提交变更
     */
    async autoCommit(options: CommitOptions): Promise<boolean> {
        try {
            const status = await this.getGitStatus();
            
            if (!status.hasChanges) {
                this._log('没有变更需要提交');
                return false;
            }

            // 检查是否有已暂存的文件可以直接提交
            if (status.stagedFiles.length > 0) {
                this._log(`发现已暂存的文件，直接提交: ${status.stagedFiles.join(', ')}`);
                
                // 生成提交消息
                const commitMessage = this._generateCommitMessage(options.message, status.stagedFiles, status.currentBranch);

                // 提交（带重试机制）
                let commitRetryCount = 0;
                const maxCommitRetries = 2;
                
                while (commitRetryCount < maxCommitRetries) {
                    try {
                        await this._execGitInternal(`commit -m "${commitMessage}"`);
                        this._log(`自动提交成功: ${commitMessage}`);
                        this._log(`提交文件: ${status.stagedFiles.join(', ')}`);
                        return true;
                    } catch (commitError) {
                        commitRetryCount++;
                        this._log(`提交失败 (尝试 ${commitRetryCount}/${maxCommitRetries}): ${commitError}`);
                        
                        if (commitRetryCount >= maxCommitRetries) {
                            this._log(`提交失败，已达到最大重试次数`);
                            throw commitError;
                        } else {
                            // 等待一小段时间后重试
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                    }
                }
            }

            // 处理未暂存的文件
            const filesToAdd: string[] = [];
            
            // 添加已修改的文件
            filesToAdd.push(...status.unstagedFiles);
            
            // 根据配置添加未跟踪的文件
            if (options.includeUntracked) {
                filesToAdd.push(...status.untrackedFiles);
            }

            this._log(`准备添加到暂存区的文件: ${filesToAdd.join(', ')}`);

            // 过滤排除的文件
            const filteredFiles = filesToAdd.filter(file => 
                !this._shouldExcludeFile(file, options.excludePatterns)
            );

            this._log(`过滤后的文件: ${filteredFiles.join(', ')}`);
            this._log(`排除模式: ${options.excludePatterns.join(', ')}`);

            if (filteredFiles.length === 0) {
                this._log('没有符合条件的文件需要添加到暂存区');
                return false;
            }

            // 添加文件（带重试机制）
            for (const file of filteredFiles) {
                let retryCount = 0;
                const maxRetries = 3;
                
                while (retryCount < maxRetries) {
                    try {
                        // 处理中文文件名：不使用引号包围，让Git自己处理路径
                        const normalizedFile = file.replace(/\\/g, '/');
                        await this._execGitInternal(`add "${normalizedFile}"`);
                        this._log(`成功添加文件: ${normalizedFile}`);
                        break; // 成功则跳出重试循环
                    } catch (addError) {
                        retryCount++;
                        this._log(`添加文件失败 ${file} (尝试 ${retryCount}/${maxRetries}): ${addError}`);
                        
                        if (retryCount >= maxRetries) {
                            this._log(`文件 ${file} 添加失败，已达到最大重试次数，跳过此文件`);
                            // 继续处理其他文件，不中断整个提交流程
                        } else {
                            // 等待一小段时间后重试
                            await new Promise(resolve => setTimeout(resolve, 100));
                        }
                    }
                }
            }

            // 再次检查是否有文件被成功添加到暂存区
            const updatedStatus = await this.getGitStatus();
            if (updatedStatus.stagedFiles.length === 0) {
                this._log('没有文件被成功添加到暂存区，取消提交');
                return false;
            }

            // 生成提交消息
            const commitMessage = this._generateCommitMessage(options.message, updatedStatus.stagedFiles, status.currentBranch);

            // 提交（带重试机制）
            let commitRetryCount = 0;
            const maxCommitRetries = 2;
            
            while (commitRetryCount < maxCommitRetries) {
                try {
                    await this._execGitInternal(`commit -m "${commitMessage}"`);
                    this._log(`自动提交成功: ${commitMessage}`);
                    this._log(`提交文件: ${updatedStatus.stagedFiles.join(', ')}`);
                    return true;
                } catch (commitError) {
                    commitRetryCount++;
                    this._log(`提交失败 (尝试 ${commitRetryCount}/${maxCommitRetries}): ${commitError}`);
                    
                    if (commitRetryCount >= maxCommitRetries) {
                        this._log(`提交失败，已达到最大重试次数`);
                        throw commitError;
                    } else {
                        // 等待一小段时间后重试
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                }
            }
            
            return false;
        } catch (error) {
            this._log(`自动提交失败: ${error}`);
            return false;
        }
    }

    /**
     * 推送到远程仓库
     */
    async pushToRemote(): Promise<boolean> {
        try {
            const status = await this.getGitStatus();
            
            // 检查是否有远程分支
            try {
                const remoteResult = await this._execGitInternal(`rev-parse --abbrev-ref ${status.currentBranch}@{upstream}`);
                const remoteBranch = remoteResult.stdout.trim();
                
                if (!remoteBranch) {
                    this._log('当前分支没有设置上游分支，跳过推送');
                    return true; // 返回true，因为本地提交已成功
                }

                await this._execGitInternal('push');
                this._log(`推送到远程仓库成功: ${remoteBranch}`);
                return true;
            } catch (upstreamError) {
                // 没有上游分支，尝试推送到origin
                try {
                    await this._execGitInternal(`push -u origin ${status.currentBranch}`);
                    this._log(`首次推送到远程仓库成功: origin/${status.currentBranch}`);
                    return true;
                } catch (pushError) {
                    this._log(`没有远程仓库或推送失败，仅保留本地提交: ${pushError}`);
                    return true; // 返回true，因为本地提交已成功
                }
            }
        } catch (error) {
            this._log(`推送失败: ${error}`);
            return true; // 即使推送失败，本地提交仍然有效
        }
    }

    /**
     * 从远程仓库拉取
     */
    async pullFromRemote(): Promise<boolean> {
        try {
            const status = await this.getGitStatus();
            
            // 检查是否有上游分支
            if (status.remoteStatus === 'unknown') {
                this._log('当前分支没有配置上游分支，跳过拉取操作');
                return true; // 返回true，因为没有上游分支是正常情况
            }
            
            // 检查工作区是否干净
            if (status.hasChanges) {
                this._log('工作区有未提交的变更，无法拉取');
                return false;
            }

            await this._execGitInternal('pull');
            this._log('从远程仓库拉取成功');
            return true;
        } catch (error) {
            this._log(`拉取失败: ${error}`);
            return false;
        }
    }

    /**
     * 检查远程是否有更新
     */
    async checkRemoteUpdates(): Promise<boolean> {
        try {
            const status = await this.getGitStatus();
            
            // 如果没有上游分支，跳过检查
            if (status.remoteStatus === 'unknown') {
                this._log('当前分支没有配置上游分支，跳过远程更新检查');
                return false;
            }
            
            // 获取远程信息
            await this._execGitInternal('fetch');
            
            const updatedStatus = await this.getGitStatus();
            return updatedStatus.remoteStatus === 'behind' || updatedStatus.remoteStatus === 'diverged';
        } catch (error) {
            this._log(`检查远程更新失败: ${error}`);
            return false;
        }
    }

    /**
     * 获取最后一次提交信息
     */
    async getLastCommitInfo(): Promise<{ hash: string; message: string; date: Date } | null> {
        try {
            const result = await this._execGitInternal('log -1 --format="%H|%s|%ci"');
            const parts = result.stdout.trim().replace(/"/g, '').split('|');
            
            if (parts.length >= 3) {
                return {
                    hash: parts[0],
                    message: parts[1],
                    date: new Date(parts[2])
                };
            }
            return null;
        } catch (error) {
            this._log(`获取最后提交信息失败: ${error}`);
            return null;
        }
    }

    /**
     * 执行Git命令（公开方法，供AutoGitService使用）
     */
    async _execGit(command: string): Promise<{ stdout: string; stderr: string }> {
        return this._execGitInternal(command);
    }

    private async _execGitInternal(command: string): Promise<{ stdout: string; stderr: string }> {
        const fullCommand = `git -c core.quotepath=false ${command}`;
        
        try {
            const result = await execAsync(fullCommand, { 
                cwd: this._workspaceRoot,
                encoding: 'utf8',
                env: {
                    ...process.env,
                    // 设置Git使用UTF-8编码处理文件名
                    LC_ALL: 'C.UTF-8',
                    LANG: 'C.UTF-8'
                }
            });
            return result;
        } catch (error: any) {
            // 对于某些Git命令，非零退出码是正常的（如config --get不存在的配置）
            // 只有在真正的错误情况下才记录日志
            if (error.code !== 1 || !command.includes('config --get')) {
                this._log(`Git命令执行失败: ${error.message}`);
            }
            throw error;
        }
    }

    private async _getRemoteStatus(branch: string): Promise<{ status: 'ahead' | 'behind' | 'up-to-date' | 'diverged' | 'unknown'; ahead: number; behind: number }> {
        try {
            // 检查缓存
            const cacheKey = branch;
            const cached = this._remoteStatusCache.get(cacheKey);
            const now = Date.now();
            
            if (cached && (now - cached.timestamp) < this._cacheTimeout) {
                if (!cached.hasRemote) {
                    // 缓存显示没有远程分支，直接返回unknown
                    return { status: 'unknown', ahead: 0, behind: 0 };
                }
            }

            // 先检查是否有远程分支配置，避免不必要的错误日志
            try {
                const configResult = await this._execGitInternal(`config --get branch.${branch}.remote`);
                if (!configResult.stdout.trim()) {
                    // 更新缓存：没有远程分支
                    this._remoteStatusCache.set(cacheKey, { hasRemote: false, timestamp: now });
                    return { status: 'unknown', ahead: 0, behind: 0 };
                }
            } catch (configError) {
                // 配置不存在时，git config 会返回非零退出码，这是正常情况，不需要记录错误
                this._remoteStatusCache.set(cacheKey, { hasRemote: false, timestamp: now });
                return { status: 'unknown', ahead: 0, behind: 0 };
            }

            // 更新缓存：有远程分支
            this._remoteStatusCache.set(cacheKey, { hasRemote: true, timestamp: now });

            // 获取远程分支信息
            const remoteResult = await this._execGitInternal(`rev-parse --abbrev-ref ${branch}@{upstream}`);
            const remoteBranch = remoteResult.stdout.trim();
            
            if (!remoteBranch) {
                this._log(`分支 ${branch} 没有配置上游分支`);
                return { status: 'unknown', ahead: 0, behind: 0 };
            }

            // 获取ahead/behind计数
            const countResult = await this._execGitInternal(`rev-list --left-right --count ${branch}...${remoteBranch}`);
            const counts = countResult.stdout.trim().split('\t');
            
            const ahead = parseInt(counts[0] || '0');
            const behind = parseInt(counts[1] || '0');

            let status: 'ahead' | 'behind' | 'up-to-date' | 'diverged';
            if (ahead > 0 && behind > 0) {
                status = 'diverged';
            } else if (ahead > 0) {
                status = 'ahead';
            } else if (behind > 0) {
                status = 'behind';
            } else {
                status = 'up-to-date';
            }

            return { status, ahead, behind };
        } catch (error) {
            // 当没有上游分支时，不记录为错误，只记录信息
            if (error instanceof Error && error.message && error.message.includes('no upstream configured')) {
                // 这些都是正常情况，不需要记录错误
            } else {
                this._log(`获取远程状态失败: ${error}`);
            }
            return { status: 'unknown', ahead: 0, behind: 0 };
        }
    }

    private _shouldExcludeFile(filePath: string, excludePatterns: string[]): boolean {
        for (const pattern of excludePatterns) {
            if (this._matchPattern(filePath, pattern)) {
                return true;
            }
        }
        return false;
    }

    private _matchPattern(filePath: string, pattern: string): boolean {
        // 简单的通配符匹配
        const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'));
        return regex.test(filePath);
    }

    private _generateCommitMessage(template: string, files: string[], branch: string): string {
        const timestamp = new Date().toISOString();
        const fileCount = files.length;
        
        return template
            .replace(/{timestamp}/g, timestamp)
            .replace(/{files}/g, fileCount.toString())
            .replace(/{branch}/g, branch);
    }

    private _log(message: string): void {
        const timestamp = new Date().toLocaleString();
        this._outputChannel.appendLine(`[${timestamp}] ${message}`);
    }

    dispose(): void {
        this._outputChannel.dispose();
        this._remoteStatusCache.clear();
    }
}


