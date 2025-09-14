import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface ProjectConfig {
    name: string;
    description: string;
    author: string;
    uuid: string;
    cover?: string;
    summary?: string;
    tags: string[];
    createdAt: Date;
    updatedAt: Date;
}

export class ProjectConfigManager {
    private static readonly CONFIG_FILE_NAME = 'anhproject.md';
    private workspaceRoot: string;
    private configPath: string;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.configPath = path.join(workspaceRoot, ProjectConfigManager.CONFIG_FILE_NAME);
    }

    /**
     * 检查项目配置文件是否存在
     */
    public exists(): boolean {
        return fs.existsSync(this.configPath);
    }

    /**
     * 读取项目配置
     */
    public async readConfig(): Promise<ProjectConfig | null> {
        try {
            if (!this.exists()) {
                return null;
            }

            const content = await fs.promises.readFile(this.configPath, 'utf-8');
            return this.parseMarkdown(content);
        } catch (error) {
            console.error('读取项目配置失败:', error);
            return null;
        }
    }

    /**
     * 写入项目配置
     */
    public async writeConfig(config: ProjectConfig): Promise<boolean> {
        try {
            const content = this.generateMarkdown(config);
            await fs.promises.writeFile(this.configPath, content, 'utf-8');
            return true;
        } catch (error) {
            console.error('写入项目配置失败:', error);
            return false;
        }
    }

    /**
     * 创建默认项目配置
     */
    public async createDefaultConfig(projectName?: string): Promise<ProjectConfig> {
        const workspaceName = path.basename(this.workspaceRoot);
        const defaultConfig: ProjectConfig = {
            name: projectName || workspaceName || '未命名项目',
            description: '这是一个小说项目',
            author: '作者',
            uuid: uuidv4(),
            cover: '',
            summary: '项目简介',
            tags: ['小说', '创作'],
            createdAt: new Date(),
            updatedAt: new Date()
        };

        await this.writeConfig(defaultConfig);
        return defaultConfig;
    }

    /**
     * 更新项目配置
     */
    public async updateConfig(updates: Partial<Omit<ProjectConfig, 'uuid' | 'createdAt'>>): Promise<boolean> {
        try {
            const currentConfig = await this.readConfig();
            if (!currentConfig) {
                return false;
            }

            const updatedConfig: ProjectConfig = {
                ...currentConfig,
                ...updates,
                updatedAt: new Date()
            };

            return await this.writeConfig(updatedConfig);
        } catch (error) {
            console.error('更新项目配置失败:', error);
            return false;
        }
    }

    /**
     * 解析Markdown格式的配置文件
     */
    private parseMarkdown(content: string): ProjectConfig {
        const lines = content.split('\n');
        const config: Partial<ProjectConfig> = {
            tags: []
        };

        let currentSection = '';
        let contentBuffer: string[] = [];

        for (const line of lines) {
            const trimmedLine = line.trim();
            
            // 检查是否是二级标题
            if (trimmedLine.startsWith('## ')) {
                // 处理上一个section的内容
                if (currentSection && contentBuffer.length > 0) {
                    this.parseSection(currentSection, contentBuffer.join('\n').trim(), config);
                }
                
                currentSection = trimmedLine.substring(3).trim();
                contentBuffer = [];
            } else if (currentSection && trimmedLine) {
                contentBuffer.push(line);
            }
        }

        // 处理最后一个section
        if (currentSection && contentBuffer.length > 0) {
            this.parseSection(currentSection, contentBuffer.join('\n').trim(), config);
        }

        // 确保必需字段存在
        return {
            name: config.name || '未命名项目',
            description: config.description || '',
            author: config.author || '作者',
            uuid: config.uuid || uuidv4(),
            cover: config.cover || '',
            summary: config.summary || '',
            tags: config.tags || [],
            createdAt: config.createdAt || new Date(),
            updatedAt: config.updatedAt || new Date()
        };
    }

    /**
     * 解析标签内容，支持换行分割、逗号分割和注释
     */
    private parseTags(content: string): string[] {
        const tags: string[] = [];
        
        // 按行分割内容
        const lines = content.split('\n');
        
        for (const line of lines) {
            const trimmedLine = line.trim();
            
            // 跳过空行和注释行（以 // 开头）
            if (!trimmedLine || trimmedLine.startsWith('//')) {
                continue;
            }
            
            // 处理逗号分割的标签
            const lineTags = trimmedLine.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
            tags.push(...lineTags);
        }
        
        // 去重并返回
        return [...new Set(tags)];
    }

    /**
     * 解析单个配置段落
     */
    private parseSection(sectionName: string, content: string, config: Partial<ProjectConfig>): void {
        switch (sectionName.toLowerCase()) {
            case '项目名称':
            case 'name':
                config.name = content;
                break;
            case '项目描述':
            case 'description':
                config.description = content;
                break;
            case '作者':
            case 'author':
                config.author = content;
                break;
            case '项目uuid':
            case '项目标识':  // 保持向后兼容
            case 'uuid':
                config.uuid = content;
                break;
            case '封面':
            case 'cover':
                config.cover = content;
                break;
            case '项目简介':
            case '简介':  // 保持向后兼容
            case 'summary':
                config.summary = content;
                break;
            case '标签':
            case 'tags':
                config.tags = this.parseTags(content);
                break;
            case '创建时间':
            case 'created':
                config.createdAt = new Date(content);
                break;
            case '更新时间':
            case 'updated':
                config.updatedAt = new Date(content);
                break;
        }
    }

    /**
     * 生成Markdown格式的配置文件
     */
    private generateMarkdown(config: ProjectConfig): string {
        return `# ${config.name}

## 项目名称
${config.name}

## 项目描述
${config.description}

## 作者
${config.author}

## 项目UUID
${config.uuid}

## 封面
${config.cover || ''}

## 项目简介
${config.summary || ''}

## 标签
${config.tags.join(', ')}

## 创建时间
${config.createdAt.toISOString()}

## 更新时间
${config.updatedAt.toISOString()}
`;
    }

    /**
     * 获取项目UUID
     */
    public async getProjectUUID(): Promise<string | null> {
        const config = await this.readConfig();
        return config?.uuid || null;
    }

    /**
     * 获取配置文件路径
     */
    public getConfigPath(): string {
        return this.configPath;
    }
}