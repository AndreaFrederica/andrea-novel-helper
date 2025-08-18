// media/preview.js
'use strict';

/* ================== 调试配置 ================== */
var DEBUG_TTS = true;           // 控制是否在 Webview 控制台输出日志
var DEBUG_POST_TO_EXT = false;  // 如需把日志发回扩展侧，设为 true

function dlog(tag, payload) {
    if (!DEBUG_TTS) { return; }
    try { console.log('[TTS]', tag, payload); } catch { }
    if (DEBUG_POST_TO_EXT && typeof acquireVsCodeApi === 'function') {
        try { vscode && vscode.postMessage({ type: 'debug', payload: { tag: tag, data: payload } }); } catch { }
    }
}

/* ================== VS Code API & 错误上报 ================== */
var vscode = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : null;

window.addEventListener('error', function (e) {
    try { vscode && vscode.postMessage({ type: 'jsError', message: String(e.message || 'Unknown'), line: e.lineno, col: e.colno }); } catch { }
});
window.addEventListener('unhandledrejection', function (e) {
    try { vscode && vscode.postMessage({ type: 'jsError', message: 'UnhandledRejection: ' + String((e && e.reason) || '') }); } catch { }
});

/* ================== 滚动索引 / 同步 ================== */
var index = []; // [{line, top}]
function rebuildIndexNow() {
    index = [];
    var nodes = document.querySelectorAll('[data-line]');
    nodes.forEach(function (el) {
        var line = Number(el.getAttribute('data-line'));
        var rect = el.getBoundingClientRect();
        var top = rect.top + window.scrollY;
        index.push({ line: line, top: top });
    });
    index.sort(function (a, b) { return a.top - b.top; });
}
var rebuildIndex = throttle(rebuildIndexNow, 100);

function scrollToLine(line, smooth, scrollRatio, totalLines) {
    if (!index.length) { return; }

    if (typeof scrollRatio === 'number' && typeof totalLines === 'number') {
        var docH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        var winH = window.innerHeight;
        var maxTop = docH - winH;
        var target = maxTop * Math.min(1, Math.max(0, scrollRatio));
        window.scrollTo({ top: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto' });
        return;
    }

    var lo = 0, hi = index.length - 1, ans = 0;
    while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (index[mid].line <= line) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    var y = index[ans] ? index[ans].top : 0;
    window.scrollTo({ top: Math.max(0, y - 4), behavior: smooth ? 'smooth' : 'auto' });
}

function currentTopLine() {
    if (!index.length) { return 0; }
    var y = window.scrollY + 1;
    var lo = 0, hi = index.length - 1, ans = 0;
    while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (index[mid].top <= y) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return index[ans].line;
}

function getCurrentScrollRatio() {
    var docH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
    var winH = window.innerHeight;
    var maxTop = docH - winH;
    if (maxTop <= 0) { return 0; }
    return Math.min(1, window.scrollY / maxTop);
}

/* ================== 与扩展通信 ================== */
var lastScrollFromEditor = 0;

window.addEventListener('message', function (ev) {
    var msg = ev.data;
    if (msg && msg.type === 'scrollToLine' && Number.isInteger(msg.line)) {
        lastScrollFromEditor = Date.now();
        scrollToLine(msg.line, true, msg.scrollRatio, msg.totalLines);
    }
    if (msg && msg.type === 'rebuildIndex') { rebuildIndex(); }
    if (msg && msg.type === 'ttsControl') {
        if (msg.command === 'play') { playTTS(); }
        if (msg.command === 'pause') { pauseTTS(); }
        if (msg.command === 'stop') { stopTTS(); }
    }
});

document.addEventListener('scroll', throttle(function () {
    var now = Date.now();
    if (now - lastScrollFromEditor < 300) { return; }
    var line = currentTopLine();
    var ratio = getCurrentScrollRatio();
    vscode && vscode.postMessage({ type: 'previewTopLine', line: line, scrollRatio: ratio });
}, 100), { passive: true });

window.addEventListener('load', rebuildIndex);
new ResizeObserver(rebuildIndex).observe(document.documentElement);
document.addEventListener('load', rebuildIndex, true);

/* ================== 右键菜单：复制纯文本 & TTS ================== */
var ctx = document.getElementById('ctx');
var ctxCopy = document.getElementById('ctx-copy');
var ctxTTS = document.getElementById('ctx-tts');

document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    showCtx(e.clientX, e.clientY);
});
document.addEventListener('click', function () { hideCtx(); });

