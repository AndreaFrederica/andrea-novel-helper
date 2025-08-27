// Worker: 使用独立的 wordCountCore，避免直接依赖 vscode 模块
import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { countAndAnalyzeRaw } from '../utils/WordCount/wordCountCore';

interface Task { id: number; filePath: string }
const queue: Task[] = [];
let running = false;

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    const rs = fs.createReadStream(filePath);
    rs.on('data', (chunk) => h.update(chunk));
    rs.on('error', reject);
    rs.on('end', () => resolve(h.digest('hex')));
  });
}

async function loop() {
  if (running) { return; }
  running = true;
  while (queue.length) {
    const { id, filePath } = queue.shift()!;
    try {
      // 1) 统计
      const stats = await countAndAnalyzeRaw(filePath);
      // 2) 文件信息（避免主线程重复 stat）
      const st = await fs.promises.stat(filePath).catch(() => null);
      // 3) sha256（重算场景下才由 worker 计算）
      const hash = await sha256File(filePath).catch(() => undefined);

      parentPort?.postMessage({
        type: 'countResult',
        id,
        stats,
        mtime: st?.mtimeMs,
        size: st?.size,
        hash, // ✅ 新增：sha256
      });
    } catch (e: any) {
      parentPort?.postMessage({
        type: 'countResult',
        id,
        error: String(e?.message || String(e)),
      });
    }
  }
  running = false;
}

parentPort?.on('message', (msg: any) => {
  if (!msg) {return;}
  if (msg.type === 'count' && msg.filePath && typeof msg.id === 'number') {
    queue.push({ id: msg.id, filePath: msg.filePath });
    loop();
  }
});

parentPort?.postMessage({ type: 'ready' });
