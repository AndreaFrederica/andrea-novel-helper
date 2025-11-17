export async function run(ctx, args) {
  const content = (args && args.text) || (ctx.activeDoc && (ctx.activeDoc.processed || ctx.activeDoc.raw)) || ''
  const title = (args && (args.title || args.name)) || (ctx.activeDoc && (ctx.activeDoc.title || ctx.activeDoc.name)) || ''
  const source = (ctx.activeDoc && (ctx.activeDoc.path || ctx.activeDoc.filePath || ctx.activeDoc.fullPath || ctx.activeDoc.uri)) || ''

  console.log('=== Publish Preview ===')
  if (title) console.log('Title:', title)
  if (source) console.log('Source:', source)
  console.log('Length:', content.length, 'chars')
  console.log('--- Content Start ---')
  console.log(content)
  console.log('--- Content End ---')

  return { ok: true, title, source, length: content.length }
}