if (ctxCopy) {
    ctxCopy.addEventListener('click', function () {
        var sel = String((window.getSelection() && window.getSelection().toString()) || '');
        if (sel) {
            vscode && vscode.postMessage({ type: 'copyPlainText', text: sel });
        } else {
            var all = Array.from(document.querySelectorAll('pre'))
                .map(function (n) { return n.textContent || ''; })
                .join('\n\n')
                .replace(/\n{3,}/g, '\n\n');
            vscode && vscode.postMessage({ type: 'copyPlainText', text: all });
        }
        hideCtx();
    });
}
if (ctxTTS) {
    ctxTTS.addEventListener('click', function () { playTTS(); hideCtx(); });
}

function showCtx(x, y) {
    if (!ctx) { return; }
    ctx.style.display = 'block';
    var w = window.innerWidth;
    var rect = ctx.getBoundingClientRect();
    var nx = Math.min(x, w - rect.width - 8);
    var ny = Math.min(y, window.innerHeight - rect.height - 8);
    ctx.style.left = nx + 'px';
    ctx.style.top = ny + 'px';
}
function hideCtx() { if (ctx) { ctx.style.display = 'none'; } }

/* ================== TTS（Web Speech API） ================== */
var currentUtterance = null;
var ttsVoices = [];
var isPaused = false;

var readingNodes = [];          // DOM 索引 [{node, start, end, virtual?}]
var selectionRangeCache = null; // 选区模式缓存的初始 Range
var currentHighlightEl = null;
var utterText = '';             // 正在朗读的文本（选区或全文）

/* --- 清理高亮 --- */
function clearTTSHighlight() {
    if (currentHighlightEl) {
        var parent = currentHighlightEl.parentNode;
    while (currentHighlightEl.firstChild) { parent.insertBefore(currentHighlightEl.firstChild, currentHighlightEl); }
        parent.removeChild(currentHighlightEl);
        currentHighlightEl = null;
    }
}

/* -------- DOM 文本节点索引（每次高亮前重建，避免拆分误差） -------- */
function buildNodesForRange(range) {
    var walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
            if (!range.intersectsNode(node)) { return NodeFilter.FILTER_REJECT; }
            if (!node.nodeValue || !node.nodeValue.trim()) { return NodeFilter.FILTER_SKIP; }
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    var list = [];
    var offset = 0, n;
    while ((n = walker.nextNode())) {
        var text = n.nodeValue || '';
        var start = offset, end = start + text.length;
        list.push({ node: n, start: start, end: end });
        offset = end;
    }
    return list;
}
function buildFullDocumentNodes() {
    var list = [];
    var offset = 0;
    var pres = Array.from(document.querySelectorAll('pre'));
    pres.forEach(function (pre, pi) {
        var walker = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT, null);
        var tn;
        while ((tn = walker.nextNode())) {
            var text = tn.nodeValue || '';
            var start = offset, end = start + text.length;
            list.push({ node: tn, start: start, end: end, virtual: false });
            offset = end;
        }
        if (pi < pres.length - 1) {
            // 插入两个“虚拟换行”（\n\n），用于与 utterText 对齐
            var start2 = offset, end2 = start2 + 2;
            list.push({ node: pre, start: start2, end: end2, virtual: true });
            offset = end2;
        }
    });
    return list;
}
function refreshReadingNodes(isSelection) {
    if (isSelection && selectionRangeCache) {
        readingNodes = buildNodesForRange(selectionRangeCache);
    } else {
        readingNodes = buildFullDocumentNodes();
    }
}

/* ================== 使用 Intl.Segmenter 分词 ================== */
/** 预分词列表，元素：{start, end, text, isWordLike}（只在 utterText 变化时重建） */
var segList = null;

