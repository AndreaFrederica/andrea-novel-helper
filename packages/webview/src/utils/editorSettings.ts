// 编辑器设置管理工具类
export type EditorType = 'rolecard' | 'monaco' | 'vditor';

export interface EditorSettings {
  // JSON5/OJSON5 文件编辑器设置
  json5Editor: 'roleCard' | 'monaco';
  // Markdown 文件编辑器设置
  mdEditor: 'vditor' | 'monaco';
  // 工具栏显示设置
  showToolbar: boolean;
  // 默认编辑器设置
  defaultEditorForJson5: EditorType;
  defaultEditorForMarkdown: EditorType;
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  json5Editor: 'roleCard',
  mdEditor: 'vditor',
  showToolbar: true,
  defaultEditorForJson5: 'rolecard',
  defaultEditorForMarkdown: 'vditor'
};

const STORAGE_KEY = 'andrea-editor-settings';

export class EditorSettingsManager {
  private static instance: EditorSettingsManager;
  private settings: EditorSettings;

  private constructor() {
    this.settings = this.loadSettings();
  }

  public static getInstance(): EditorSettingsManager {
    if (!EditorSettingsManager.instance) {
      EditorSettingsManager.instance = new EditorSettingsManager();
    }
    return EditorSettingsManager.instance;
  }

  private loadSettings(): EditorSettings {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          ...DEFAULT_EDITOR_SETTINGS,
          ...parsed
        };
      }
    } catch (error) {
      console.warn('Failed to load editor settings from localStorage:', error);
    }
    return { ...DEFAULT_EDITOR_SETTINGS };
  }

  private saveSettings(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch (error) {
      console.error('Failed to save editor settings to localStorage:', error);
    }
  }

  public getSettings(): EditorSettings {
    return { ...this.settings };
  }

  public updateSettings(newSettings: Partial<EditorSettings>): void {
    this.settings = {
      ...this.settings,
      ...newSettings
    };
    this.saveSettings();
  }

  public getJson5Editor(): 'roleCard' | 'monaco' {
    return this.settings.json5Editor;
  }

  public setJson5Editor(editor: 'roleCard' | 'monaco'): void {
    this.updateSettings({ json5Editor: editor });
  }

  public getMdEditor(): 'vditor' | 'monaco' {
    return this.settings.mdEditor;
  }

  public setMdEditor(editor: 'vditor' | 'monaco'): void {
    this.updateSettings({ mdEditor: editor });
  }

  // 根据文件扩展名获取推荐的编辑器
  public getRecommendedEditor(fileName: string): string {
    const ext = fileName.toLowerCase().split('.').pop();
    
    switch (ext) {
      case 'json5':
      case 'ojson5':
        return this.getJson5Editor();
      case 'md':
      case 'markdown':
        return this.getMdEditor();
      default:
        return 'monaco'; // 默认使用 Monaco
    }
  }

  // 检查文件是否支持角色卡编辑器
  public supportsRoleCardEditor(fileName: string): boolean {
    const ext = fileName.toLowerCase().split('.').pop();
    return ext === 'json5' || ext === 'ojson5';
  }

  // 检查文件是否支持 Vditor
  public supportsVditor(fileName: string): boolean {
    const ext = fileName.toLowerCase().split('.').pop();
    return ext === 'md' || ext === 'markdown';
  }
}

// 导出单例实例
export const editorSettings = EditorSettingsManager.getInstance();