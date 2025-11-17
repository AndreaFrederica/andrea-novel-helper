export async function run(ctx, args) {
  const cp = await import('node:child_process')
  const platform = process.platform
  let exe = 'calc.exe'
  if (platform === 'darwin') exe = '/System/Applications/Calculator.app/Contents/MacOS/Calculator'
  if (platform === 'linux') exe = 'gnome-calculator'
  try {
    const child = cp.spawn(exe, [], { detached: true, stdio: 'ignore' })
    child.unref()
    return { ok: true, exe, pid: child.pid }
  } catch (e) {
    return { ok: false, error: e?.message || String(e), exe }
  }
}