/** 基于 Intl.Segmenter 的分词（优先 'word'，fallback 到 'grapheme'） */
function buildSegmentsWithIntl(text) {
    if (typeof Intl === 'undefined' || typeof Intl.Segmenter === 'undefined') { return null; }

    // 使用 VS Code Webview 的界面语言；如果想强制中文可改为 ['zh']。
    var locales = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'und'];

    var seg = [];
    try {
        // 先尝试 word（英文能按词，中文一般按字；带 isWordLike 标记）
        var segWord = new Intl.Segmenter(locales, { granularity: 'word' });
        var it = segWord.segment(text);
        for (var s of it) {
            seg.push({ start: s.index, end: s.index + s.segment.length, text: s.segment, isWordLike: !!s.isWordLike });
        }
    } catch (_) {
        // 极端情况下退化为 grapheme
        var segG = new Intl.Segmenter(locales, { granularity: 'grapheme' });
        var it2 = segG.segment(text);
        for (var s2 of it2) {
            seg.push({ start: s2.index, end: s2.index + s2.segment.length, text: s2.segment, isWordLike: true });
        }
    }
    return seg;
}

/** 不支持 Segmenter 的简易回退：中文按字、英文按 [A-Za-z0-9_]+ 聚合 */
function buildSegmentsFallback(text) {
    var res = [];
    var i = 0, n = text.length;
    var isWordChar = function (ch) { return /[A-Za-z0-9_]/.test(ch); };
    var isSpace = function (ch) { return /\s/.test(ch); };
    var isCJK = function (ch) { var code = ch.codePointAt(0); return (code >= 0x3400 && code <= 0x9FFF) || (code >= 0xF900 && code <= 0xFAFF); };

    while (i < n) {
        var ch = text[i];
        if (isSpace(ch)) { res.push({ start: i, end: i + 1, text: ch, isWordLike: false }); i++; continue; }
        if (isCJK(ch)) { res.push({ start: i, end: i + 1, text: ch, isWordLike: true }); i++; continue; }
        if (isWordChar(ch)) {
            var j = i + 1;
            while (j < n && isWordChar(text[j])) { j++; }
            res.push({ start: i, end: j, text: text.slice(i, j), isWordLike: true });
            i = j; continue;
        }
        // 标点或其他
        res.push({ start: i, end: i + 1, text: ch, isWordLike: false });
        i++;
    }
    return res;
}

/** 根据 charIndex 找到 segList 中覆盖它的段；若命中空白/标点，尽量右移到下一个 isWordLike 段 */
function findSegmentAtIndex(list, idx) {
    if (!list || !list.length) { return null; }

    var lo = 0, hi = list.length - 1, pos = list.length;
    while (lo <= hi) {
        var mid = (lo + hi) >> 1, s = list[mid];
        if (idx < s.start) { pos = mid; hi = mid - 1; }
        else if (idx >= s.end) { lo = mid + 1; }
        else { pos = mid; break; }
    }
    if (pos >= list.length) { pos = list.length - 1; }
    var chosen = list[pos];

    // 如果正好在段尾或是非 wordLike，尽量往右找一个 wordLike 段
    if (idx >= chosen.end || !chosen.isWordLike) {
        var p = pos;
    while (p < list.length && !list[p].isWordLike) { p++; }
    if (p < list.length) { chosen = list[p]; }
    }
    return chosen;
}

/** 预处理：在开始朗读时构建 segList */
function prepareSegmentsFor(text) {
    segList = buildSegmentsWithIntl(text);
    if (!segList) {
        segList = buildSegmentsFallback(text);
    }
    // 合理性裁剪日志：只看前 30 个
    dlog('seg.build', { count: segList.length, head: segList.slice(0, 30).map(s => [s.start, s.end, s.text]) });
}

/* ================== 高亮映射（utterText → DOM） ================== */
function refreshReadingNodesAndLog(isSelection) {
    refreshReadingNodes(isSelection);
    if (DEBUG_TTS) {
        // 打个轻量日志，避免打印巨量节点
        var sample = readingNodes.slice(0, 10).map(function (r) {
            var txt = r.node.nodeValue || '';
            return { start: r.start, end: r.end, virtual: !!r.virtual, sample: txt.slice(0, 20) };
        });
        dlog('domIndex', { size: readingNodes.length, head: sample });
    }
}

