const fs = require('fs')
const path = require('path')
const os = require('os')
const { spawn } = require('child_process')

function parseArgs(argv) {
  const args = { input: '', format: 'pdf', template: 'sample', out: '', ppi: 144, pages: '', fontPaths: [] }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if ((a === '-i' || a === '--input') && argv[i+1]) { args.input = argv[++i] }
    else if ((a === '-f' || a === '--format') && argv[i+1]) { args.format = argv[++i] }
    else if ((a === '-t' || a === '--template') && argv[i+1]) { args.template = argv[++i] }
    else if ((a === '-o' || a === '--out') && argv[i+1]) { args.out = argv[++i] }
    else if ((a === '--ppi') && argv[i+1]) { args.ppi = Number(argv[++i]) }
    else if ((a === '--pages') && argv[i+1]) { args.pages = argv[++i] }
    else if ((a === '--font-paths') && argv[i+1]) { args.fontPaths = argv[++i].split(path.delimiter) }
  }
  return args
}

function parseMarkdownLight(text) {
  const lines = text.split(/\r?\n/)
  const blocks = []
  let buf = []
  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.*)$/)
    if (m) {
      if (buf.length) { blocks.push({ type: 'paragraph', text: buf.join('\n') }); buf = [] }
      const level = m[1].length
      const t = m[2].trim()
      blocks.push({ type: 'heading', level, text: t })
      continue
    }
    if (line.trim() === '') {
      if (buf.length) { blocks.push({ type: 'paragraph', text: buf.join('\n') }); buf = [] }
    } else {
      buf.push(line)
    }
  }
  if (buf.length) { blocks.push({ type: 'paragraph', text: buf.join('\n') }) }
  return { meta: {}, blocks }
}

function renderTypstDirect(ctx) {
  const out = []
  out.push('#set page(width: 21cm, height: 29.7cm, margin: 2cm)')
  for (const b of ctx.blocks) {
    if (b.type === 'heading') { out.push(`#heading(level: ${b.level || 1}, [${b.text}])`) }
    else { out.push(b.text) }
    out.push('')
  }
  return out.join('\n')
}

async function renderTypstWithLiquid(templatesDir, templateName, ctx) {
  try {
    const { Liquid } = require('liquidjs')
    const engine = new Liquid({ root: templatesDir, extname: '.liquid' })
    const entryJson = path.join(templatesDir, templateName, 'template.json')
    const entryCfg = JSON.parse(fs.readFileSync(entryJson, 'utf8'))
    const entry = path.join(templateName, entryCfg.entry)
    const tpl = await engine.renderFile(entry, ctx)
    return tpl
  } catch (e) {
    return renderTypstDirect(ctx)
  }
}

function compileTypst(cli, typPath, outPath, opts) {
  return new Promise((resolve) => {
    const args = []
    if (opts.format !== 'pdf') { args.push('-f', opts.format) }
    if (opts.format === 'png' && opts.ppi) { args.push('--ppi', String(opts.ppi)) }
    if (opts.pages && opts.pages.trim()) { args.push('--pages', opts.pages.trim()) }
    if (opts.fontPaths && opts.fontPaths.length) { args.push('--font-path', opts.fontPaths.join(path.delimiter)) }
    args.push(typPath)
    args.push(outPath)
    const proc = spawn(cli, ['compile', ...args], { cwd: path.dirname(typPath), shell: false })
    let err = ''
    proc.stderr.on('data', d => { err += String(d) })
    proc.on('close', code => { resolve({ ok: code === 0, stderr: err }) })
    proc.on('error', () => { resolve({ ok: false, stderr: 'failed to spawn typst' }) })
  })
}

async function main() {
  const args = parseArgs(process.argv)
  if (!args.input) {
    console.error('usage: node scripts/typst-test.js -i <input.md> [-f pdf|png|svg] [-t sample] [-o out.pdf|out-{p}.png] [--ppi 144] [--pages 1-] [--font-paths path1;path2]')
    process.exit(2)
  }
  const cwd = process.cwd()
  const templatesDir = path.resolve(cwd, 'templates', 'typst')
  const cli = process.env.TYPST_PATH || 'typst'
  const text = fs.readFileSync(args.input, 'utf8')
  const ctx = parseMarkdownLight(text)
  const filename = path.basename(args.input).replace(/\.[^\\\/\.]+$/, '')
  const firstHeading = ctx.blocks.find(b => b.type === 'heading')
  ctx.meta.title = firstHeading ? firstHeading.text : filename
  ctx.meta.filename = filename
  const typ = await renderTypstWithLiquid(templatesDir, args.template, ctx)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anh-typst-'))
  const typPath = path.join(tmpDir, 'doc.typ')
  fs.writeFileSync(typPath, typ, 'utf8')
  let outPath = args.out
  if (!outPath) {
    const base = args.input.replace(/\.[^\\\/\.]+$/, '')
    if (args.format === 'pdf') outPath = base + '.pdf'
    else outPath = `${base}-{p}.${args.format}`
  }
  if (!path.isAbsolute(outPath)) {
    outPath = path.resolve(cwd, outPath)
  }
  const res = await compileTypst(cli, typPath, outPath, { format: args.format, ppi: args.ppi, pages: args.pages, fontPaths: args.fontPaths })
  if (!res.ok) {
    console.error('typst compile failed')
    if (res.stderr) console.error(res.stderr)
    process.exit(1)
  }
  console.log('ok:', outPath)
}

main().catch(err => { console.error(String(err || 'error')); process.exit(1) })