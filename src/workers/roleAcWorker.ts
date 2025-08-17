// Worker: 构建与搜索 Aho-Corasick 自动机（与主线程隔离）
import { parentPort } from 'worker_threads';
// @ts-ignore
import AhoCorasick from 'ahocorasick';

interface RoleMini { name: string; aliases?: string[]; wordSegmentFilter?: any; }
let ac: any = null;
let roleMap = new Map<string, RoleMini>();

// 懒加载分词过滤工具（若失败则忽略过滤）
let segLoaded = false;
let shouldUseSegmentFilter: any = () => false;
let findCompleteWords: any = () => [] as Array<{start:number; end:number}>;
function ensureSeg() {
  if (segLoaded) { return; }
  segLoaded = true;
  try {
    const seg = require('../utils/segmentFilter');
    shouldUseSegmentFilter = seg.shouldUseSegmentFilter || shouldUseSegmentFilter;
    findCompleteWords = seg.findCompleteWords || findCompleteWords;
  } catch {/* ignore */}
}

parentPort?.on('message', (msg: any) => {
  if (!msg || typeof msg !== 'object') { return; }
  switch (msg.type) {
    case 'build': {
      const patterns: string[] = [];
      roleMap.clear();
      for (const r of msg.roles as RoleMini[]) {
        const base = r.name.trim().normalize('NFC');
        patterns.push(base);
        roleMap.set(base, r);
        if (r.aliases) { for (const al of r.aliases) {
          const a = al.trim().normalize('NFC');
          patterns.push(a); roleMap.set(a, r);
        } }
      }
      // @ts-ignore
      ac = new AhoCorasick(patterns);
      parentPort?.postMessage({ type: 'built' });
      break; }
    case 'search': {
  if (!ac) { parentPort?.postMessage({ type: 'result', id: msg.id, matches: [] }); break; }
      ensureSeg();
      const text: string = msg.text || '';
      try {
        const raw = ac.search(text) as Array<[number, string | string[]]>;
        const out: Array<{ end:number; pats:string[] }> = [];
        for (const [endIdx, patOrArr] of raw) {
          const pats = Array.isArray(patOrArr) ? patOrArr : [patOrArr];
          const valid: string[] = [];
          for (const p of pats) {
            const role = roleMap.get(p.trim().normalize('NFC'));
            if (!role) { continue; }
            if (role.wordSegmentFilter && shouldUseSegmentFilter(p, role.wordSegmentFilter)) {
              const matches: Array<{start:number; end:number}> = findCompleteWords(text, p);
              const end = endIdx + 1; const start = end - p.length;
              if (matches.some((m: {start:number; end:number}) => m.start === start && m.end === end)) { valid.push(p); }
            } else { valid.push(p); }
          }
          if (valid.length) { out.push({ end: endIdx, pats: valid }); }
        }
        parentPort?.postMessage({ type: 'result', id: msg.id, matches: out });
      } catch (e) {
        parentPort?.postMessage({ type: 'result', id: msg.id, matches: [], error: String(e) });
      }
      break; }
  }
});

parentPort?.postMessage({ type: 'ready' });