/** 把 utterText 的 [start, start+len) 映射到 DOM 并高亮 */
function locateAndHighlight(startIdx, len, isSelection) {
    if (!len || len < 1) { len = 1; }

    refreshReadingNodesAndLog(isSelection);
    if (!readingNodes.length) { return; }

    dlog('locate.request', { startIdx: startIdx, len: len, mapSize: readingNodes.length });

    // 找“包含 startIdx 的段”或“右侧最近段”
    var lo = 0, hi = readingNodes.length - 1, pos = readingNodes.length;
    while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        var seg = readingNodes[mid];
        if (startIdx < seg.start) { pos = mid; hi = mid - 1; }
        else if (startIdx >= seg.end) { lo = mid + 1; }
        else { pos = mid; break; }
    }

    // 跳过虚拟 \n\n 段或恰好位于段末
    var skipped = 0;
    while (pos < readingNodes.length &&
        (readingNodes[pos].virtual || startIdx >= readingNodes[pos].end)) {
        pos++; skipped++;
    }
    if (pos >= readingNodes.length) { return; }

    var seg2 = readingNodes[pos];
    var node = seg2.node;
    var localStart = startIdx - seg2.start;
    if (localStart < 0) { localStart = 0; }
    if (localStart >= node.nodeValue.length) { localStart = Math.max(0, node.nodeValue.length - 1); }
    var localEnd = Math.min(node.nodeValue.length, localStart + len);

    dlog('locate.chosen', {
        pos: pos,
        skippedVirtual: skipped,
        segStart: seg2.start, segEnd: seg2.end, virtual: !!seg2.virtual,
        localStart: localStart, localEnd: localEnd,
        nodeSample: node.nodeValue.slice(0, 40)
    });

    try {
        clearTTSHighlight();
        var range = document.createRange();
        range.setStart(node, localStart);
        range.setEnd(node, localEnd);
        var span = document.createElement('span');
        span.className = 'tts-reading-highlight';
        range.surroundContents(span);
        currentHighlightEl = span;
        var rect = span.getBoundingClientRect();
        if (rect.top < 0 || rect.bottom > window.innerHeight) {
            span.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    } catch (e) {
        dlog('locate.wrapError', String(e && e.message || e));
        try {
            clearTTSHighlight();
            var r2 = document.createRange();
            r2.setStart(node, Math.min(localStart, node.nodeValue.length - 1));
            r2.setEnd(node, Math.min(node.nodeValue.length, r2.startOffset + 1));
            var sp = document.createElement('span');
            sp.className = 'tts-reading-highlight';
            r2.surroundContents(sp);
            currentHighlightEl = sp;
        } catch (e2) {
            dlog('locate.fallbackError', String(e2 && e2.message || e2));
        }
    }
}

/* ================== TTS 主流程 ================== */
function initTTSVoices() {
    if (!('speechSynthesis' in window)) { return; }
    ttsVoices = window.speechSynthesis.getVoices();
    var voiceSelect = document.getElementById('tts-voice');
    if (!voiceSelect) { return; }

    voiceSelect.innerHTML = '<option value="">选择语音</option>';
    var zh = ttsVoices.filter(function (v) { return v.lang.indexOf('zh') >= 0 || v.name.indexOf('中文') >= 0 || v.name.indexOf('Chinese') >= 0; });
    var other = ttsVoices.filter(function (v) { return zh.indexOf(v) < 0; });

    [].concat(zh, other).forEach(function (v, i) {
        var op = document.createElement('option');
        op.value = String(i);
        op.textContent = v.name + ' (' + v.lang + ')' + (v.default ? ' [默认]' : '');
        voiceSelect.appendChild(op);
    });

    if (zh.length > 0) {
        var idx = ttsVoices.findIndex(function (v) { return v === zh[0]; });
        voiceSelect.value = String(idx);
    }
}

function getTTSText() {
    var selection = (window.getSelection() && window.getSelection().toString().trim()) || '';
    if (selection) { return selection; }
    var preElements = document.querySelectorAll('pre');
    return Array.from(preElements).map(function (pre) { return pre.textContent || ''; }).join('\n\n').trim();
}

function updateTTSStatus(status) {
    var el = document.getElementById('tts-status');
    if (el) { el.textContent = status; }
}

