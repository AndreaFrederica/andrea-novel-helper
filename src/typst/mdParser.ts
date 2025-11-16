export type HeadingBlock = { type: 'heading'; level: number; text: string }
export type ParagraphBlock = { type: 'paragraph'; text: string }
export type ListBlock = { type: 'list'; ordered: boolean; items: string[] }
export type CodeBlock = { type: 'code'; lang?: string; code: string }
export type QuoteBlock = { type: 'blockquote'; text: string }
export type ImageBlock = { type: 'image'; alt: string; src: string }
export type HRBlock = { type: 'hr' }
export type QuoteEntry = { level: number; user?: string; time?: string; text: string }
export type DialogBlock = { type: 'dialog'; user: string; time?: string; text: string; quotes?: QuoteEntry[] }

export type Block = HeadingBlock | ParagraphBlock | ListBlock | CodeBlock | QuoteBlock | ImageBlock | HRBlock | DialogBlock

export function parseMarkdownBlocks(text: string): { blocks: Block[] } {
  const lines = text.split(/\r?\n/)
  const blocks: Block[] = []
  let buf: string[] = []
  let i = 0
  const flushPara = () => { if (buf.length) { blocks.push({ type: 'paragraph', text: buf.join('\n') }); buf = [] } }
  while (i < lines.length) {
    const line = lines[i]
    const dm = line.match(/^@([^\s\[：:]+)(?:\s*\[(.*?)\])?[：:]\s*(.*)$/)
    if (dm) {
      flushPara();
      const user = dm[1];
      const time = dm[2];
      const first = dm[3] || '';
      i++;
      const body: string[] = [first];
      const quotes: QuoteEntry[] = [];
      while (i < lines.length && lines[i].trim() !== '') {
        const qmatch = lines[i].match(/^(>+)[\s]*(.*)$/);
        if (qmatch) {
          const lvl = qmatch[1].length;
          const rest = qmatch[2] || '';
          const um = rest.match(/^@([^\s\[：:]+)(?:\s*\[(.*?)\])?[：:]\s*(.*)$/);
          if (um) quotes.push({ level: lvl, user: um[1], time: um[2], text: um[3] || '' });
          else quotes.push({ level: lvl, text: rest });
        } else {
          body.push(lines[i]);
        }
        i++;
      }
      if (i < lines.length && lines[i].trim() === '') i++;
      blocks.push({ type: 'dialog', user, time, text: body.join('\n'), quotes });
      continue
    }
    const m = line.match(/^(#{1,6})\s+(.*)$/)
    if (m) { flushPara(); blocks.push({ type: 'heading', level: m[1].length, text: m[2].trim() }); i++; continue }
    if (/^```/.test(line)) { flushPara(); const lang = line.replace(/^```\s*/, '') || undefined; i++; const code: string[] = []; while (i < lines.length && !/^```\s*$/.test(lines[i])) { code.push(lines[i]); i++ } if (i < lines.length) i++; blocks.push({ type: 'code', lang, code: code.join('\n') }); continue }
    if (/^>\s?/.test(line)) { flushPara(); const q: string[] = []; while (i < lines.length && /^>\s?/.test(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++ } blocks.push({ type: 'blockquote', text: q.join('\n') }); continue }
    if (/^(\*\s|\-\s|\+\s)/.test(line) || /^\d+\.\s/.test(line)) { flushPara(); const ordered = /^\d+\.\s/.test(line); const items: string[] = []; while (i < lines.length && (ordered ? /^\d+\.\s/ : /^(\*\s|\-\s|\+\s)/).test(lines[i])) { const it = ordered ? lines[i].replace(/^\d+\.\s/, '') : lines[i].replace(/^(\*\s|\-\s|\+\s)/, ''); items.push(it); i++ } blocks.push({ type: 'list', ordered, items }); continue }
    const img = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/)
    if (img) { flushPara(); blocks.push({ type: 'image', alt: img[1], src: img[2] }); i++; continue }
    if (/^\s*(\*\s*\*\s*\*|\-\s*\-\s*\-)\s*$/.test(line)) { flushPara(); blocks.push({ type: 'hr' }); i++; continue }
    if (line.trim() === '') { flushPara(); i++; continue }
    buf.push(line); i++
  }
  flushPara()
  return { blocks }
}

export function firstHeading(blocks: Block[]): HeadingBlock | undefined {
  for (const b of blocks) { if (b.type === 'heading') return b }
  return undefined
}

export function firstH1(blocks: Block[]): HeadingBlock | undefined {
  for (const b of blocks) { if (b.type === 'heading' && b.level === 1) return b }
  return undefined
}

export function parseMarkdownDoc(text: string): { meta: Record<string, any>; blocks: Block[] } {
  const meta: Record<string, any> = {}
  const outLines: string[] = []
  const lines = text.split(/\r?\n/)
  for (const ln of lines) {
    const m = ln.match(/^\s*&Def\s+([^=]+?)\s*=\s*(.+)\s*$/)
    if (m) {
      const key = m[1].trim().toLowerCase()
      const val = m[2].trim()
      if (key === 'title' || key === '主标题') meta.defTitle = val
      else if (key === 'subtitle' || key === '副标题') meta.subtitle = val
      else if (key === 'category' || key === '分类') meta.category = val
      else meta[`def_${key}`] = val
      continue
    }
    outLines.push(ln)
  }
  const { blocks } = parseMarkdownBlocks(outLines.join('\n'))
  return { meta, blocks }
}