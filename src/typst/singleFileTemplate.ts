export type SingleFileParts = { entry: string; prelude: string }

export function parseSingleFileTemplate(text: string): SingleFileParts {
  const cleaned = text.replace(/---\s*meta\s*---[\s\S]*?---\s*end\s*---/g, '')
  const lines = cleaned.split(/\r?\n/)
  const sections: { [k: string]: string[] } = {}
  let current = 'entry'
  for (const ln of lines) {
    const m = ln.match(/^---\s*part:\s*(.+?)\s*---\s*$/)
    if (m) { current = m[1].trim(); if (!sections[current]) sections[current] = []; continue }
    sections[current] = sections[current] || []
    sections[current].push(ln)
  }
  const entryStr = (sections['entry'] || lines).join('\n')
  const preludeStr = Object.keys(sections)
    .filter(k => k !== 'entry')
    .map(k => sections[k].join('\n'))
    .join('\n')
  return { entry: entryStr, prelude: preludeStr }
}

export function parseInlineMeta(text: string): any | null {
  const m = text.match(/---\s*meta\s*---[\s\S]*?\n([\s\S]*?)\n---\s*end\s*---/)
  if (!m) return null
  try { return JSON.parse(m[1]) } catch { return null }
}