// @ts-nocheck
import JSZip from 'jszip'
import type { RawXML } from 'fast-xml-parser' // 仅当使用 FXP 时
import { markRaw } from 'vue'

export interface NavPoint {
  id: string
  playOrder: number
  label: string
  src: string
  children: NavPoint[]
}

/** —— 入口 ———————————————————————————————— */
export async function loadToc(url: string): Promise<NavPoint[]> {
  return url.endsWith('.ncx')
    ? fetchNcx(url) // ① 直链
    : fetchEpub(url) // ② EPub 解包
}

/* ============ ① 直接抓取 .ncx ============ */
export async function fetchNcx(ncxUrl: string): Promise<NavPoint[]> {
  const xml = await fetch(ncxUrl).then((r) => r.text())
  const base = new URL('.', ncxUrl).href // 解析相对路径 :contentReference[oaicite:5]{index=5}
  return parseNcxDom(xml, base)
}

/* ============ ② 抓取并解包 .epub =========== */
export async function fetchEpub(epubUrl: string): Promise<NavPoint[]> {
  const ab = await fetch(epubUrl).then((r) => r.arrayBuffer()) // 二进制读取 :contentReference[oaicite:6]{index=6}
  const zip = await JSZip.loadAsync(ab) // :contentReference[oaicite:7]{index=7}

  // 2-1  container.xml → OPF 路径
  const container = await zip.file('META-INF/container.xml')!.async('text')
  const opfPath = getOpfPath(container)

  // 2-2  OPF → NCX 路径
  const opfXml = await zip.file(opfPath)!.async('text')
  const ncxPath = getNcxPath(opfXml, opfPath)

  // 2-3  真正读取 NCX
  const ncxXml = await zip.file(ncxPath)!.async('text')
  const base = new URL('.', new URL(ncxPath, epubUrl)).href
  return parseNcxDom(ncxXml, base)
}

/* ------------------- XML 解析工具 ------------------- */
function getOpfPath(containerXml: string): string {
  const doc = new DOMParser().parseFromString(containerXml, 'application/xml')
  return doc.querySelector('rootfile')!.getAttribute('full-path')! // 规范定义 :contentReference[oaicite:8]{index=8}
}

function getNcxPath(opfXml: string, opfPath: string): string {
  const base = opfPath.substring(0, opfPath.lastIndexOf('/') + 1)
  const doc = new DOMParser().parseFromString(opfXml, 'application/xml')

  // spine@toc 优先
  const tocId = doc.querySelector('spine')?.getAttribute('toc')
  if (tocId) {
    const item = doc.querySelector(`item[id="${tocId}"]`)
    if (item) return base + item.getAttribute('href')
  }

  // fallback：查 manifest 的 NCX MIME 类型
  const ncxItem = Array.from(doc.querySelectorAll('item')).find(
    (i) => i.getAttribute('media-type') === 'application/x-dtbncx+xml',
  ) // :contentReference[oaicite:9]{index=9}
  if (!ncxItem) throw new Error("OPF didn't declare NCX")
  return base + ncxItem.getAttribute('href')
}

function parseNcxDom(xml: string, baseHref: string): NavPoint[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const top = Array.from(doc.querySelector('navMap')!.children).filter(
    (n) => n.nodeName === 'navPoint',
  ) as Element[]
  return top.map((el) => walk(el))

  function walk(el: Element): NavPoint {
    const label = el.querySelector('navLabel>text')?.textContent?.trim() ?? ''
    const src = el.querySelector('content')?.getAttribute('src') ?? ''
    const kids = Array.from(el.children).filter((c) => c.nodeName === 'navPoint') as Element[]

    return {
      id: el.getAttribute('id') ?? '',
      playOrder: Number(el.getAttribute('playOrder') ?? 0),
      label,
      src: new URL(src, baseHref).href, // 解析相对链接 :contentReference[oaicite:10]{index=10}
      children: kids.map(walk),
    }
  }
}

