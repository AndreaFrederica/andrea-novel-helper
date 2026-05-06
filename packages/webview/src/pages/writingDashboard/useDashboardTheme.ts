import { ref, onMounted, onBeforeUnmount } from 'vue'

function readIsDark(): boolean {
  return document.body.classList.contains('body--dark') ||
         document.body.classList.contains('vscode-dark')
}

export function useDashboardTheme() {
  const isDark = ref(readIsDark())

  function update() {
    isDark.value = readIsDark()
  }

  let observer: MutationObserver | null = null

  onMounted(() => {
    observer = new MutationObserver(update)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class']
    })
    update()
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
  })

  return { isDark }
}

export function getVSCodeVar(name: string, fallback = ''): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name)
  return (v || fallback).toString().trim()
}