function playTTS() {
    if (!('speechSynthesis' in window)) { updateTTSStatus('不支持TTS'); return; }

    var selectionRaw = (window.getSelection() && window.getSelection().toString()) || '';
    utterText = getTTSText();
    if (!utterText) { updateTTSStatus('无文本'); return; }

    if (window.speechSynthesis.paused && currentUtterance) {
        window.speechSynthesis.resume();
        updateTTSStatus('继续播放');
        return;
    }

    stopTTS();

    // 记录选区范围（用于 DOM 索引重建）
    if (selectionRaw && selectionRaw.trim().length > 0) {
        var sel = window.getSelection();
        selectionRangeCache = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null;
    } else {
        selectionRangeCache = null;
    }

    clearTTSHighlight();

    // ☆ 关键：预先用 Intl.Segmenter（或回退）把 utterText 切好段
    prepareSegmentsFor(utterText);

    currentUtterance = new window.SpeechSynthesisUtterance(utterText);

    var voiceSelect = document.getElementById('tts-voice');
    if (voiceSelect) {
        var idx = parseInt(voiceSelect.value, 10);
    if (!isNaN(idx) && ttsVoices[idx]) { currentUtterance.voice = ttsVoices[idx]; }
    }

    currentUtterance.rate = 1.0;
    currentUtterance.pitch = 1.0;
    currentUtterance.volume = 1.0;

    currentUtterance.onstart = function () { updateTTSStatus('播放中'); };
    currentUtterance.onend = function () { updateTTSStatus('播放完成'); currentUtterance = null; clearTTSHighlight(); };
    currentUtterance.onerror = function (e) { updateTTSStatus('错误: ' + (e.error || 'unknown')); currentUtterance = null; clearTTSHighlight(); };
    currentUtterance.onpause = function () { updateTTSStatus('已暂停'); };
    currentUtterance.onresume = function () { updateTTSStatus('继续播放'); };

    // boundary：用 segList 定位“当前词/字”
    currentUtterance.onboundary = function (ev) {
        var base = (typeof ev.charIndex === 'number') ? ev.charIndex : 0;

        var seg = findSegmentAtIndex(segList, base);
        // 兜底：没有 seg（极少数边界值），就用 base 高亮一个字符
        var s = seg ? seg.start : base;
        var e = seg ? seg.end : (base + 1);
        var len = Math.max(1, e - s);

        // 日志 + 上下文
        var left = utterText.slice(Math.max(0, s - 15), s);
        var mid = utterText.slice(s, e);
        var right = utterText.slice(e, e + 15);
        dlog('boundary', {
            charIndex: ev.charIndex,
            ourStart: s,
            ourLen: len,
            context: left + '|' + mid + '|' + right,
            segLike: seg ? !!seg.isWordLike : null
        });

        locateAndHighlight(s, len, !!selectionRangeCache);
    };

    window.speechSynthesis.speak(currentUtterance);
}

function pauseTTS() {
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
        window.speechSynthesis.pause();
        updateTTSStatus('已暂停');
    }
}
function stopTTS() {
    window.speechSynthesis.cancel();
    currentUtterance = null;
    updateTTSStatus('已停止');
    clearTTSHighlight();
}

if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = initTTSVoices;
    initTTSVoices();
    var btnPlay = document.getElementById('tts-play');
    var btnPause = document.getElementById('tts-pause');
    var btnStop = document.getElementById('tts-stop');
    btnPlay && btnPlay.addEventListener('click', playTTS);
    btnPause && btnPause.addEventListener('click', pauseTTS);
    btnStop && btnStop.addEventListener('click', stopTTS);
    updateTTSStatus('就绪');
    // 关闭 / 刷新 webview 前自动停止，避免残留语音继续播放
    window.addEventListener('beforeunload', function(){ try { stopTTS(); } catch {} });
} else {
    updateTTSStatus('不支持TTS');
    Array.from(document.querySelectorAll('.tts-btn')).forEach(function (btn) { btn.disabled = true; });
}

