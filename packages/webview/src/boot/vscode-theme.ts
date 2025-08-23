// src/boot/vscode-theme.ts
import { boot } from 'quasar/wrappers'
import { Dark, setCssVar } from 'quasar'

function getVar(name: string, fallback = ''): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name)
  return (v || fallback).toString().trim()
}

function pick(...vals: Array<string | undefined | null>): string {
  for (const v of vals) {
    if (v && String(v).trim()) return String(v).trim()
  }
  return ''
}

/** 只读 VS Code 的主题标记；返回 true/false；未知返回 null */
function readVSCodeDark(): boolean | null {
  const b = document.body
  const cls = b.classList

  if (cls.contains('vscode-dark')) return true
  if (cls.contains('vscode-light')) return false

  const kind = (b.getAttribute('data-vscode-theme-kind') || '').toLowerCase()
  if (/\bdark\b|high-contrast/.test(kind)) return true
  if (/\blight\b/.test(kind)) return false

  return null
}

/** 只有在 VS Code 没有给出结论时才用系统偏好兜底 */
function systemPrefersDark(): boolean {
  return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
}

function applyVSCodeTheme() {
  // 1) 暗/亮模式：优先 VS Code，其次系统，绝不把系统结果和 VS Code 结果做 OR
  const vs = readVSCodeDark()
  const isDark = (vs !== null) ? vs : systemPrefersDark()
  Dark.set(isDark)

  // 2) 颜色映射（尽量贴近 VS Code 变量）
  const editorBg = pick(getVar('--vscode-editor-background'), isDark ? '#121212' : '#ffffff')
  const editorFg = pick(getVar('--vscode-editor-foreground'), isDark ? '#e0e0e0' : '#1f1f1f')

  const primary   = pick(getVar('--vscode-textLink-foreground'), '#3794ff')
  const secondary = pick(getVar('--vscode-button-secondaryBackground'), isDark ? '#3a3d41' : '#e0e0e0')
  const accent    = pick(getVar('--vscode-editorCursor-foreground'), '#528bff')

  const positive  = pick(getVar('--vscode-charts-green'),  '#89d185')
  const negative  = pick(getVar('--vscode-charts-red'),    '#c24038')
  const info      = pick(getVar('--vscode-charts-blue'),   '#3794ff')
  const warning   = pick(getVar('--vscode-charts-yellow'), '#cca700')

  // Quasar 品牌色
  setCssVar('primary', primary)
  setCssVar('secondary', secondary)
  setCssVar('accent', accent)
  setCssVar('positive', positive)
  setCssVar('negative', negative)
  setCssVar('info', info)
  setCssVar('warning', warning)

  // 页面背景/文字（非 Quasar 组件区域也跟随）
  setCssVar('dark-page', editorBg)
  document.documentElement.style.backgroundColor = editorBg
  document.documentElement.style.color = editorFg

  // 字体同步（可选）
  const fontUI = getVar('--vscode-font-family')
  if (fontUI) document.body.style.fontFamily = fontUI
}

// 监听 VS Code 主题切换
function watchVSCodeTheme() {
  let scheduled = false
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      applyVSCodeTheme()
    })
  }

  // VS Code 可能改 body 的 class / data-*，也可能重写 html 的内联 style 或 class
  const htmlObserver = new MutationObserver(schedule)
  htmlObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class']
  })

  const bodyObserver = new MutationObserver(schedule)
  bodyObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'data-vscode-theme-kind', 'data-vscode-theme-name']
  })

  // 保险：页面再次可见时同步一次
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) applyVSCodeTheme()
  })
}

export default boot(() => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  applyVSCodeTheme()
  watchVSCodeTheme()
})
