// previewPane.ts
import * as vscode from 'vscode';
import { mdToPlainText } from '../../utils/md_plain';

type Block = { srcLine: number; text: string };

export function registerPreviewPane(context: vscode.ExtensionContext) {
    const manager = new PreviewManager(context);

    // 可选：注册两个命令（如你已有命令体系，可省略或复用）
    context.subscriptions.push(
        vscode.commands.registerCommand('myPreview.open', () => manager.openPreviewForActiveEditor()),
        vscode.commands.registerCommand('myPreview.exportTxt', () => manager.exportTxtOfActiveEditor()),
        vscode.commands.registerCommand('myPreview.ttsPlay', () => manager.sendTTSCommand('play')),
        vscode.commands.registerCommand('myPreview.ttsPause', () => manager.sendTTSCommand('pause')),
        vscode.commands.registerCommand('myPreview.ttsStop', () => manager.sendTTSCommand('stop')),
    );

    // 也可把 manager 挂到 exports 供其他模块使用
    return manager;
}

export class PreviewManager {
    private context: vscode.ExtensionContext;
    private panels = new Map<string, vscode.WebviewPanel>(); // docUri → panel
    private loopGuard = new Map<string, number>();           // docUri → timestamp（避免滚动回路）
    private scrollState = new Map<string, { isScrolling: boolean; lastDirection: 'editor' | 'preview' }>(); // 滚动状态跟踪