/* ---------- A. raw data, no proxy ---------- */
export async function loadTocRaw(url: string): Promise<NavPoint[]> {
  // 1) get the normal NavPoint[]
  const data = await loadToc(url)

  // 2) deep-clone so later mutations don't affect cached copies
  //    structuredClone is spec-compliant and fast in modern browsers
  const clone = structuredClone(data) // MDN :contentReference[oaicite:4]{index=4}

  // 3) mark raw so Vue never wraps it
  return markRaw(clone) // Vue docs :contentReference[oaicite:5]{index=5}
}

/* ---------- B. ready-made DOM tree ---------- */
export async function loadTocDom(url: string): Promise<HTMLDivElement> {
  const navPoints = await loadToc(url) // still uses your parser
  // buildTocDiv already returns a plain <div> tree (not VNodes / proxies)
  return buildTocDiv(navPoints) // see earlier answer

  /**
   * 把解析后的 TOC 渲染到指定 div
   * ------------------------------------------------------------
   * @param navPoints  NavPoint[] —— 由 parseEpubToc / fetchNcx 得到的目录树
   * @param container  HTMLElement  —— 目标节点，例如
   *     document.getElementById("toc")
   * @param onNavigate (可选) (href:string) => void —— 点击条目的回调
   */
  function renderToc(
    navPoints: NavPoint[],
    container: HTMLElement,
    onNavigate: (href: string) => void = (href) => (location.href = href),
  ): void {
    container.innerHTML = '' // 清空旧内容
    container.appendChild(buildList(navPoints))

    // ---------- 内部：递归构建 <details>/<summary> ----------
    function buildList(items: NavPoint[]): DocumentFragment {
      const frag = document.createDocumentFragment()
      for (const item of items) {
        if (item.children.length) {
          const details = document.createElement('details')
          details.open = false // 默认收起
          const summary = document.createElement('summary')
          summary.textContent = item.label
          summary.className = 'toc-label' // 便于自定义样式
          summary.onclick = (e) => {
            e.stopPropagation() // 避免冒泡到父 <details>
            onNavigate(item.src)
          }

          details.appendChild(summary)
          details.appendChild(buildList(item.children)) // 递归
          frag.appendChild(details)
        } else {
          const p = document.createElement('p') // 叶节点用 <p>
          p.textContent = item.label
          p.className = 'toc-leaf'
          p.onclick = () => onNavigate(item.src)
          frag.appendChild(p)
        }
      }
      return frag
    }
  }

  /**
   * 根据 NavPoint 树构建并返回一个 <div>，内部用 <details>/<summary> 实现可折叠目录。
   * ---------------------------------------------------------------------------
   * @param toc         NavPoint[] —— 解析得到的目录树
   * @param onNavigate  (可选) (href:string)=>void —— 点击条目的导航回调
   * @returns           HTMLDivElement —— 直接插入 DOM 或框架组件
   */
  function buildTocDiv(
    toc: NavPoint[],
    onNavigate: (href: string) => void = (href) => (location.href = href),
  ): HTMLDivElement {
    const root = document.createElement('div') // 创建 div :contentReference[oaicite:0]{index=0}
    root.className = 'epub-toc'

    root.appendChild(buildFragment(toc))
    return root

    /* -- 递归构建 DOM Fragment -- */
    function buildFragment(nodes: NavPoint[]): DocumentFragment {
      const frag = document.createDocumentFragment()
      for (const n of nodes) {
        if (n.children.length) {
          const details = document.createElement('details') // disclosure widget :contentReference[oaicite:1]{index=1}
          const summary = document.createElement('summary')
          summary.textContent = n.label
          summary.onclick = (e) => {
            e.stopPropagation()
            onNavigate(n.src)
          }
          details.appendChild(summary)
          details.appendChild(buildFragment(n.children))
          frag.appendChild(details)
        } else {
          const p = document.createElement('p')
          p.textContent = n.label
          p.className = 'toc-leaf'
          p.onclick = () => onNavigate(n.src)
          frag.appendChild(p)
        }
      }
      return frag // appendChild 把节点插入父元素 :contentReference[oaicite:2]{index=2}
    }
  }
}