/* ================== 布局调整：避免 TTS 控件遮挡首段文字 ================== */
function adjustForTTSControls() {
    try {
        var controls = document.querySelector('.tts-controls');
        if (!controls) { return; }
        var rect = controls.getBoundingClientRect();
        // 预留 8~16px 额外间距，避免与正文第一行贴得太近
        var reserve = Math.round(rect.height + 20);
        // 仅当需要更多空间时才修改，避免重复写入触发重排
        var cur = parseInt(window.getComputedStyle(document.body).paddingTop, 10) || 0;
        if (reserve > cur) {
            document.body.style.paddingTop = reserve + 'px';
            // 重新建立滚动索引，保证行号定位准确
            if (typeof rebuildIndexNow === 'function') { rebuildIndexNow(); }
        }
    } catch (e) { dlog('adjustForTTSControls.error', String(e)); }
}
window.addEventListener('load', adjustForTTSControls);
window.addEventListener('resize', throttle(adjustForTTSControls, 200));

/* ================== 工具：节流 ================== */
function throttle(fn, ms) {
    var t, last = 0;
    return function () {
        var now = Date.now(), remain = ms - (now - last);
        var args = arguments, ctx = this;
        if (remain <= 0) {
            last = now;
            fn.apply(ctx, args);
        } else if (!t) {
            t = setTimeout(function () { t = undefined; last = Date.now(); fn.apply(ctx, args); }, remain);
        }
    };
}

