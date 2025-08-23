// src/boot/vscode-theme.ts
import { boot } from 'quasar/wrappers'
import { Dark, setCssVar } from 'quasar'

function getVar(name: string, fallback = '') {
  // 从 :root 读取 VS Code 注入的 CSS 变量
  const v = getComputedStyle(document.documentElement).getPropertyValue(name)
  return (v || fallback).trim()
}

function isVsDark(): boolean {
  // VS Code 会加 data-vscode-theme-kind / vscode-dark class
  const kind = (document.body.getAttribute('data-vscode-theme-kind') || '').toLowerCase()
  return kind.includes('dark') || document.body.classList.contains('vscode-dark')
}

function applyVsTheme() {
  // 1) 同步暗色模式
  Dark.set(isVsDark())

  // 2) 颜色映射（按 VS Code token → Quasar 品牌色）
  // 你可以按喜好调整映射表
  const primary   = getVar('--vscode-textLink-foreground') || getVar('--vscode-button-background')
  const secondary = getVar('--vscode-button-secondaryBackground') || primary
  const accent    = getVar('--vscode-editorCursor-foreground') || primary

  const positive  = getVar('--vscode-charts-green')  || '#21BA45'
  const negative  = getVar('--vscode-charts-red')    || '#C10015'
  const info      = getVar('--vscode-charts-blue')   || '#31CCEC'
  const warning   = getVar('--vscode-charts-yellow') || '#F2C037'

  if (primary)   setCssVar('primary', primary)
  if (secondary) setCssVar('secondary', secondary)
  if (accent)    setCssVar('accent', accent)
  setCssVar('positive', positive)
  setCssVar('negative', negative)
  setCssVar('info', info)
  setCssVar('warning', warning)

  // 可选：把页面背景/前景也绑到 VS Code 的编辑器色
  const bg = getVar('--vscode-editor-background')
  const fg = getVar('--vscode-editor-foreground')
  if (bg) {
    // Quasar 对暗色页背景有专用变量
    setCssVar('dark-page', bg)
    // 也可以直接给容器上色：
    const app = document.getElementById('q-app')
    if (app) app.style.background = bg
  }
  if (fg) {
    document.body.style.color = fg
  }
}

export default boot(() => {
  // 首次应用
  applyVsTheme()

  // 监听 VS Code 主题切换（VS Code 会改 body 的属性/类，并刷新 CSS 变量）
  const mo = new MutationObserver(() => {
    // 等一帧再读，避免读到旧值
    requestAnimationFrame(applyVsTheme)
  })
  mo.observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'data-vscode-theme-kind', 'data-vscode-theme-name', 'data-vscode-theme-id'],
  })

  // 有些主题切换只是更新变量，保险起见再挂两个轻量触发点
  window.addEventListener('focus', () => setTimeout(applyVsTheme, 0))
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') applyVsTheme()
  })
})