    constructor(ctx: vscode.ExtensionContext) {
        this.context = ctx;

        // 文档变化：刷新预览
        this.context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(ev => {
                const panel = this.panels.get(ev.document.uri.toString());
                if (panel) { this.debounce(() => this.updatePanel(panel!, ev.document), 80)(); }
            }),
            // 可视区/光标变化：编辑器 → 预览滚动 (统一使用100ms throttle)
            vscode.window.onDidChangeTextEditorVisibleRanges(ev => {
                const key = ev.textEditor.document.uri.toString();
                if (!this.panels.has(key)) { return; }
                this.throttle(() => this.sendEditorTop(ev.textEditor.document), 100)();
            }),
            vscode.window.onDidChangeTextEditorSelection(ev => {
                const key = ev.textEditor.document.uri.toString();
                if (!this.panels.has(key)) { return; }
                this.throttle(() => this.sendEditorTop(ev.textEditor.document), 100)();
            }),
        );
    }

    /* ---------------- 外部可调用 API ---------------- */

    openPreviewForActiveEditor() {
        const doc = vscode.window.activeTextEditor?.document;
        if (!doc) { return; }
        this.ensurePanelFor(doc).then(panel => {
            panel.reveal(vscode.ViewColumn.Beside);
            this.updatePanel(panel, doc);
        });
    }

    async exportTxtOfActiveEditor() {
        const doc = vscode.window.activeTextEditor?.document;
        if (!doc) { return; }
        const { text } = this.renderToPlainText(doc);
        const uri = await vscode.window.showSaveDialog({
            defaultUri: doc.uri.with({ path: doc.uri.path.replace(/\.[^/\\.]+$/, '') + '.txt' }),
            filters: { 'Text': ['txt'] },
        });
        if (!uri) { return; }
        await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
        vscode.window.showInformationMessage(`导出完成：${uri.fsPath}`);
    }

    /** 发送TTS命令到预览面板 */
    sendTTSCommand(command: 'play' | 'pause' | 'stop') {
        const editor = vscode.window.activeTextEditor;
        if (!editor) { 
            vscode.window.showWarningMessage('没有活动的编辑器'); 
            return; 
        }
        
        const key = editor.document.uri.toString();
        const panel = this.panels.get(key);
        if (!panel) { 
            vscode.window.showWarningMessage('没有打开的预览面板'); 
            return; 
        }
        
        panel.webview.postMessage({ type: 'ttsControl', command });
    }

    /* ---------------- 内部：panel 管理 ---------------- */

    private async ensurePanelFor(doc: vscode.TextDocument): Promise<vscode.WebviewPanel> {
        const key = doc.uri.toString();
        let panel = this.panels.get(key);
        if (panel) { return panel; }

        panel = vscode.window.createWebviewPanel(
            'myPreview',
            `Preview: ${this.basename(doc.fileName)}`,
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );
        this.panels.set(key, panel);

        panel.onDidDispose(() => this.panels.delete(key), null, this.context.subscriptions);
        panel.webview.onDidReceiveMessage(msg => this.onWebviewMessage(doc, msg), null, this.context.subscriptions);

        return panel;
    }

    private onWebviewMessage(doc: vscode.TextDocument, msg: any) {
        const key = doc.uri.toString();

        if (msg?.type === 'previewTopLine' && Number.isInteger(msg.line)) {
            // 增强防回路：检查滚动状态和增加时间窗口到500ms
            const t = Date.now();
            const last = this.loopGuard.get(key) ?? 0;
            const state = this.scrollState.get(key);
            
            // 如果500ms内刚从编辑器发起滚动，或正在滚动中，则忽略
            if (t - last < 500 || (state?.isScrolling && state.lastDirection === 'editor')) { 
                return; 
            }

            const editor = this.findEditor(doc);
            if (!editor) { return; }
            
            // 设置滚动状态
            this.scrollState.set(key, { isScrolling: true, lastDirection: 'preview' });
            
            // 优先使用滚动比例，回退到行号
            let targetLine = this.clampInt(msg.line, 0, doc.lineCount - 1);
            
            if (typeof msg.scrollRatio === 'number' && msg.scrollRatio >= 0 && msg.scrollRatio <= 1) {
                // 使用滚动比例计算目标行
                targetLine = Math.round(msg.scrollRatio * Math.max(0, doc.lineCount - 1));
                targetLine = this.clampInt(targetLine, 0, doc.lineCount - 1);
            }
            
            const pos = new vscode.Position(targetLine, 0);
            editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
            
            // 清除滚动状态
            setTimeout(() => {
                const currentState = this.scrollState.get(key);
                if (currentState?.lastDirection === 'preview') {
                    this.scrollState.set(key, { isScrolling: false, lastDirection: 'preview' });
                }
            }, 300);
            
            return;
        }

        if (msg?.type === 'copyPlainText') {
            // 从 webview 请求复制纯文本（优先选区，其次整文）
            const text: string = String(msg.text ?? '');
            vscode.env.clipboard.writeText(text);
            vscode.window.setStatusBarMessage('已复制纯文本', 1200);
            return;
        }
    }

    private updatePanel(panel: vscode.WebviewPanel, doc: vscode.TextDocument) {
        panel.title = `Preview: ${this.basename(doc.fileName)}`;
        const { htmlBody } = this.render(doc);
        panel.webview.html = this.wrapHtml(htmlBody);
    }

    /* ---------------- 渲染：md→txt，txt直显 ---------------- */

    private render(doc: vscode.TextDocument): { htmlBody: string } {
        if (doc.languageId === 'markdown' || /\.md(i|own)?$/i.test(doc.fileName)) {
            const { blocks } = this.renderToPlainText(doc);
            // 每个块一个 <div data-line>，内部 <pre> 展示纯文本
            const htmlBody = blocks.map(b =>
                `<div data-line="${b.srcLine}"><pre>${this.escapeHtml(b.text)}</pre></div>`
            ).join('\n');
            return { htmlBody };
        } else {
            const text = doc.getText(); // .txt 或其他：原样展示为单块
            const htmlBody = `<div data-line="0"><pre>${this.escapeHtml(text)}</pre></div>`;
            return { htmlBody };
        }
    }

    private renderToPlainText(doc: vscode.TextDocument): { text: string; blocks: Block[] } {
        // 委托给独立 md 处理器；非 md 则按整文单块
        if (doc.languageId === 'markdown' || /\.md(i|own)?$/i.test(doc.fileName)) {
            const src = doc.getText();
            const { text, blocks } = mdToPlainText(src);
            return { text, blocks };
        }
        const text = doc.getText();
        const blocks = [{ srcLine: 0, text }];
        return { text, blocks };
    }

    /* ---------------- 编辑器⇄预览 跟随 ---------------- */

    private sendEditorTop(doc: vscode.TextDocument) {
        const key = doc.uri.toString();
        const panel = this.panels.get(key);
        if (!panel) { return; }
        const editor = this.findEditor(doc);
        if (!editor) { return; }

        const state = this.scrollState.get(key);
        // 如果预览正在滚动，则忽略编辑器的滚动事件
        if (state?.isScrolling && state.lastDirection === 'preview') {
            return;
        }

        const topVisible = editor.visibleRanges[0]?.start.line ?? editor.selection.active.line;
        const totalLines = doc.lineCount;
        
        // 计算编辑器滚动比例
        const scrollRatio = Math.min(1, topVisible / Math.max(1, totalLines - 1));
        
        // 设置滚动状态和时间戳
        this.scrollState.set(key, { isScrolling: true, lastDirection: 'editor' });
        this.loopGuard.set(key, Date.now()); // 即将触发 预览滚动，做个时间戳
        
        panel.webview.postMessage({ 
            type: 'scrollToLine', 
            line: topVisible,
            scrollRatio: scrollRatio,
            totalLines: totalLines
        });
        
        // 清除滚动状态
        setTimeout(() => {
            const currentState = this.scrollState.get(key);
            if (currentState?.lastDirection === 'editor') {
                this.scrollState.set(key, { isScrolling: false, lastDirection: 'editor' });
            }
        }, 300);
    }

    /* ---------------- Webview HTML ---------------- */

    private wrapHtml(body: string) {
        const nonce = String(Math.random()).slice(2);
        return `<!doctype html>
<html>
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: light dark; }
  html, body { height: 100%; }
  body { margin: 0; padding: 12px; font: 13px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; }
  pre  { white-space: pre-wrap; word-wrap: break-word; margin: 0 0 12px 0; }
  [data-line] { scroll-margin-top: 8px; }
  /* 底部占位符，提供额外滚动空间 */
  .scroll-spacer { height: 100vh; min-height: 600px; }
  /* TTS 控制面板 */
  .tts-controls { 
    position: fixed; top: 12px; right: 12px; z-index: 1000;
    background: var(--vscode-editor-background, #1e1e1e); 
    color: var(--vscode-editor-foreground, #d4d4d4);
    border: 1px solid var(--vscode-panel-border, #3e3e42);
    border-radius: 6px; padding: 8px; 
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    display: flex; gap: 8px; align-items: center;
    font-size: 12px;
  }
  .tts-btn { 
    background: var(--vscode-button-background, #0e639c); 
    color: var(--vscode-button-foreground, #fff);
    border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer;
    font-size: 11px; min-width: 50px;
  }
  .tts-btn:hover { background: var(--vscode-button-hoverBackground, #1177bb); }
  .tts-btn:disabled { 
    background: var(--vscode-button-secondaryBackground, #3a3d41); 
    color: var(--vscode-button-secondaryForeground, #888);
    cursor: not-allowed;
  }
  .tts-select {
    background: var(--vscode-dropdown-background, #3c3c3c);
    color: var(--vscode-dropdown-foreground, #cccccc);
    border: 1px solid var(--vscode-dropdown-border, #3e3e42);
    border-radius: 3px; padding: 2px 4px; font-size: 11px;
  }
  /* 右键菜单 */
  .ctx { position: fixed; z-index: 9999; background: var(--vscode-editor-background, #222); color: var(--vscode-editor-foreground, #ddd);
         border: 1px solid #5556; border-radius: 6px; min-width: 160px; box-shadow: 0 8px 24px #0008; display: none; }
  .ctx ul { list-style: none; margin: 6px 0; padding: 4px 0; }
  .ctx li { padding: 6px 12px; cursor: default; }
  .ctx li:hover { background: #ffffff22; }
</style>
</head>
<body>
${body}
<div class="tts-controls">
  <select class="tts-select" id="tts-voice">
    <option value="">选择语音</option>
  </select>
  <button class="tts-btn" id="tts-play">播放</button>
  <button class="tts-btn" id="tts-pause">暂停</button>
  <button class="tts-btn" id="tts-stop">停止</button>
  <span id="tts-status">就绪</span>
</div>
<div class="scroll-spacer"></div>
<div class="ctx" id="ctx"><ul>
  <li id="ctx-copy">复制纯文本</li>
  <li id="ctx-tts">朗读选中文本</li>
</ul></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  let index = [];

  /* ------ TTS 功能 ------ */
  let currentUtterance = null;
  let isPaused = false;
  let ttsVoices = [];
  
  // 初始化语音列表
  function initTTSVoices() {
    if ('speechSynthesis' in window) {
      ttsVoices = speechSynthesis.getVoices();
      const voiceSelect = document.getElementById('tts-voice');
      voiceSelect.innerHTML = '<option value="">选择语音</option>';
      
      // 优先显示中文语音
      const chineseVoices = ttsVoices.filter(voice => 
        voice.lang.includes('zh') || voice.name.includes('中文') || voice.name.includes('Chinese')
      );
      const otherVoices = ttsVoices.filter(voice => 
        !voice.lang.includes('zh') && !voice.name.includes('中文') && !voice.name.includes('Chinese')
      );
      
      [...chineseVoices, ...otherVoices].forEach((voice, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = \`\${voice.name} (\${voice.lang})\`;
        if (voice.default) option.textContent += ' [默认]';
        voiceSelect.appendChild(option);
      });
      
      // 自动选择第一个中文语音
      if (chineseVoices.length > 0) {
        const firstChineseIndex = ttsVoices.findIndex(v => v === chineseVoices[0]);
        voiceSelect.value = firstChineseIndex;
      }
    }
  }
  
  // 获取要朗读的文本
  function getTTSText() {
    const selection = window.getSelection()?.toString().trim();
    if (selection) return selection;
    
    // 获取所有文本内容，排除TTS控制面板
    const preElements = document.querySelectorAll('pre');
    return Array.from(preElements).map(pre => pre.textContent || '').join('\\n\\n').trim();
  }
  
  // 更新状态显示
  function updateTTSStatus(status) {
    document.getElementById('tts-status').textContent = status;
  }
  
  // 播放TTS
  function playTTS() {
    if (!('speechSynthesis' in window)) {
      updateTTSStatus('不支持TTS');
      return;
    }
    
    const text = getTTSText();
    if (!text) {
      updateTTSStatus('无文本');
      return;
    }
    
    if (isPaused && currentUtterance) {
      speechSynthesis.resume();
      isPaused = false;
      updateTTSStatus('继续播放');
      return;
    }
    
    stopTTS();
    
    currentUtterance = new SpeechSynthesisUtterance(text);
    
    // 设置语音
    const voiceSelect = document.getElementById('tts-voice');
    const selectedVoiceIndex = parseInt(voiceSelect.value);
    if (!isNaN(selectedVoiceIndex) && ttsVoices[selectedVoiceIndex]) {
      currentUtterance.voice = ttsVoices[selectedVoiceIndex];
    }
    
    // 设置参数
    currentUtterance.rate = 1.0;  // 语速
    currentUtterance.pitch = 1.0; // 音调
    currentUtterance.volume = 1.0; // 音量
    
    // 事件处理
    currentUtterance.onstart = () => updateTTSStatus('播放中');
    currentUtterance.onend = () => {
      updateTTSStatus('播放完成');
      currentUtterance = null;
      isPaused = false;
    };
    currentUtterance.onerror = (e) => {
      updateTTSStatus(\`错误: \${e.error}\`);
      currentUtterance = null;
      isPaused = false;
    };
    currentUtterance.onpause = () => updateTTSStatus('已暂停');
    currentUtterance.onresume = () => updateTTSStatus('继续播放');
    
    speechSynthesis.speak(currentUtterance);
  }
  
  // 暂停TTS
  function pauseTTS() {
    if (speechSynthesis.speaking && !speechSynthesis.paused) {
      speechSynthesis.pause();
      isPaused = true;
      updateTTSStatus('已暂停');
    }
  }
  
  // 停止TTS
  function stopTTS() {
    speechSynthesis.cancel();
    currentUtterance = null;
    isPaused = false;
    updateTTSStatus('已停止');
  }
  
  // 初始化TTS
  if ('speechSynthesis' in window) {
    speechSynthesis.onvoiceschanged = initTTSVoices;
    initTTSVoices(); // 立即调用一次
    
    // 绑定按钮事件
    document.getElementById('tts-play').addEventListener('click', playTTS);
    document.getElementById('tts-pause').addEventListener('click', pauseTTS);
    document.getElementById('tts-stop').addEventListener('click', stopTTS);
    
    updateTTSStatus('就绪');
  } else {
    updateTTSStatus('不支持TTS');
    document.querySelectorAll('.tts-btn').forEach(btn => btn.disabled = true);
  }

  function rebuildIndexNow() {
    index = [];
    const nodes = document.querySelectorAll('[data-line]');
    for (const el of nodes) {
      const line = Number(el.getAttribute('data-line'));
      const top  = el.getBoundingClientRect().top + window.scrollY;
      index.push({ line, top });
    }
    index.sort((a,b)=>a.top-b.top);
  }
  const rebuildIndex = throttle(rebuildIndexNow, 100);

  function scrollToLine(line, smooth, scrollRatio, totalLines) {
    if (!index.length) return;
    
    // 如果提供了滚动比例和总行数，优先使用比例滚动
    if (typeof scrollRatio === 'number' && typeof totalLines === 'number') {
      const documentHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      const windowHeight = window.innerHeight;
      const maxScrollTop = documentHeight - windowHeight;
      
      // 根据编辑器的滚动比例计算预览的滚动位置
      const targetScrollTop = maxScrollTop * scrollRatio;
      window.scrollTo({ top: Math.max(0, targetScrollTop), behavior: smooth ? 'smooth' : 'instant' });
      return;
    }
    
    // 原有的基于行号的滚动逻辑作为备用
    let lo=0, hi=index.length-1, ans=0;
    while (lo<=hi) {
      const mid=(lo+hi)>>1;
      if (index[mid].line <= line) { ans=mid; lo=mid+1; }
      else hi=mid-1;
    }
    const y = index[ans]?.top ?? 0;
    window.scrollTo({ top: Math.max(0, y-4), behavior: smooth ? 'smooth' : 'instant' });
  }

  function currentTopLine() {
    if (!index.length) return 0;
    const y = window.scrollY + 1;
    let lo=0, hi=index.length-1, ans=0;
    while (lo<=hi) {
      const mid=(lo+hi)>>1;
      if (index[mid].top <= y) { ans=mid; lo=mid+1; }
      else hi=mid-1;
    }
    return index[ans].line;
  }

  function getCurrentScrollRatio() {
    const documentHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    const windowHeight = window.innerHeight;
    const maxScrollTop = documentHeight - windowHeight;
    
    if (maxScrollTop <= 0) return 0;
    return Math.min(1, window.scrollY / maxScrollTop);
  }

  let scrollTimeout = null;
  let lastScrollFromEditor = 0;

  window.addEventListener('message', ev => {
    const msg = ev.data;
    if (msg?.type === 'scrollToLine' && Number.isInteger(msg.line)) {
      lastScrollFromEditor = Date.now();
      scrollToLine(msg.line, true, msg.scrollRatio, msg.totalLines);
    }
    if (msg?.type === 'rebuildIndex') rebuildIndex();
    if (msg?.type === 'ttsControl') {
      switch (msg.command) {
        case 'play': playTTS(); break;
        case 'pause': pauseTTS(); break;
        case 'stop': stopTTS(); break;
      }
    }
  });

  document.addEventListener('scroll', throttle(() => {
    // 如果300ms内刚从编辑器滚动过来，则不回传给编辑器
    const now = Date.now();
    if (now - lastScrollFromEditor < 300) {
      return;
    }
    
    const line = currentTopLine();
    const scrollRatio = getCurrentScrollRatio();
    vscode.postMessage({ type: 'previewTopLine', line, scrollRatio });
  }, 100), { passive: true }); // 增加throttle时间到100ms保持一致

  window.addEventListener('load', rebuildIndex);
  new ResizeObserver(rebuildIndex).observe(document.documentElement);
  document.addEventListener('load', rebuildIndex, true);

  /* ------ 右键菜单：复制纯文本 & TTS ------ */
  const ctx = document.getElementById('ctx');
  const ctxCopy = document.getElementById('ctx-copy');
  const ctxTTS = document.getElementById('ctx-tts');

  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showCtx(e.clientX, e.clientY);
  });

  document.addEventListener('click', () => hideCtx());

  ctxCopy.addEventListener('click', () => {
    const sel = String(window.getSelection()?.toString() || '');
    if (sel) {
      vscode.postMessage({ type: 'copyPlainText', text: sel });
    } else {
      // 没有选区：复制整页纯文本（从 <pre> 收集）
      const all = Array.from(document.querySelectorAll('pre')).map(n => n.textContent||'').join('\\n\\n').replace(/\\n{3,}/g,'\\n\\n');
      vscode.postMessage({ type: 'copyPlainText', text: all });
    }
    hideCtx();
  });

  ctxTTS.addEventListener('click', () => {
    playTTS();
    hideCtx();
  });

  function showCtx(x, y) {
    ctx.style.display = 'block';
    const { innerWidth:w, innerHeight:h } = window;
    const rect = ctx.getBoundingClientRect();
    const nx = Math.min(x, w - rect.width - 8);
    const ny = Math.min(y, h - rect.height - 8);
    ctx.style.left = nx + 'px';
    ctx.style.top  = ny + 'px';
  }
  function hideCtx(){ ctx.style.display = 'none'; }

  function throttle(fn, ms){
    let t, last=0;
    return (...args)=>{
      const now = Date.now(), remain = ms - (now-last);
      if (remain <= 0){ last = now; fn(...args); }
      else if (!t){ t = setTimeout(()=>{ t=undefined; last=Date.now(); fn(...args); }, remain); }
    };
  }
</script>
</body>
</html>`;
    }

    /* ---------------- 小工具 ---------------- */
    private basename(p: string) { return p.replace(/[/\\]+/g, '/').split('/').pop() || p; }
    private clampInt(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }
    private escapeHtml(s: string) {
        return s.replace(/[&<>"']/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;');
    }
    private debounce<F extends (...args: any[]) => void>(fn: F, ms: number) {
        let t: NodeJS.Timeout | undefined;
        return (...args: Parameters<F>) => { if (t) { clearTimeout(t); } t = setTimeout(() => fn(...args), ms); };
    }
    private throttle<F extends (...args: any[]) => void>(fn: F, ms: number) {
        let t: NodeJS.Timeout | undefined, last = 0;
        return (...args: Parameters<F>) => {
            const now = Date.now(), remain = ms - (now - last);
            if (remain <= 0) { last = now; fn(...args); }
            else if (!t) { t = setTimeout(() => { t = undefined; last = Date.now(); fn(...args); }, remain); }
        };
    }
    private findEditor(doc: vscode.TextDocument) {
        return vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === doc.uri.toString());
    }
}
