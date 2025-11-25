// 🏷️ Worker: PersistentCacheWorker - 持久化缓存与文件状态管理
import { parentPort } from 'worker_threads';

// 设置Worker名称标识，便于调试器识别
const WORKER_NAME = 'PersistentCacheWorker';
console.log(`🚀 [${WORKER_NAME}] 启动 - 持久化缓存管理器`);
import * as fs from 'fs';

parentPort!.on('message', async (msg: any) => {
    try {
        if (!msg || typeof msg !== 'object') { return; }
        const { type, id, file, encoding } = msg;

        if (type === 'init') {
            // 仅表明 worker 就绪；不再加载 index、不做任何状态维护
            parentPort!.postMessage({ type: 'ready' });
            console.log(`✅ [${WORKER_NAME}] 就绪 - 缓存系统已初始化`);
            return;
        }

        if (type === 'readJson') {
            const buf = await fs.promises.readFile(file);
            const text = encoding ? buf.toString(encoding) : buf.toString('utf8');
            const json = JSON.parse(text);
            parentPort!.postMessage({ type: 'readJsonResult', id, result: json });
            return;
        }

        if (type === 'stat') {
            const st = await fs.promises.stat(file);
            parentPort!.postMessage({
                type: 'statResult',
                id,
                stat: { mtimeMs: st.mtimeMs, size: st.size, isFile: st.isFile() },
            });
            return;
        }
    } catch (e: any) {
        parentPort!.postMessage({ type: 'error', id: msg?.id, error: String(e?.message ?? e) });
    }
});
