// src/workers/persistentCache.worker.ts
import { parentPort } from 'worker_threads';
import * as fs from 'fs';

parentPort!.on('message', async (msg: any) => {
    try {
        if (!msg || typeof msg !== 'object') { return; }
        const { type, id, file, encoding } = msg;

        if (type === 'init') {
            // 仅表明 worker 就绪；不再加载 index、不做任何状态维护
            parentPort!.postMessage({ type: 'ready' });
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
