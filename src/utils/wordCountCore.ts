import * as fs from 'fs';
import * as path from 'path';
import * as chardet from 'jschardet';
import * as iconv from 'iconv-lite';

// 纯文本统计核心，不引用 vscode 等扩展宿主 API，供 worker 线程复用

export interface TextStats {
  cjkChars: number;
  asciiChars: number;
  words: number;
  nonWSChars: number;
  total: number;
}

export async function readTextFileDetectEncodingCore(filePath: string, debug = false): Promise<string> {
  const buffer = await fs.promises.readFile(filePath);
  const detect = chardet.detect(buffer);
  const rawEncoding = (detect && detect.encoding) ? detect.encoding : 'utf-8';
  let encoding = rawEncoding;
  let text = iconv.decode(buffer, encoding);

  const replacementCount = (text.match(/�/g) || []).length;
  const cjkCount = (text.match(/[\p{Script=Han}]/gu) || []).length;
  const looksBinary = buffer.every(b => b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126));
  if (buffer.length > 0) {
    const highBytes = buffer.filter(b => b >= 0x80).length;
    const replRatio = replacementCount / Math.max(1, text.length);
    const needFallback = (
      replRatio > 0.02 ||
      ((/^(GB2312|GBK|windows-1252|ISO-8859-1)$/i.test(encoding)) && cjkCount === 0 && highBytes >= 2)
    );
    if (needFallback) {
      try {
        const utf8 = iconv.decode(buffer, 'utf-8');
        const utf8Cjk = (utf8.match(/[\p{Script=Han}]/gu) || []).length;
        const utf8Repl = (utf8.match(/�/g) || []).length;
        if (utf8Cjk > cjkCount && utf8Repl / Math.max(1, utf8.length) < replRatio) {
          text = utf8; encoding = 'utf-8';
        } else if (/^(GB2312|GBK|windows-1252|ISO-8859-1)$/i.test(rawEncoding)) {
          const gb18030 = iconv.decode(buffer, 'GB18030');
            const gbCjk = (gb18030.match(/[\p{Script=Han}]/gu) || []).length;
            if (gbCjk > cjkCount) { text = gb18030; encoding = 'GB18030'; }
        }
      } catch { /* ignore */ }
    }
  }
  if (debug) {
    console.log('[WordCountCore][decode]', path.basename(filePath), {
      len: buffer.length,
      encoding: rawEncoding,
      finalEncoding: encoding,
      replacementCount,
      cjkCount: (text.match(/[\p{Script=Han}]/gu) || []).length,
      looksBinary
    });
  }
  return text;
}

export function countWordsMixed(text: string): number {
  const cjkMatches = text.match(/[\p{Script=Han}]/gu) || [];
  const enMatches = text.match(/\b[A-Za-z0-9_]+\b/g) || [];
  return cjkMatches.length + enMatches.length;
}

export function analyzeText(text: string): TextStats {
  const cjkMatch = text.match(/[\p{Script=Han}]/gu) || [];
  const wordMatch = text.match(/\b[A-Za-z0-9_]+\b/g) || [];
  const nonWS = text.match(/\S/gu) || [];
  const ascii = text.match(/[\x00-\x7F]/g) || [];
  const cjkChars = cjkMatch.length;
  const words = wordMatch.length;
  const nonWSChars = nonWS.length;
  const asciiChars = ascii.filter(ch => !/[\p{Script=Han}]/u.test(ch)).length;
  const total = cjkChars + words;
  return { cjkChars, asciiChars, words, nonWSChars, total };
}

export async function countAndAnalyzeRaw(fullPath: string, debug = false): Promise<TextStats> {
  const text = await readTextFileDetectEncodingCore(fullPath, debug);
  return analyzeText(text);
}
