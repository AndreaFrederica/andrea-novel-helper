// Worker: 使用独立的 wordCountCore，避免直接依赖 vscode 模块
import { parentPort } from 'worker_threads';
import { countAndAnalyzeRaw } from '../utils/WordCount/wordCountCore';

interface Task { id:number; filePath:string }
const queue: Task[] = [];
let running = false;

async function loop() {
  if (running) { return; }
  running = true;
  while (queue.length) {
    const { id, filePath } = queue.shift()!;
    try {
  const stats = await countAndAnalyzeRaw(filePath);
      parentPort?.postMessage({ type:'countResult', id, stats });
    } catch (e:any) {
      parentPort?.postMessage({ type:'countResult', id, error: String(e?.message || String(e)) });
    }
  }
  running = false;
}

parentPort?.on('message', (msg:any)=>{
  if (!msg) { return; }
  if (msg.type === 'count' && msg.filePath && typeof msg.id === 'number') {
    queue.push({ id: msg.id, filePath: msg.filePath });
    loop();
  }
});

parentPort?.postMessage({ type:'ready' });
