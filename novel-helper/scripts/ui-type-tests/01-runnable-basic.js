// Runnable script sample.
// Expected type in UI: 可执行脚本

export async function run(ctx, args = {}) {
  const doc = ctx.activeDoc || {};
  const result = {
    ok: true,
    script: '01-runnable-basic',
    fileName: doc.name || null,
    hasMcp: !!ctx.mcp,
    args,
    time: new Date().toISOString(),
  };

  ctx.output.appendLine('[01-runnable-basic] running...');
  ctx.output.appendLine(JSON.stringify(result, null, 2));
  return result;
}
