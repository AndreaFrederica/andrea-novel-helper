import { defineStore, acceptHMRUpdate } from 'pinia';

export interface RenderSettings {
  edgesOnTop: boolean;
  showMiniMap: boolean;
  showBackground: boolean;
  showControls: boolean;
  edgeAnimationSpeed: number;
  nodeSpacing: number;
  closeAfterAdd: boolean; // 添加事件后关闭弹窗
  closeAfterEdit: boolean; // 编辑事件保存后关闭弹窗
  closeAfterEditConnection: boolean; // 编辑连线保存后关闭弹窗
}

export const useTimelineSettingsStore = defineStore('timelineSettings', {
  state: (): RenderSettings => {
    // 尝试从 localStorage 加载保存的设置
    try {
      const saved = localStorage.getItem('timeline-render-settings');
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<RenderSettings>;
        return {
          edgesOnTop: parsed.edgesOnTop ?? false,
          showMiniMap: parsed.showMiniMap ?? true,
          showBackground: parsed.showBackground ?? true,
          showControls: parsed.showControls ?? true,
          edgeAnimationSpeed: parsed.edgeAnimationSpeed ?? 3,
          nodeSpacing: parsed.nodeSpacing ?? 200,
          closeAfterAdd: parsed.closeAfterAdd ?? true,
          closeAfterEdit: parsed.closeAfterEdit ?? true,
          closeAfterEditConnection: parsed.closeAfterEditConnection ?? true,
        };
      }
    } catch (error) {
      console.error('加载渲染设置失败:', error);
    }

    // 返回默认值
    return {
      edgesOnTop: false,
      showMiniMap: true,
      showBackground: true,
      showControls: true,
      edgeAnimationSpeed: 3,
      nodeSpacing: 200,
      closeAfterAdd: true,
      closeAfterEdit: true,
      closeAfterEditConnection: true,
    };
  },

  actions: {
    // 保存到 localStorage（内部方法）
    _saveToLocalStorage() {
      try {
        localStorage.setItem('timeline-render-settings', JSON.stringify(this.$state));
      } catch (error) {
        console.error('保存渲染设置失败:', error);
      }
    },
    // 更新设置
    updateSettings(newSettings: Partial<RenderSettings>) {
      Object.assign(this.$state, newSettings);
      this._saveToLocalStorage();
    },

    // 重置为默认值
    reset() {
      this.$state = {
        edgesOnTop: false,
        showMiniMap: true,
        showBackground: true,
        showControls: true,
        edgeAnimationSpeed: 3,
        nodeSpacing: 200,
        closeAfterAdd: true,
        closeAfterEdit: true,
        closeAfterEditConnection: true,
      };
      this._saveToLocalStorage();
    },

    // 保存到 localStorage
    saveToLocalStorage() {
      this._saveToLocalStorage();
    },

    // 从 localStorage 加载（用于手动重新加载）
    loadFromLocalStorage() {
      try {
        const saved = localStorage.getItem('timeline-render-settings');
        if (saved) {
          const parsed = JSON.parse(saved) as RenderSettings;
          Object.assign(this.$state, parsed);
        }
      } catch (error) {
        console.error('加载渲染设置失败:', error);
      }
    },

    // 初始化：设置自动保存监听
    init() {
      this.$subscribe(() => {
        this._saveToLocalStorage();
      });
    },
  },
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useTimelineSettingsStore, import.meta.hot));
}
