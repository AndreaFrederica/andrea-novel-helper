import * as vscode from 'vscode';

/**
 * 项目配置文件的补全提供器
 * 为 anhproject.md 文件提供二级标题的自动补全
 */
export class ProjectConfigCompletionProvider implements vscode.CompletionItemProvider {
    private readonly configSections = [
        { label: '项目名称', detail: '项目的名称', insertText: '## 项目名称\n' },
        { label: '项目描述', detail: '项目的详细描述', insertText: '## 项目描述\n' },
        { label: '作者', detail: '项目作者信息', insertText: '## 作者\n' },
        { label: '项目标识', detail: '项目的唯一标识符', insertText: '## 项目标识\n' },
        { label: '封面', detail: '项目封面图片路径', insertText: '## 封面\n' },
        { label: '简介', detail: '项目简介', insertText: '## 简介\n' },
        { label: '标签', detail: '项目标签，用逗号分隔', insertText: '## 标签\n' },
        { label: '创建时间', detail: '项目创建时间', insertText: '## 创建时间\n' },
        { label: '更新时间', detail: '项目更新时间', insertText: '## 更新时间\n' }
    ];

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        // 只在 anhproject.md 文件中提供补全
        if (!document.fileName.endsWith('anhproject.md')) {
            return [];
        }

        const line = document.lineAt(position);
        const lineText = line.text.substring(0, position.character);

        // 检查是否在输入二级标题
        if (lineText.trim().startsWith('##') || lineText.trim() === '#') {
            const items: vscode.CompletionItem[] = [];

            for (const section of this.configSections) {
                const item = new vscode.CompletionItem(section.label, vscode.CompletionItemKind.Snippet);
                item.detail = section.detail;
                item.insertText = new vscode.SnippetString(section.insertText + '${1}');
                item.documentation = new vscode.MarkdownString(`插入 **${section.label}** 配置项`);
                
                // 设置排序优先级
                item.sortText = `0${section.label}`;
                
                // 设置替换范围
                const range = new vscode.Range(
                    new vscode.Position(position.line, 0),
                    position
                );
                item.range = range;
                
                items.push(item);
            }

            return new vscode.CompletionList(items, false);
        }

        // 检查是否在空行，提供快速插入选项
        if (lineText.trim() === '') {
            const quickItems: vscode.CompletionItem[] = [];
            
            // 提供快速插入所有配置项的选项
            const allSectionsItem = new vscode.CompletionItem('所有配置项', vscode.CompletionItemKind.Snippet);
            allSectionsItem.detail = '插入所有项目配置项';
            allSectionsItem.insertText = new vscode.SnippetString(
                this.configSections.map((section, index) => 
                    `${section.insertText}\${${index + 1}:${section.label.toLowerCase()}}`
                ).join('\n\n')
            );
            allSectionsItem.documentation = new vscode.MarkdownString('插入所有项目配置项模板');
            allSectionsItem.sortText = '0000';
            quickItems.push(allSectionsItem);

            return new vscode.CompletionList(quickItems, false);
        }

        return [];
    }

    /**
     * 注册项目配置补全提供器
     */
    static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new ProjectConfigCompletionProvider();
        const selector: vscode.DocumentSelector = {
            language: 'markdown',
            pattern: '**/anhproject.md'
        };
        
        return vscode.languages.registerCompletionItemProvider(
            selector,
            provider,
            '#', // 触发字符
            ' '  // 空格也可以触发
        );
    }
}