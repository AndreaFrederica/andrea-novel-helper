import * as fs from 'fs';
import * as path from 'path';
import * as iconv from 'iconv-lite';

// 纯文本统计核心，不引用 vscode 等扩展宿主 API，供 worker 线程复用

export interface TextStats {
  cjkChars: number;
  asciiChars: number;
  words: number;
  nonWSChars: number;
  total: number;
}

/** ====== 常量与小工具 ====== */
const SAMPLE_BYTES = 256 * 1024; // 仅用前 256KB 作为判定样本，足够稳定且更快

function hasUtf8BOM(buf: Uint8Array): boolean {
  return buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
}
function hasUtf16LEBOM(buf: Uint8Array): boolean {
  return buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE;
}
function hasUtf16BEBOM(buf: Uint8Array): boolean {
  return buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF;
}

/** UTF-16BE → LE 简单翻转（去掉 BOM 后再翻转） */
function swapBEtoLE(buf: Uint8Array): Buffer {
  const out = Buffer.allocUnsafe(buf.length);
  for (let i = 0; i + 1 < buf.length; i += 2) {
    out[i] = buf[i + 1];
    out[i + 1] = buf[i];
  }
  return out;
}

/** 是否像 UTF-16（无 BOM）：某一奇偶位的 0x00 很多且另一位大多 ASCII */
function looksLikeUtf16NoBOM(sample: Uint8Array): 'utf16le' | 'utf16be' | null {
  const len = Math.min(sample.length, 64 * 1024);
  let zeroEven = 0, zeroOdd = 0, asciiEven = 0, asciiOdd = 0, evenCnt = 0, oddCnt = 0;
  for (let i = 0; i < len; i++) {
    const b = sample[i];
    if ((i & 1) === 0) {
      evenCnt++;
      if (b === 0x00) {zeroEven++;}
      if (b >= 0x20 && b <= 0x7E || b === 0x09 || b === 0x0A || b === 0x0D) {asciiEven++;}
    } else {
      oddCnt++;
      if (b === 0x00) {zeroOdd++;}
      if (b >= 0x20 && b <= 0x7E || b === 0x09 || b === 0x0A || b === 0x0D) {asciiOdd++;}
    }
  }
  // 某一侧零占比明显高、另一侧ASCII占比高，判定为 UTF-16
  const evenZeroRatio = evenCnt ? zeroEven / evenCnt : 0;
  const oddZeroRatio = oddCnt ? zeroOdd / oddCnt : 0;
  const evenAsciiRatio = evenCnt ? asciiEven / evenCnt : 0;
  const oddAsciiRatio = oddCnt ? asciiOdd / oddCnt : 0;

  if (evenZeroRatio > 0.2 && oddAsciiRatio > 0.6 && oddZeroRatio < 0.05) {return 'utf16be';} // 0x00 在偶数位 → BE
  if (oddZeroRatio > 0.2 && evenAsciiRatio > 0.6 && evenZeroRatio < 0.05) {return 'utf16le';} // 0x00 在奇数位 → LE
  return null;
}

/** 快速 UTF-8 校验（允许末尾样本被截断，不算错误） */
function isLikelyUTF8(sample: Uint8Array): boolean {
  const len = sample.length;
  let i = 0;
  while (i < len) {
    const b1 = sample[i++];
    if (b1 <= 0x7F) {continue;} // ASCII

    // 2-byte
    if (b1 >= 0xC2 && b1 <= 0xDF) {
      if (i >= len) {return true;} // 样本末尾截断视为“可能”
      const b2 = sample[i++];
      if ((b2 & 0xC0) !== 0x80) {return false;}
      continue;
    }

    // 3-byte
    if (b1 === 0xE0) {
      if (i + 1 >= len) {return true;}
      const b2 = sample[i++], b3 = sample[i++];
      if (!(b2 >= 0xA0 && b2 <= 0xBF) || (b3 & 0xC0) !== 0x80) {return false;}
      continue;
    }
    if (b1 >= 0xE1 && b1 <= 0xEF) {
      if (i + 1 >= len) {return true;}
      const b2 = sample[i++], b3 = sample[i++];
      if ((b2 & 0xC0) !== 0x80 || (b3 & 0xC0) !== 0x80) {return false;}
      continue;
    }

    // 4-byte
    if (b1 === 0xF0) {
      if (i + 2 >= len) {return true;}
      const b2 = sample[i++], b3 = sample[i++], b4 = sample[i++];
      if (!(b2 >= 0x90 && b2 <= 0xBF) || (b3 & 0xC0) !== 0x80 || (b4 & 0xC0) !== 0x80) {return false;}
      continue;
    }
    if (b1 >= 0xF1 && b1 <= 0xF3) {
      if (i + 2 >= len) {return true;}
      const b2 = sample[i++], b3 = sample[i++], b4 = sample[i++];
      if ((b2 & 0xC0) !== 0x80 || (b3 & 0xC0) !== 0x80 || (b4 & 0xC0) !== 0x80) {return false;}
      continue;
    }
    if (b1 === 0xF4) {
      if (i + 2 >= len) {return true;}
      const b2 = sample[i++], b3 = sample[i++], b4 = sample[i++];
      if (!(b2 >= 0x80 && b2 <= 0x8F) || (b3 & 0xC0) !== 0x80 || (b4 & 0xC0) !== 0x80) {return false;}
      continue;
    }

    return false; // 非法起始字节
  }
  return true;
}

