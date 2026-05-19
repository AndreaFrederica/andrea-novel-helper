// Custom plain-text processor sample.
// Expected type in UI: 扩展脚本, tags include 纯文本处理器

export async function activate(ctx) {
  ctx.processors.registerPlainText(
    {
      id: 'sample.uppercase.clean',
      label: 'Sample Uppercase Cleaner',
      description: 'Trim + collapse blank lines + uppercase text',
      extension: 'txt',
    },
    async (input) => {
      const cleaned = String(input.fallbackText || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      return {
        text: cleaned.toUpperCase(),
      };
    }
  );
}
