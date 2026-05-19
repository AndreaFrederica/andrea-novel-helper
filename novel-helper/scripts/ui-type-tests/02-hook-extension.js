// Hook extension sample.
// Expected type in UI: 扩展脚本

export async function activate(ctx) {
  ctx.hooks.on('documentSaved', async (payload, runtime) => {
    const file = payload?.fileName || 'unknown';
    runtime.output.appendLine(`[hook-extension] documentSaved: ${file}`);
  });

  ctx.hooks.on('extensionActivated', async (payload, runtime) => {
    runtime.output.appendLine(`[hook-extension] extensionActivated count=${payload?.count ?? 0}`);
  });
}