/* ================== Reader 设置面板与状态 ================== */
(function initReaderSettings(){
    var gear = document.getElementById('reader-gear');
    var panel = document.getElementById('reader-settings');
    if(!gear || !panel) { return; }
    var inputs = {
        font: document.getElementById('rs-font'),
        line: document.getElementById('rs-line'),
        para: document.getElementById('rs-para'),
        pad: document.getElementById('rs-pad'),
        width: document.getElementById('rs-width'),
    height: document.getElementById('rs-height'),
    pageHeight: document.getElementById('rs-pageHeight')
    };
    var vals = {
        font: document.getElementById('rs-font-val'),
        line: document.getElementById('rs-line-val'),
        para: document.getElementById('rs-para-val'),
        pad: document.getElementById('rs-pad-val')
    };
    var modeGroup = document.getElementById('rs-modes');
    var alignGroup = document.getElementById('rs-aligns');
    var colsGroup = document.getElementById('rs-cols');
    var themeGroup = document.getElementById('rs-themes');
    var btnReset = document.getElementById('rs-reset');
    var presetSelect = document.getElementById('rs-preset');
    var btnSavePreset = document.getElementById('rs-savePreset');
    var btnDelPreset = document.getElementById('rs-delPreset');
    var btnClose = document.getElementById('rs-close');
    var pageBar = document.getElementById('reader-pagebar');
    var pageInfo = document.getElementById('rp-info');
    var btnPrev = document.getElementById('rp-prev');
    var btnNext = document.getElementById('rp-next');

    var STORE_KEY = 'anhReaderSettings';
    var PRESET_KEY = 'anhReaderPresets';
    function loadState(){
        try{ return JSON.parse(localStorage.getItem(STORE_KEY)||'{}'); }catch(_){ return {}; }
    }
    function saveState(s){ try{ localStorage.setItem(STORE_KEY, JSON.stringify(s)); }catch(_){} }
    var state = Object.assign({ font:16, line:1.6, para:8, pad:12, width:720, height:0, pageHeight:0, mode:'scroll', theme:'auto', align:'left', cols:1 }, loadState());
    var presets = (function(){ try{ return JSON.parse(localStorage.getItem(PRESET_KEY)||'{}'); }catch(_){ return {}; } })();

    function reflect(){
        inputs.font.value = state.font; vals.font.textContent = state.font;
        inputs.line.value = state.line; vals.line.textContent = state.line.toFixed(2);
        inputs.para.value = state.para; vals.para.textContent = state.para;
        inputs.pad.value = state.pad; vals.pad.textContent = state.pad;
    inputs.width.value = state.width; inputs.height.value = state.height || ''; inputs.pageHeight.value = state.pageHeight || '';
        document.documentElement.style.setProperty('--reader-font-size', state.font+'px');
        document.documentElement.style.setProperty('--reader-line-height', state.line);
        document.documentElement.style.setProperty('--reader-para-spacing', state.para+'px');
        document.documentElement.style.setProperty('--reader-page-padding', state.pad+'px');
        document.documentElement.style.setProperty('--reader-width', state.width+'px');
        document.documentElement.style.setProperty('--reader-height', state.height>0? state.height+'px':'auto');
        document.body.classList.toggle('reader-paged', state.mode==='paged');
        document.body.classList.toggle('reader-align-justify', state.align==='justify');
        document.documentElement.style.setProperty('--reader-columns', state.cols);
        var content = document.getElementById('reader-content');
        if(content){
            if(state.mode==='scroll'){
                content.style.columnCount = state.cols>1? state.cols:1;
                content.style.columnGap = state.cols>1? '48px':'0';
            }else{
                content.style.columnCount = 1; content.style.columnGap='0';
            }
        }
        // 主题
        document.body.classList.remove('reader-theme-light','reader-theme-dark');
    if(state.theme==='light') { document.body.classList.add('reader-theme-light'); }
    else if(state.theme==='dark') { document.body.classList.add('reader-theme-dark'); }
        // 激活按钮样式
        Array.from(modeGroup.querySelectorAll('.rs-toggle')).forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-mode')===state.mode); });
    if(alignGroup) { Array.from(alignGroup.querySelectorAll('.rs-toggle')).forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-align')===state.align); }); }
    if(colsGroup) { Array.from(colsGroup.querySelectorAll('.rs-toggle')).forEach(function(b){ b.classList.toggle('active', Number(b.getAttribute('data-cols'))===state.cols); }); }
        Array.from(themeGroup.querySelectorAll('.rs-toggle')).forEach(function(b){ b.classList.toggle('active', b.getAttribute('data-theme')===state.theme); });
        saveState(state);
        rebuildIndexNow();
        updatePaging();
    }

    ['font','line','para','pad'].forEach(function(k){
        inputs[k].addEventListener('input', function(){ state[k] = k==='line'? parseFloat(this.value): parseInt(this.value,10); reflect(); });
    });
    inputs.width.addEventListener('change', function(){ var v=parseInt(this.value,10); if(!isNaN(v)){ state.width=v; reflect(); }});
    inputs.height.addEventListener('change', function(){ var v=parseInt(this.value,10); state.height = !isNaN(v)&&v>0? v:0; reflect(); });
    inputs.pageHeight.addEventListener('change', function(){ var v=parseInt(this.value,10); state.pageHeight = !isNaN(v)&&v>0? v:0; reflect(); });
    modeGroup.addEventListener('click', function(e){ var m=e.target && e.target.getAttribute('data-mode'); if(m){ state.mode=m; reflect(); }});
    alignGroup && alignGroup.addEventListener('click', function(e){ var a=e.target && e.target.getAttribute('data-align'); if(a){ state.align=a; reflect(); }});
    colsGroup && colsGroup.addEventListener('click', function(e){ var c=e.target && e.target.getAttribute('data-cols'); if(c){ state.cols=parseInt(c,10)||1; reflect(); }});
    themeGroup.addEventListener('click', function(e){ var t=e.target && e.target.getAttribute('data-theme'); if(t){ state.theme=t; reflect(); }});
    btnReset.addEventListener('click', function(){ state={ font:16,line:1.6,para:8,pad:12,width:720,height:0,pageHeight:0,mode:'scroll',theme:'auto',align:'left',cols:1}; reflect(); });
    gear.addEventListener('click', function(){ panel.classList.add('open'); });
    btnClose.addEventListener('click', function(){ panel.classList.remove('open'); });
    document.addEventListener('keydown', function(e){ if(e.key==='Escape' && panel.classList.contains('open')){ panel.classList.remove('open'); }});

    reflect();
    function refreshPresetOptions(){ if(!presetSelect) { return; } presetSelect.innerHTML=''; var keys=Object.keys(presets); if(!keys.length){ var opt=document.createElement('option'); opt.value=''; opt.textContent='(无)'; presetSelect.appendChild(opt); return; } keys.forEach(function(k){ var op=document.createElement('option'); op.value=k; op.textContent=k; presetSelect.appendChild(op); }); }
    refreshPresetOptions();
    if(btnSavePreset) {
        btnSavePreset.addEventListener('click', function(){
            var name=prompt('预设名称');
            if(!name) { return; }
            presets[name]=Object.assign({}, state);
            try{ localStorage.setItem(PRESET_KEY, JSON.stringify(presets)); }catch(_){ }
            refreshPresetOptions();
            if(presetSelect) { presetSelect.value=name; }
        });
    }
    if(btnDelPreset) {
        btnDelPreset.addEventListener('click', function(){
            var name=presetSelect && presetSelect.value;
            if(!name || !presets[name]) { return; }
            if(!confirm('删除预设: '+name+'?')) { return; }
            delete presets[name];
            try{ localStorage.setItem(PRESET_KEY, JSON.stringify(presets)); }catch(_){ }
            refreshPresetOptions();
        });
    }
    if(presetSelect) {
        presetSelect.addEventListener('change', function(){
            var name=this.value;
            if(!name || !presets[name]) { return; }
            state=Object.assign({}, presets[name]);
            reflect();
        });
    }
    /* ---- 分页计算 ---- */
    function updatePaging(){
    if(!pageBar || !pageInfo) { return; } 
        if(state.mode!=='paged') { pageBar.hidden = true; return; }
        pageBar.hidden = false;
    var h = state.pageHeight>0? state.pageHeight : (window.innerHeight - 40);
        var total = Math.max(1, Math.ceil(document.documentElement.scrollHeight / h));
        var current = Math.min(total, Math.max(1, Math.floor(window.scrollY / h) + 1));
        pageInfo.textContent = current + ' / ' + total;
    }
    window.addEventListener('scroll', throttle(updatePaging, 100));
    window.addEventListener('resize', throttle(updatePaging, 200));
    btnPrev && btnPrev.addEventListener('click', function(){ jumpPage(-1); });
    btnNext && btnNext.addEventListener('click', function(){ jumpPage(1); });
    function jumpPage(delta){ if(state.mode!=='paged') { return; } var h= state.pageHeight>0? state.pageHeight : (window.innerHeight - 40); window.scrollTo({ top: Math.max(0, window.scrollY + delta * h), behavior:'auto'}); updatePaging(); }
    document.addEventListener('keydown', function(e){
        if(state.mode==='paged'){
            if(['PageDown','ArrowRight',' '].includes(e.key)){ e.preventDefault(); jumpPage(1); }
            else if(['PageUp','ArrowLeft'].includes(e.key)){ e.preventDefault(); jumpPage(-1); }
        }
    });
})();

/* ================== TTS 自动翻页（分页模式） ================== */
(function enableTTSAutoPage(){
    var origLocate = locateAndHighlight;
    locateAndHighlight = function(startIdx, len, isSel){
        origLocate(startIdx, len, isSel);
        try {
            var bodyPaged = document.body.classList.contains('reader-paged');
            if(!bodyPaged) { return; }
            var h = (function(){
                try{ var st = JSON.parse(localStorage.getItem('anhReaderSettings')||'{}'); return st.pageHeight>0? st.pageHeight : (window.innerHeight - 40); }catch(_){ return window.innerHeight - 40; }
            })();
            if(!currentHighlightEl) { return; }
            var r = currentHighlightEl.getBoundingClientRect();
            var y = window.scrollY;
            var topVisible = y;
            var pageIndex = Math.floor(topVisible / h);
            var highlightPage = Math.floor((r.top + y - 10) / h); // 给一点上方缓冲
            if(highlightPage > pageIndex){
                window.scrollTo({ top: highlightPage * h, behavior:'smooth' });
            }
        } catch(_){}
    };
})();

/* ================== 多列滚动定位优化 ================== */
(function fixColumnScroll(){
    var origScrollToLine = scrollToLine;
    scrollToLine = function(line, smooth, scrollRatio, totalLines){
        var content = document.getElementById('reader-content');
        if(content && getComputedStyle(content).columnCount !== '1'){
            // 在多列模式中，浏览器仍使用垂直滚动，因此直接调用原逻辑即可；若未来使用水平分页，可在此添加特殊逻辑。
        }
        return origScrollToLine(line, smooth, scrollRatio, totalLines);
    };
})();