/** ====== 解码（仅一次全量解码） ====== */
export async function readTextFileDetectEncodingCore(filePath: string, debug = false): Promise<string> {
  const buffer = await fs.promises.readFile(filePath);
  const sample = buffer.subarray(0, Math.min(buffer.length, SAMPLE_BYTES));

  let encoding: 'utf-8' | 'utf-16le' | 'gb18030' = 'utf-8';
  let startOffset = 0;

  // 1) BOM 快速路径
  if (hasUtf8BOM(buffer)) {
    encoding = 'utf-8';
    startOffset = 3;
  } else if (hasUtf16LEBOM(buffer)) {
    encoding = 'utf-16le';
    startOffset = 2;
  } else if (hasUtf16BEBOM(buffer)) {
    // 转成 LE 后解码
    const swapped = swapBEtoLE(buffer.subarray(2));
    const text = iconv.decode(Buffer.from(swapped), 'utf-16le');
    if (debug) {
      console.log('[WordCountCore][decode:BOM-UTF16BE]', path.basename(filePath), {
        len: buffer.length, finalEncoding: 'utf-16be→utf-16le'
      });
    }
    return text;
  } else {
    // 2) 无 BOM：UTF-16（无 BOM）探测（很快）
    const utf16NoBOM = looksLikeUtf16NoBOM(sample);
    if (utf16NoBOM === 'utf16le') {
      encoding = 'utf-16le';
    } else if (utf16NoBOM === 'utf16be') {
      const swapped = swapBEtoLE(buffer);
      const text = iconv.decode(Buffer.from(swapped), 'utf-16le');
      if (debug) {
        console.log('[WordCountCore][decode:Heuristic-UTF16BE]', path.basename(filePath), {
          len: buffer.length, finalEncoding: 'utf-16be→utf-16le'
        });
      }
      return text;
    } else {
      // 3) 快速 UTF-8 校验；失败则直接回退 GB18030（覆盖 GBK/GB2312）
      if (!isLikelyUTF8(sample)) {
        encoding = 'gb18030';
      }
    }
  }

  // 4) 一次性全量解码（utf-8 / utf-16le / gb18030）
  const text = iconv.decode(Buffer.from(buffer.subarray(startOffset)), encoding);

  if (debug) {
    const looksBinary = sample.every(b => b === 9 || b === 10 || b === 13 || (b >= 32 && b <= 126));
    // 仅对样本做轻量统计，避免全量二次扫描
    const replCount = (text.length <= 1024 * 1024) // 大文件避免全量扫描
      ? ((text.match(/�/g))?.length ?? 0)
      : 0;
    console.log('[WordCountCore][decode]', path.basename(filePath), {
      len: buffer.length,
      finalEncoding: encoding,
      sampleBytes: sample.length,
      replacementCount: replCount,
      looksBinary
    });
  }
  return text;
}

/** ====== 统计 ====== */

/** 单次遍历的快速统计（替换原多正则实现） */
export function analyzeText(text: string): TextStats {
  let cjkChars = 0;
  let asciiChars = 0;
  let words = 0;
  let nonWSChars = 0;

  let inAsciiWord = false;

  // 判断是否是 ASCII 单词字符（与原 \b[A-Za-z0-9_]+\b 对齐）
  const isAsciiWordChar = (code: number) =>
    (code >= 0x30 && code <= 0x39) || // 0-9
    (code >= 0x41 && code <= 0x5A) || // A-Z
    (code >= 0x61 && code <= 0x7A) || // a-z
    code === 0x5F;                    // _

  // CJK（Han）范围判定（覆盖常见统一表意文字区段）
  const isHan = (code: number) =>
    (code >= 0x3400 && code <= 0x9FFF) ||   // CJK Unified Ideographs Ext A + Basic
    (code >= 0xF900 && code <= 0xFAFF) ||   // CJK Compatibility Ideographs
    (code >= 0x20000 && code <= 0x2FFFF);   // CJK Ext B..G（代理对）

  for (let i = 0; i < text.length; i++) {
    let code = text.charCodeAt(i);

    // 代理对到码点
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xDC00 && next <= 0xDFFF) {
        code = ((code - 0xD800) << 10) + (next - 0xDC00) + 0x10000;
        i++;
      }
    }

    // 非空白统计
    if (!/\s/.test(String.fromCharCode(code))) {nonWSChars++;}

    // ASCII 统计
    if (code <= 0x7F) {asciiChars++;}

    // CJK 统计
    if (isHan(code)) {
      cjkChars++;
      // CJK 到来会打断 ASCII 单词
      if (inAsciiWord) {inAsciiWord = false;}
      continue;
    }

    // ASCII 单词识别（FSM）
    if (isAsciiWordChar(code)) {
      if (!inAsciiWord) {
        words++;
        inAsciiWord = true;
      }
    } else {
      if (inAsciiWord) {inAsciiWord = false;}
    }
  }

  const total = cjkChars + words;
  return { cjkChars, asciiChars, words, nonWSChars, total };
}

/** 兼容旧接口 */
export function countWordsMixed(text: string): number {
  // 与老实现等价：CJK 字符数 + ASCII 单词数
  const st = analyzeText(text);
  return st.cjkChars + st.words;
}

export async function countAndAnalyzeRaw(fullPath: string, debug = false): Promise<TextStats> {
  const text = await readTextFileDetectEncodingCore(fullPath, debug);
  return analyzeText(text);
}
