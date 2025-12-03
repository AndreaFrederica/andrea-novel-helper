/* eslint-disable semi */
import * as vscode from 'vscode'

/**
 * 快速选择项类型
 */
interface PreviewQuickPickItem extends vscode.QuickPickItem {
    value: 'open' | 'close' | 'template'
}

/**
 * Typst预览状态栏管理器
 * 追踪当前文档的预览状态，显示在状态栏中
 */
export class TypstPreviewStatusBar {
    private statusBarItem: vscode.StatusBarItem
    private currentFilePath: string | undefined
    private activePreviewFiles: Map<string, { template: string; isRendering?: boolean }> = new Map()
    private onStatusChangeCallback?: (filePath: string, isEnabled: boolean) => void

    constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            'andrea.typstPreview',
            vscode.StatusBarAlignment.Right,
            98 // 优先级
        )
        this.statusBarItem.name = 'Typst预览'
        this.statusBarItem.command = 'AndreaNovelHelper.toggleTypstPreview'
        this.updateStatusBar()
    }

    /**
     * 激活状态栏
     */
    activate(context: vscode.ExtensionContext): void {
        context.subscriptions.push(this.statusBarItem)

        // 监听编辑器切换
        context.subscriptions.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                this.updateStatusBar(editor)
            })
        )

        // 监听编辑器关闭
        context.subscriptions.push(
            vscode.workspace.onDidCloseTextDocument((doc: vscode.TextDocument) => {
                this.activePreviewFiles.delete(doc.uri.fsPath)
                this.updateStatusBar(vscode.window.activeTextEditor)
            })
        )

        // 注册切换预览的命令
        context.subscriptions.push(
            vscode.commands.registerCommand('AndreaNovelHelper.toggleTypstPreview', async () => {
                await this.showPreviewMenu()
            })
        )

        // 初始更新
        this.updateStatusBar(vscode.window.activeTextEditor)
    }

    /**
     * 标记文件有预览
     */
    public markPreviewEnabled(filePath: string, template: string = 'sample'): void {
        this.activePreviewFiles.set(filePath, { template, isRendering: false })
        this.updateStatusBar()
    }

    /**
     * 标记文件预览已禁用
     */
    public markPreviewDisabled(filePath: string): void {
        this.activePreviewFiles.delete(filePath)
        this.updateStatusBar()
    }

    /**
     * 标记文件正在渲染
     */
    public markRendering(filePath: string, isRendering: boolean): void {
        const info = this.activePreviewFiles.get(filePath)
        if (info) {
            info.isRendering = isRendering
            this.updateStatusBar()
        }
    }

    /**
     * 检查文件是否有预览
     */
    public isPreviewEnabled(filePath: string): boolean {
        return this.activePreviewFiles.has(filePath)
    }

    /**
     * 获取文件的预览信息
     */
    public getPreviewInfo(filePath: string): { template: string; isRendering?: boolean } | undefined {
        return this.activePreviewFiles.get(filePath)
    }

    /**
     * 更新状态栏
     */
    private updateStatusBar(editor?: vscode.TextEditor): void {
        const doc = editor?.document
        
        // 只处理markdown和plaintext文档
        if (!doc || (doc.languageId !== 'markdown' && doc.languageId !== 'plaintext')) {
            this.statusBarItem.hide()
            this.currentFilePath = undefined
            return
        }

        this.currentFilePath = doc.uri.fsPath
        const previewInfo = this.getPreviewInfo(this.currentFilePath)

        // 构建tooltip信息
        let tooltipText = ''
        if (previewInfo) {
            const fileName = doc.fileName
            const template = previewInfo.template
            const renderingStatus = previewInfo.isRendering ? '正在渲染...' : '已就绪'
            tooltipText = `文件: ${fileName}\n模板: ${template}\n状态: ${renderingStatus}\n\n点击管理预览`
            
            this.statusBarItem.text = '$(eye) Typst预览'
            this.statusBarItem.backgroundColor = undefined
        } else {
            const fileName = doc.fileName
            tooltipText = `文件: ${fileName}\n\n点击打开预览`
            
            this.statusBarItem.text = '$(eye-closed) Typst预览'
            this.statusBarItem.backgroundColor = undefined
        }

        this.statusBarItem.tooltip = tooltipText
        this.statusBarItem.show()
    }

    /**
     * 显示预览菜单
     */
    private async showPreviewMenu(): Promise<void> {
        if (!this.currentFilePath) { return }

        const isEnabled = this.isPreviewEnabled(this.currentFilePath)
        
        const items: PreviewQuickPickItem[] = [
            {
                label: isEnabled ? '$(check) 预览已启用' : '$(circle-outline) 启用预览',
                description: '打开实时预览',
                value: 'open'
            },
            {
                label: isEnabled ? '$(close) 关闭预览' : '预览未启用',
                description: '关闭实时预览',
                value: 'close'
            },
            {
                label: '$(symbol-template) 切换模板',
                description: '选择不同的Typst模板',
                value: 'template'
            }
        ]

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: '选择Typst预览操作',
            canPickMany: false
        })

        if (!selected) { return }

        switch (selected.value) {
            case 'open':
                await vscode.commands.executeCommand('AndreaNovelHelper.openTypstPreview')
                break
            case 'close':
                await vscode.commands.executeCommand('AndreaNovelHelper.closeTypstPreview')
                break
            case 'template':
                await vscode.commands.executeCommand('AndreaNovelHelper.changeTypstTemplate')
                break
        }
    }
}
