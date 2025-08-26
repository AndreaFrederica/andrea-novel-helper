// media/preview.js
'use strict';

//TODO 分页模式预览的动态刷新有问题

/* ================== 调试配置 ================== */
var DEBUG_TTS = true;           // 控制是否在 Webview 控制台输出日志
var DEBUG_POST_TO_EXT = false;  // 如需把日志发回扩展侧，设为 true
var PAGE_HEIGHT_RATIO = 0.7;    // 分页模式下页面高度相对于窗口高度的比例
// 本地字体缓存与扩展下发字体
var vscodeFontFamily = '';
var localFontFamilies = [];



function dlog(tag, payload) {
    if (!DEBUG_TTS) { return; }
    try { console.log('[TTS]', tag, payload); } catch { }
    if (DEBUG_POST_TO_EXT && typeof acquireVsCodeApi === 'function') {
        try { vscode && vscode.postMessage({ type: 'debug', payload: { tag: tag, data: payload } }); } catch { }
    }
}

/* ================== VS Code API & 错误上报 ================== */
var vscode = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : null;

// [PREVIEW_PERSIST:B1] persist state across reload
let persisted = vscode.getState() || {}; // { docUri, isPrimary, scrollRatio, topLine }
// [/PREVIEW_PERSIST:B1]


window.addEventListener('error', function (e) {
    try { vscode && vscode.postMessage({ type: 'jsError', message: String(e.message || 'Unknown'), line: e.lineno, col: e.colno }); } catch { }
});
window.addEventListener('unhandledrejection', function (e) {
    try { vscode && vscode.postMessage({ type: 'jsError', message: 'UnhandledRejection: ' + String((e && e.reason) || '') }); } catch { }
});

/* ================== 工具：节流（修复处：保持独立函数体，避免被后续代码插入） ================== */
function throttle(fn, ms) {
    var t = null, last = 0;
    ms = typeof ms === 'number' ? ms : 100;
    return function () {
        var now = Date.now();
        var remain = ms - (now - last);
        var ctx = this, args = arguments;
        if (remain <= 0) {
            if (t) { clearTimeout(t); t = null; }
            last = now;
            return fn.apply(ctx, args);
        }
        if (!t) {
            t = setTimeout(function () {
                last = Date.now();
                t = null;
                fn.apply(ctx, args);
            }, remain);
        }
    };
}

/* ================== 滚动索引 / 同步 ================== */
var index = []; // [{line, top}]
function rebuildIndexNow() {
    index = [];
    var nodes = document.querySelectorAll('[data-line]');
    nodes.forEach(function (el) {
        if (el.offsetParent === null) { return; } // 跳过隐藏（在另一模式下）
        var line = Number(el.getAttribute('data-line'));
        var rect = el.getBoundingClientRect();
        var top = rect.top + window.scrollY;
        index.push({ line: line, top: top });
    });
    index.sort(function (a, b) { return a.top - b.top; });
}
var rebuildIndex = throttle(rebuildIndexNow, 100);

function getVisibleLineRange() {
    if (!index.length) { return { topLine: 0, bottomLine: 0 }; }
    var yTop = window.scrollY;
    var yBot = yTop + window.innerHeight;

    function findByY(y) {
        var lo = 0, hi = index.length - 1, ans = 0;
        while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            if (index[mid].top <= y) { ans = mid; lo = mid + 1; }
            else { hi = mid - 1; }
        }
        return ans;
    }

    var iTop = findByY(yTop);
    var iBot = findByY(yBot);
    var topLine = index[Math.max(0, Math.min(iTop, index.length - 1))].line;
    var bottomLine = index[Math.max(0, Math.min(iBot, index.length - 1))].line;
    if (bottomLine < topLine) { bottomLine = topLine; }
    return { topLine: topLine, bottomLine: bottomLine };
}


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

    var locales = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'und'];
    var seg = [];
    try {
        var segWord = new Intl.Segmenter(locales, { granularity: 'word' });
        var it = segWord.segment(text);
        for (var s of it) {
            seg.push({ start: s.index, end: s.index + s.segment.length, text: s.segment, isWordLike: !!s.isWordLike });
        }
    } catch (_) {
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
    if (!segList) { segList = buildSegmentsFallback(text); }
    dlog('seg.build', { count: segList.length, head: segList.slice(0, 30).map(function (s) { return [s.start, s.end, s.text]; }) });
}

/* ================== 高亮映射（utterText → DOM） ================== */
function refreshReadingNodesAndLog(isSelection) {
    refreshReadingNodes(isSelection);
    if (DEBUG_TTS) {
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

    var lo = 0, hi = readingNodes.length - 1, pos = readingNodes.length;
    while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        var seg = readingNodes[mid];
        if (startIdx < seg.start) { pos = mid; hi = mid - 1; }
        else if (startIdx >= seg.end) { lo = mid + 1; }
        else { pos = mid; break; }
    }

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
        var isPaged = document.body.classList.contains('reader-paged');
        if (!isPaged) {
            if (rect.top < 0 || rect.bottom > window.innerHeight) {
                span.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
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

    if (selectionRaw && selectionRaw.trim().length > 0) {
        var sel = window.getSelection();
        selectionRangeCache = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null;
    } else {
        selectionRangeCache = null;
    }

    clearTTSHighlight();

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

    currentUtterance.onboundary = function (ev) {
        var base = (typeof ev.charIndex === 'number') ? ev.charIndex : 0;

        var seg = findSegmentAtIndex(segList, base);
        var s = seg ? seg.start : base;
        var e = seg ? seg.end : (base + 1);
        var len = Math.max(1, e - s);

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
    window.addEventListener('beforeunload', function () { try { stopTTS(); } catch { } });
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
        var reserve = Math.round(rect.height + 20);
        var cur = parseInt(window.getComputedStyle(document.body).paddingTop, 10) || 0;
        if (reserve > cur) {
            document.body.style.paddingTop = reserve + 'px';
            if (typeof rebuildIndexNow === 'function') { rebuildIndexNow(); }
        }
    } catch (e) { dlog('adjustForTTSControls.error', String(e)); }
}
window.addEventListener('load', adjustForTTSControls);
window.addEventListener('resize', throttle(adjustForTTSControls, 200));

/* ================== Reader 设置面板与状态（保持自包含作用域） ================== */
(function initReaderSettings() {
    var gear = document.getElementById('reader-gear');
    var panel = document.getElementById('reader-settings');
    if (!gear || !panel) { return; }

    var inputs = {
        font: document.getElementById('rs-font'),
        line: document.getElementById('rs-line'),
        para: document.getElementById('rs-para'),
        pad: document.getElementById('rs-pad'),
        width: document.getElementById('rs-width'),
        height: document.getElementById('rs-height'),
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
    var syncGroup = document.getElementById('rs-sync');
    var themeGroup = document.getElementById('rs-themes');
    var heightModeGroup = document.getElementById('rs-heightMode');
    var widthModeGroup = document.getElementById('rs-widthMode');
    var fontModeGroup = document.getElementById('rs-fontMode');
    var fontFamilySelect = document.getElementById('rs-fontFamily');
    var btnReloadFonts = document.getElementById('rs-reloadFonts');
    var btnReset = document.getElementById('rs-reset');
    var presetSelect = document.getElementById('rs-preset');
    var btnSavePreset = document.getElementById('rs-savePreset');
    var btnDelPreset = document.getElementById('rs-delPreset');
    var btnNewPreset = document.getElementById('rs-newPreset');
    var btnClose = document.getElementById('rs-close');
    var pageBar = document.getElementById('reader-pagebar');
    var pageInfo = document.getElementById('rp-info');
    var pageProgress = document.getElementById('rp-progress');
    var btnPrev = document.getElementById('rp-prev');
    var btnNext = document.getElementById('rp-next');

    var STORE_KEY = 'anhReaderSettings';
    var PRESET_KEY = 'anhReaderPresets';

    function loadState() {
        try { var s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); return (s && typeof s === 'object') ? s : {}; } catch (_) { return {}; }
    }
    function saveStateMeta(m) { try { localStorage.setItem(STORE_KEY, JSON.stringify(m)); } catch (_) { } }

    var DEFAULTS = {
        font: 16,
        line: 1.6,
        para: 8,
        pad: 12,
        fontFamilyMode: 'auto',
        fontFamily: '',
        width: 720,
        widthMode: 'manual',
        height: 0,
        heightMode: 'auto',
        mode: 'scroll',
        theme: 'auto',
        align: 'left',
        cols: 1,
        sync: 'on'
    };
    var PRESET_TEMPLATES = { '__default__': { name: '默认', data: JSON.parse(JSON.stringify(DEFAULTS)) } };

    function loadPresets() {
        try {
            var p = JSON.parse(localStorage.getItem(PRESET_KEY) || '{}');
            if (p && typeof p === 'object' && !Array.isArray(p)) { return p; }
            return {};
        } catch (_) { return {}; }
    }
    function savePresets(p) { try { localStorage.setItem(PRESET_KEY, JSON.stringify(p)); } catch (_) { } }

    var meta = loadState();
    var presets = loadPresets();
    var activePresetName = (meta && meta.lastPreset) ? meta.lastPreset : '__default__';
    if (!presets[activePresetName]) {
        if (PRESET_TEMPLATES['__default__']) { presets[activePresetName] = JSON.parse(JSON.stringify(PRESET_TEMPLATES['__default__'].data)); }
        else { presets[activePresetName] = Object.assign({}, DEFAULTS); }
        savePresets(presets);
    }
    var state = presets[activePresetName];

    /* ---- 分页计算（声明在上，供 reflect 调用） ---- */
    function updatePaging() {
        if (!pageBar || !pageInfo) { return; }
        if (state.mode !== 'paged') { pageBar.hidden = true; return; }
        pageBar.hidden = false;

        if (typeof DomPager !== 'undefined' && DomPager.isActive() && DomPager.totalPages() > 0) {
            var cur = DomPager.currentPage() + 1; var total = DomPager.totalPages();
            pageInfo.textContent = cur + ' / ' + total;
            if (pageProgress) { pageProgress.style.width = (total > 0 ? (cur / total * 100) : 0) + '%'; }
        } else {
            var h;
            // 如果用户选择手动高度并且值有效，则采用用户指定的高度
            if (state.heightMode === 'manual' && state.height > 0) {
                h = state.height;
            } else {
                // 自动模式：减去固定的 40px 用于控件/边距
                h = (window.innerHeight) - 40;
            }
            var total2 = Math.max(1, Math.ceil(document.documentElement.scrollHeight / h));
            var current2 = Math.min(total2, Math.max(1, Math.floor(window.scrollY / h) + 1));
            pageInfo.textContent = current2 + ' / ' + total2;
            if (pageProgress) { pageProgress.style.width = (total2 > 0 ? (current2 / total2 * 100) : 0) + '%'; }
        }
    }

    function reflect() {
        inputs.font.value = state.font; vals.font.textContent = state.font;
        inputs.line.value = state.line; vals.line.textContent = state.line.toFixed(2);
        inputs.para.value = state.para; vals.para.textContent = state.para;
        inputs.pad.value = state.pad; vals.pad.textContent = state.pad;
        inputs.width.value = state.width || '';
        inputs.height.value = state.height || '';
        document.documentElement.style.setProperty('--reader-font-size', state.font + 'px');
        document.documentElement.style.setProperty('--reader-line-height', state.line);
        document.documentElement.style.setProperty('--reader-para-spacing', state.para + 'px');
        document.documentElement.style.setProperty('--reader-page-padding', state.pad + 'px');
        // 计算并设置字体族：按“跟随 VS Code / 自定义”逻辑直接写入最终栈
        try {
            var autoFollow = (state.fontFamilyMode === 'auto');

            // VS Code 设置里拿到的值（可能为空或逗号分隔列表）
            var raw = String(vscodeFontFamily || '').trim();

            function platformEditorDefault() {
                var ua = navigator.userAgent || '';
                var isWin = /Windows/i.test(ua);
                var isMac = /Mac/i.test(ua);
                if (isWin) { return "'Consolas','Courier New',monospace"; }
                if (isMac) { return "Menlo,Monaco,'Courier New',monospace"; }
                // Linux：保留 Droid 回退更接近 VS Code
                return "'Droid Sans Mono','monospace','Droid Sans Fallback'";
            }

            var stack;
            if (autoFollow) {
                // 关键：raw 可能本身就是“逗号分隔列表”，不要整体加引号，直接用
                stack = raw ? raw : platformEditorDefault();
            } else {
                // 自定义模式
                stack = String(state.fontFamily || '').trim();
            }

            // 直接把最终栈写入 CSS 变量（不要再拼接 UI 栈）
            document.documentElement.style.setProperty('--reader-font-family', stack || '');
        } catch (_) { }
        if (state.width && Number(state.width) > 0) {
            document.documentElement.style.setProperty('--reader-width', state.width + 'px');
        } else {
            document.documentElement.style.setProperty('--reader-width', '100%');
        }
        document.documentElement.style.setProperty('--reader-height', state.height > 0 ? state.height + 'px' : 'auto');

        document.body.classList.toggle('reader-paged', state.mode === 'paged');

        try {
            var spacer = document.querySelector('.scroll-spacer');
            if (state.mode === 'paged') {
                if (spacer) {
                    spacer.style.display = 'none';
                    spacer.style.height = '0';
                    spacer.style.minHeight = '0';
                }
            } else {
                if (!spacer) {
                    try {
                        spacer = document.createElement('div');
                        spacer.className = 'scroll-spacer';
                        var root = document.querySelector('.reader-root');
                        var content = document.getElementById('reader-content');
                        if (root) {
                            // 优先把 spacer 放在 .reader-root 内、紧跟 #reader-content 之后（更稳定地影响内容高度）
                            if (content && content.parentNode === root) {
                                if (content.nextSibling) { root.insertBefore(spacer, content.nextSibling); }
                                else { root.appendChild(spacer); }
                            } else {
                                console.error('spacer插入错误：', root);
                            }
                        } else {
                            console.error('spacer插入错误：', root);
                        }
                    } catch (_) { spacer = null; }
                }
                if (spacer) {
                    try {
                        spacer.removeAttribute('style');
                    } catch (_) {
                        spacer.style.display = '';
                        spacer.style.height = '';
                        spacer.style.minHeight = '';
                    }
                }
            }
        } catch (_) { }

        document.body.classList.toggle('reader-align-justify', state.align === 'justify');
        document.documentElement.style.setProperty('--reader-columns', state.cols);

        var content = document.getElementById('reader-content');
        if (content) {
            if (state.mode === 'scroll') {
                content.style.columnCount = state.cols > 1 ? state.cols : 1;
                content.style.columnGap = state.cols > 1 ? '48px' : '0';
            } else {
                content.style.columnCount = 1; content.style.columnGap = '0';
            }
        }

        document.body.classList.remove('reader-theme-light', 'reader-theme-dark');
        if (state.theme === 'light') { document.body.classList.add('reader-theme-light'); }
        else if (state.theme === 'dark') { document.body.classList.add('reader-theme-dark'); }

        Array.from(modeGroup.querySelectorAll('.rs-toggle')).forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-mode') === state.mode); });
        if (alignGroup) { Array.from(alignGroup.querySelectorAll('.rs-toggle')).forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-align') === state.align); }); }
        if (colsGroup) { Array.from(colsGroup.querySelectorAll('.rs-toggle')).forEach(function (b) { b.classList.toggle('active', Number(b.getAttribute('data-cols')) === state.cols); }); }
        Array.from(themeGroup.querySelectorAll('.rs-toggle')).forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-theme') === state.theme); });
        if (syncGroup) { Array.from(syncGroup.querySelectorAll('.rs-toggle')).forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-sync') === state.sync); }); }
        if (heightModeGroup) { Array.from(heightModeGroup.querySelectorAll('.rs-toggle')).forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-hmode') === state.heightMode); }); }
        // 字体模式/下拉同步
        try {
            if (typeof fontModeGroup !== 'undefined' && fontModeGroup) {
                Array.from(fontModeGroup.querySelectorAll('.rs-toggle')).forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-fmode') === state.fontFamilyMode); });
            }
            if (typeof fontFamilySelect !== 'undefined' && fontFamilySelect) {
                fontFamilySelect.disabled = (state.fontFamilyMode !== 'custom');
                if (state.fontFamilyMode === 'custom' && state.fontFamily) { fontFamilySelect.value = state.fontFamily; }
            }
        } catch (_) { }
        Array.from(widthModeGroup.querySelectorAll('.rs-toggle')).forEach(function (b) {
            b.classList.toggle('active', b.getAttribute('data-wmode') === state.widthMode);
        });
        try { presets[activePresetName] = JSON.parse(JSON.stringify(state)); } catch (_) { presets[activePresetName] = Object.assign({}, state); }
        savePresets(presets);
        try { meta.lastPreset = activePresetName; saveStateMeta(meta); } catch (_) { }

        rebuildIndexNow();

        if (typeof DomPager !== 'undefined') {
            if (state.mode === 'paged') { DomPager.enable({ pageHeight: (state.heightMode === 'manual' && state.height > 0) ? state.height : 0 }); }
            else { DomPager.disable(); }
        }
        updatePaging();
    }

    ['font', 'line', 'para', 'pad'].forEach(function (k) {
        if (inputs[k]) {
            inputs[k].addEventListener('input', function () { state[k] = k === 'line' ? parseFloat(this.value) : parseInt(this.value, 10); reflect(); });
        }
    });
    if (inputs.width) { inputs.width.addEventListener('change', function () { var v = parseInt(this.value, 10); state.width = (!isNaN(v) && v > 0) ? v : 0; reflect(); }); }
    if (inputs.height) { inputs.height.addEventListener('change', function () { var v = parseInt(this.value, 10); state.height = (!isNaN(v) && v > 0) ? v : 0; reflect(); }); }

    if (modeGroup) { modeGroup.addEventListener('click', function (e) { var m = e.target && e.target.getAttribute('data-mode'); if (m) { state.mode = m; reflect(); } }); }
    if (alignGroup) { alignGroup.addEventListener('click', function (e) { var a = e.target && e.target.getAttribute('data-align'); if (a) { state.align = a; reflect(); } }); }
    if (colsGroup) { colsGroup.addEventListener('click', function (e) { var c = e.target && e.target.getAttribute('data-cols'); if (c) { state.cols = parseInt(c, 10) || 1; reflect(); } }); }
    if (themeGroup) { themeGroup.addEventListener('click', function (e) { var t = e.target && e.target.getAttribute('data-theme'); if (t) { state.theme = t; reflect(); } }); }
    if (syncGroup) { syncGroup.addEventListener('click', function (e) { var s = e.target && e.target.getAttribute('data-sync'); if (s) { state.sync = s; reflect(); } }); }
    if (heightModeGroup) { heightModeGroup.addEventListener('click', function (e) { var m = e.target && e.target.getAttribute('data-hmode'); if (m) { state.heightMode = m; reflect(); } }); }
    if (widthModeGroup) {
        widthModeGroup.addEventListener('click', function (e) {
            var m = e.target && e.target.getAttribute('data-wmode');
            if (!m) { return; }
            state.widthMode = m;   // 'auto' 或 'manual'
            reflect();
        });
    }

    // 字体枚举与下拉填充（使用 Local Font Access API，如果不可用则静默失败）
    var localFontFamilies = [];
    function populateFontSelect() {
        try {
            if (!fontFamilySelect) { return; }
            fontFamilySelect.innerHTML = '';
            if (!localFontFamilies || !localFontFamilies.length) {
                var opt = document.createElement('option'); opt.value = ''; opt.textContent = '(无可用系统字体)'; fontFamilySelect.appendChild(opt); return;
            }
            var blank = document.createElement('option'); blank.value = ''; blank.textContent = '(默认)'; fontFamilySelect.appendChild(blank);
            localFontFamilies.forEach(function (f) { var op = document.createElement('option'); op.value = f; op.textContent = f; fontFamilySelect.appendChild(op); });
            // 尝试恢复状态中保存的值
            try { if (state.fontFamilyMode === 'custom' && state.fontFamily) { fontFamilySelect.value = state.fontFamily; } } catch (_) { }
        } catch (_) { }
    }

    async function loadLocalFonts(force) {
        // 先走扩展
        if (vscode) {
            vscode.postMessage({ type: 'requestFonts', force: !!force });
            return; // 等 message 回来填充
        }

        // 没有扩展 API 才尝试 queryLocalFonts（非 webview 才可能放行）
        if (!('queryLocalFonts' in window)) { localFontFamilies = []; populateFontSelect(); return; }
        try {
            const faces = await window.queryLocalFonts();
            const fams = Array.from(new Set(faces.map(f => (f.family || '').trim()).filter(Boolean))).sort();
            localFontFamilies = fams; populateFontSelect();
        } catch (e) {
            // 在 webview 下这里大概率是 SecurityError：权限策略禁止
            localFontFamilies = []; populateFontSelect();
        }
    }

    // 接收扩展的字体列表
    window.addEventListener('message', (ev) => {
        const msg = ev.data;
        if (msg?.type === 'fontFamilies') {
            localFontFamilies = Array.isArray(msg.list) ? msg.list : [];
            populateFontSelect();
        } else if (msg?.type === 'vscodeFontFamily') {
            vscodeFontFamily = String(msg.value || '').trim();
            if (typeof reflect === 'function') { reflect(); }
        }
        // [PREVIEW_PERSIST:B2] message handlers for persistence
        if (msg?.type === 'init') {
            // 扩展端告知当前绑定的文档以及是否为主面板
            persisted = { ...persisted, docUri: msg.docUri, isPrimary: !!msg.isPrimary };
            vscode.setState(persisted);
        }

        if (msg?.type === 'editorScroll') {
            // 你原有的渲染/同步逻辑...

            // 顺手把滚动位置快照下来
            persisted = {
                ...persisted,
                scrollRatio: (typeof msg.ratio === 'number') ? msg.ratio : persisted.scrollRatio,
                topLine: Number.isInteger(msg.topLine) ? msg.topLine : persisted.topLine
            };
            vscode.setState(persisted);
        }

        if (msg?.type === 'restoreScroll') {
            // 扩展端在反序列化后请求恢复滚动位置（任选一种策略）
            if (Number.isInteger(msg.topLine)) {
                // 需要你已有的滚动函数；没有可自行实现
                if (typeof scrollToLine === 'function') { scrollToLine(msg.topLine); }
            } else if (typeof msg.ratio === 'number') {
                if (typeof scrollToRatio === 'function') { scrollToRatio(msg.ratio); }
            }
        }
        // [/PREVIEW_PERSIST:B2]

    });


    // 绑定字体控件事件
    if (fontModeGroup) {
        fontModeGroup.addEventListener('click', function (e) {
            var fm = e.target && e.target.getAttribute('data-fmode');
            if (!fm) { return; }
            state.fontFamilyMode = fm; reflect();
        });
    }
    if (fontFamilySelect) {
        fontFamilySelect.addEventListener('change', function () { state.fontFamily = this.value || ''; reflect(); });
    }
    if (btnReloadFonts) { btnReloadFonts.addEventListener('click', function () { loadLocalFonts(true); }); }

    // 首次尝试填充字体（异步）
    loadLocalFonts(false).catch(function () { });
    // 启动时主动请求扩展下发 editor.fontFamily，便于“跟随 VS Code”立即生效
    try {
        if (vscode && typeof vscode.postMessage === 'function') {
            try { vscode.postMessage({ type: 'requestVscodeFontFamily' }); } catch (_) { }
        }
    } catch (_) { }
    if (btnReset) { btnReset.addEventListener('click', function () { state = JSON.parse(JSON.stringify(DEFAULTS)); try { presets[activePresetName] = JSON.parse(JSON.stringify(state)); savePresets(presets); } catch (_) { } reflect(); }); }
    if (gear) { gear.addEventListener('click', function () { panel.classList.add('open'); }); }
    if (btnClose) { btnClose.addEventListener('click', function () { panel.classList.remove('open'); }); }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && panel.classList.contains('open')) { panel.classList.remove('open'); } });

    function refreshPresetOptions() {
        if (!presetSelect) { return; }
        presetSelect.innerHTML = '';
        var keys = Object.keys(presets);
        if (!keys.length) { var opt = document.createElement('option'); opt.value = ''; opt.textContent = '(无)'; presetSelect.appendChild(opt); return; }
        keys.forEach(function (k) { var op = document.createElement('option'); op.value = k; op.textContent = k; presetSelect.appendChild(op); });
        try { if (activePresetName && presets[activePresetName]) { presetSelect.value = activePresetName; } } catch (_) { }
    }

    refreshPresetOptions();

    if (btnSavePreset) {
        btnSavePreset.addEventListener('click', function () {
            try {
                if (activePresetName && presets[activePresetName]) {
                    presets[activePresetName] = JSON.parse(JSON.stringify(state));
                    savePresets(presets);
                    refreshPresetOptions();
                    if (presetSelect) { presetSelect.value = activePresetName; }
                    return;
                }
            } catch (_) { }
            showPrompt('预设名称（留空取消）', activePresetName || '').then(function (name) {
                name = (name || '').trim();
                if (!name) { return; }
                try {
                    if (name === activePresetName) {
                        presets[name] = JSON.parse(JSON.stringify(state));
                    } else {
                        if (presets[name]) {
                            showConfirm('目标预设已存在，是否覆盖？').then(function (ok) {
                                if (!ok) { return; }
                                presets[name] = JSON.parse(JSON.stringify(state));
                                if (activePresetName && presets[activePresetName] && activePresetName !== name) {
                                    try { delete presets[activePresetName]; } catch (_) { }
                                }
                                activePresetName = name;
                                try { meta.lastPreset = activePresetName; saveStateMeta(meta); } catch (_) { }
                                savePresets(presets);
                                refreshPresetOptions();
                                if (presetSelect) { presetSelect.value = name; }
                            });
                            return;
                        }
                        presets[name] = JSON.parse(JSON.stringify(state));
                        if (activePresetName && presets[activePresetName] && activePresetName !== name) {
                            try { delete presets[activePresetName]; } catch (_) { }
                        }
                        activePresetName = name;
                        try { meta.lastPreset = activePresetName; saveStateMeta(meta); } catch (_) { }
                    }
                    savePresets(presets);
                } catch (_) { presets = presets || {}; }
                refreshPresetOptions();
                if (presetSelect) { presetSelect.value = name; }
            });
        });
    }
    if (btnNewPreset) {
        btnNewPreset.addEventListener('click', function () {
            showPrompt('新建预设名称（唯一）', '').then(function (name) {
                name = (name || '').trim();
                if (!name) { return; }

                function finalizeCreate() {
                    try { presets[name] = JSON.parse(JSON.stringify(state)); }
                    catch (_) { presets[name] = Object.assign({}, state); }
                    activePresetName = name;
                    try { meta.lastPreset = activePresetName; saveStateMeta(meta); } catch (_) { }
                    savePresets(presets);
                    refreshPresetOptions();
                    if (presetSelect) { presetSelect.value = name; }
                    reflect();
                }

                if (presets[name]) {
                    showConfirm('预设已存在：' + name + '，是否覆盖？').then(function (ok) {
                        if (ok) { finalizeCreate(); }
                    });
                } else {
                    finalizeCreate();
                }
            });
        });
    }

    if (btnDelPreset) {
        btnDelPreset.addEventListener('click', function () {
            var name = presetSelect && presetSelect.value;
            if (!name || !presets[name]) { return; }
            showConfirm('删除预设: ' + name + '?').then(function (ok) {
                if (!ok) { return; }
                delete presets[name];
                try { savePresets(presets); } catch (_) { }
                refreshPresetOptions();
                if (name === activePresetName) {
                    var keys = Object.keys(presets);
                    if (keys.length > 0) { activePresetName = keys[0]; state = presets[activePresetName]; }
                    else {
                        activePresetName = '__default__';
                        presets[activePresetName] = JSON.parse(JSON.stringify(PRESET_TEMPLATES['__default__'].data));
                        state = presets[activePresetName];
                        savePresets(presets);
                    }
                    meta.lastPreset = activePresetName; saveStateMeta(meta);
                    if (presetSelect) { presetSelect.value = activePresetName; }
                    reflect();
                }
            });
        });
    }

    if (presetSelect) {
        presetSelect.addEventListener('change', function () {
            var name = this.value;
            if (!name || !presets[name]) { return; }
            try { activePresetName = name; state = presets[activePresetName]; meta.lastPreset = activePresetName; saveStateMeta(meta); }
            catch (_) { activePresetName = '__default__'; state = presets[activePresetName]; }
            reflect();
        });
    }

    window.addEventListener('scroll', throttle(updatePaging, 100));
    window.addEventListener('resize', throttle(function () { if (typeof reflect._rebuildPages === 'function') { reflect._rebuildPages(); } updatePaging(); }, 250));

    if (btnPrev) { btnPrev.addEventListener('click', function () { jumpPage(-1); }); }
    if (btnNext) { btnNext.addEventListener('click', function () { jumpPage(1); }); }

    function jumpPage(delta) {
        if (state.mode !== 'paged') { return; }
        if (typeof DomPager !== 'undefined' && DomPager.isActive()) {
            if (delta > 0) { DomPager.next(); } else { DomPager.prev(); }
            updatePaging();
        } else {
            var h = (state.heightMode === 'manual' && state.height > 0) ? state.height : (window.innerHeight - 40);
            window.scrollTo({ top: Math.max(0, window.scrollY + delta * h), behavior: 'auto' });
            updatePaging();
        }
    }

    document.addEventListener('keydown', function (e) {
        if (state.mode === 'paged') {
            if (['PageDown', 'ArrowRight', ' '].includes(e.key)) { e.preventDefault(); jumpPage(1); }
            else if (['PageUp', 'ArrowLeft'].includes(e.key)) { e.preventDefault(); jumpPage(-1); }
        }
    });

    /* ---- 段落级分页：构建页面边界（不修改 DOM，只记录滚动位置） ---- */
    var pagesBoundaries = []; // [{top:number, firstEl:Element}]
    function flattenDOM(root) {
        var out = []; if (!root) { return out; }
        root.childNodes.forEach(function (ch) {
            if (ch.nodeType === Node.ELEMENT_NODE) {
                out.push(ch); out = out.concat(flattenDOM(ch));
            }
        });
        return out;
    }
    function rebuildPagesBoundaries() {
        pagesBoundaries = [];
        if (state.mode !== 'paged') { return; }
        var content = document.getElementById('reader-content');
        if (!content) { return; }
        var maxH = (state.heightMode === 'manual' && state.height > 0) ? state.height : (window.innerHeight - 40);
        if (maxH <= 120) { return; }
        var els = flattenDOM(content).filter(function (el) { return el.tagName === 'PRE' || el.hasAttribute('data-line'); });
        var curStartEl = null, curAccum = 0;
        els.forEach(function (el) {
            var h = el.offsetHeight; if (h <= 0) { return; }
            if (!curStartEl) { curStartEl = el; }
            if (curAccum + h > maxH && curAccum > 0) {
                var top = curStartEl.getBoundingClientRect().top + window.scrollY;
                pagesBoundaries.push({ top: top, firstEl: curStartEl });
                curStartEl = el; curAccum = h;
            } else {
                curAccum += h;
            }
        });
        if (curStartEl) {
            var top2 = curStartEl.getBoundingClientRect().top + window.scrollY;
            pagesBoundaries.push({ top: top2, firstEl: curStartEl });
        }
        pagesBoundaries.sort(function (a, b) { return a.top - b.top; });
    }
    window.__anhPages = function () { return pagesBoundaries.slice(); };
    rebuildPagesBoundaries();
    reflect._rebuildPages = rebuildPagesBoundaries;

    /* ================== DOM 实际分页器 (page.js 风格) ================== */
    var DomPager = (function () {
        var active = false;
        var pages = [];
        var current = 0;
        var container = null;
        var originalHTML = '';
        var pageStarts = [];   // 每页第一个 data-line 的行号（单调）
        var cfg = { pageHeight: 0 };

        function pagerAutoHeight() {
            var base = window.innerHeight;
            var reserve = 40; // 原来的固定余量

            try {
                // 顶部：adjustForTTSControls() 已经把 TTS 高度加到 body.paddingTop
                reserve += parseInt(getComputedStyle(document.body).paddingTop, 10) || 0;

                // 底部：分页条（显示时再扣）
                var bar = document.getElementById('reader-pagebar');
                if (bar && !bar.hidden) {
                    var r = bar.getBoundingClientRect();
                    reserve += Math.ceil(r.height + 12); // 再留点间距
                }
            } catch (_) { }

            return (Math.max(120, Math.round(base - reserve)) * PAGE_HEIGHT_RATIO);
        }

        function measureAndGroup() {
            var els = Array.from(container.children).filter(function (el) { return el.offsetHeight > 0; });
            var maxH = cfg.pageHeight > 0 ? cfg.pageHeight : pagerAutoHeight();
            if (maxH < 120) { maxH = pagerAutoHeight(); }
            var groups = []; var cur = []; var hSum = 0;
            els.forEach(function (el) {
                var h = el.offsetHeight;
                if (hSum + h > maxH && cur.length > 0) { groups.push(cur); cur = [el]; hSum = h; }
                else { cur.push(el); hSum += h; }
            });
            if (cur.length) { groups.push(cur); }
            return groups;
        }

        // ✅ 从当前 pages 扁平化出最新 HTML，避免重建时“丢改动”
        function captureFlatHTML() {
            if (!active) { return ''; }
            if (pages && pages.length) {
                return pages.map(function (p) { return p.innerHTML; }).join('');
            }
            // 安全兜底：若 pages 还没建立，用容器现状
            return container ? container.innerHTML : '';
        }

        // ✅ 取一个“可视锚点”的源代码行号，用于 rebuild 后定位原页
        function currentAnchorLine() {
            try {
                if (window.__anhVisibleRange) {
                    var vr = window.__anhVisibleRange();
                    if (vr && Number.isInteger(vr.top) && Number.isInteger(vr.bottom)) {
                        return Math.round((vr.top + vr.bottom) / 2);
                    }
                }
                // 退化：用 index 的中点
                if (typeof getVisibleLineRange === 'function') {
                    var r = getVisibleLineRange();
                    return Math.round(((r.top || 0) + (r.bottom || 0)) / 2);
                }
            } catch (_) { }
            return null;
        }

        function buildPages() {
            container.innerHTML = originalHTML;
            pages = [];
            var groups = measureAndGroup();
            container.innerHTML = '';
            groups.forEach(function (group, idx) {
                var wrap = document.createElement('div');
                wrap.className = 'anh-page';
                wrap.setAttribute('data-page', String(idx));
                wrap.style.display = 'none';
                group.forEach(function (el) { wrap.appendChild(el.cloneNode(true)); });
                container.appendChild(wrap);
                pages.push(wrap);
            });
            current = Math.min(current, pages.length - 1);
            // 重新计算每页起始 data-line（用 clone 后的节点也OK）
            pageStarts = pages.map(function (p) {
                var first = p.querySelector('[data-line]');
                return first ? Number(first.getAttribute('data-line')) : Number.MAX_SAFE_INTEGER;
            });
            // 防御：保证严格递增
            for (var i = 1; i < pageStarts.length; i++) {
                if (!(pageStarts[i] > pageStarts[i - 1])) {
                    pageStarts[i] = pageStarts[i - 1] + 1;
                }
            }
        }

        function pageOfLine(line) {
            if (!active || !pageStarts.length) { return -1; }
            var lo = 0, hi = pageStarts.length - 1, ans = 0;
            while (lo <= hi) {
                var mid = (lo + hi) >> 1;
                if (pageStarts[mid] <= line) { ans = mid; lo = mid + 1; }
                else { hi = mid - 1; }
            }
            return ans;
        }

        function applyPage() {
            if (!active) { return; }
            pages.forEach(function (p, i) { p.style.display = (i === current) ? '' : 'none'; });
            window.scrollTo({ top: 0, behavior: 'auto' });
            if (typeof rebuildIndexNow === 'function') { rebuildIndexNow(); }
        }

        function enable(options) {
            cfg.pageHeight = (options && options.pageHeight) || 0;
            if (active) { rebuild(); return; }
            container = document.getElementById('reader-content');
            if (!container) { return; }
            originalHTML = container.innerHTML;
            active = true;
            rebuild();
        }
        function disable() {
            if (!active) { return; }
            if (container && originalHTML) { container.innerHTML = originalHTML; }
            active = false; pages = []; current = 0; originalHTML = '';
            if (typeof rebuildIndexNow === 'function') { rebuildIndexNow(); }
        }
        function rebuild() {
            if (!active) { return; }

            // ✅ (1) 记录当前锚点行号
            var anchor = currentAnchorLine();

            // ✅ (2) 用当前页内容回填 originalHTML，避免丢失增量
            try { originalHTML = captureFlatHTML(); } catch (_) { }

            // 重新分组建页
            buildPages();

            // ✅ (3) 带着锚点恢复到对应页（找不到则保持 current）
            if (anchor !== null && typeof pageOfLine === 'function') {
                var pg = pageOfLine(anchor);
                if (pg >= 0) { current = Math.min(Math.max(pg, 0), Math.max(0, pages.length - 1)); }
            } else {
                current = Math.min(current, Math.max(0, pages.length - 1));
            }

            applyPage();
        }
        function goto(i) { if (!active) { return; } if (i < 0 || i >= pages.length) { return; } current = i; applyPage(); }
        function next() { goto(current + 1); }
        function prev() { goto(current - 1); }
        function isActive() { return active; }
        function totalPages() { return pages.length; }
        function currentPage() { return current; }
        function pageOfElement(el) {
            while (el && el !== container) { if (el.classList && el.classList.contains('anh-page')) { return parseInt(el.getAttribute('data-page') || '0', 10); } el = el.parentElement; }
            return -1;
        }

        // === 新增：内部工具 ===
        function maxPageHeight() {
            var mh = cfg.pageHeight > 0 ? cfg.pageHeight : pagerAutoHeight();
            return (mh < 120) ? pagerAutoHeight() : mh;
        }
        function renumberPages() {
            for (var i = 0; i < pages.length; i++) {
                pages[i].setAttribute('data-page', String(i));
            }
        }
        function refreshPageStarts(from) {
            from = Math.max(0, from | 0);
            // 保险：全部重算（页面少，代价很小）
            pageStarts = pages.map(function (p) {
                var first = p.querySelector('[data-line]');
                return first ? Number(first.getAttribute('data-line')) : Number.MAX_SAFE_INTEGER;
            });
            for (var i = 1; i < pageStarts.length; i++) {
                if (!(pageStarts[i] > pageStarts[i - 1])) {
                    pageStarts[i] = pageStarts[i - 1] + 1;
                }
            }
        }

        /**
         * 用新 HTML 覆盖第 i 页的内容。
         * options.allowSplit=true 时，如果该页为最后一页且超高，会把溢出拆分成新页追加。
         * 返回值：
         *   { ok:true, split:false }              —— 正常替换
         *   { ok:false, reason:'overflow' }       —— 超出页高（非末页），建议全量 rebuild
         *   { ok:true, split:true, added:n }      —— 末页拆分并追加了 n 个新页
         */
        function updatePageHTML(i, html, options) {
            options = options || {};
            if (!active) { return { ok: false, reason: 'inactive' }; }
            if (i < 0 || i >= pages.length) { return { ok: false, reason: 'range' }; }

            var wrap = pages[i];
            var wasCurrent = (i === current);
            var maxH = maxPageHeight();

            // 覆盖页面内容
            var tpl = document.createElement('template');
            tpl.innerHTML = html || '';
            // 只引入有用块（防御）：[data-line] 或 <pre>
            var frag = document.createDocumentFragment();
            var kids = tpl.content.childNodes;
            for (var k = 0; k < kids.length; k++) {
                var node = kids[k];
                // 允许任何元素，但建议是预览结构；如需更严，可筛选 hasAttribute('data-line') || tagName==='PRE'
                frag.appendChild(node.cloneNode(true));
            }
            // 先清空再塞入
            wrap.innerHTML = '';
            wrap.appendChild(frag);

            // 高度检查
            if (wrap.offsetHeight <= maxH + 0.5) {
                refreshPageStarts(i);
                if (typeof rebuildIndexNow === 'function') { rebuildIndexNow(); }
                if (wasCurrent) { applyPage(); } // 保持当前页展示
                return { ok: true, split: false };
            }

            // 超出页高
            var isLast = (i === pages.length - 1);
            if (!isLast || !options.allowSplit) {
                return { ok: false, reason: 'overflow' };
            }

            // —— 末页允许拆分：把末尾节点往后搬，直到该页 <= maxH —— //
            var added = 0;
            var cur = wrap;
            while (cur.offsetHeight > maxH + 0.5) {
                var newWrap = document.createElement('div');
                newWrap.className = 'anh-page';
                newWrap.style.display = 'none';
                // 从当前页尾部往后搬节点，保证顺序
                var moved = [];
                var guard = 0;
                while (cur.lastChild && cur.offsetHeight > maxH + 0.5) {
                    moved.unshift(cur.lastChild);
                    cur.removeChild(cur.lastChild);
                    if (++guard > 5000) { break; } // 防御极端
                }
                // 若没有搬动（单个节点比一页还高），放弃增量，交给全量重排
                if (!moved.length) {
                    return { ok: false, reason: 'single-node-too-tall' };
                }
                moved.forEach(function (n) { newWrap.appendChild(n); });

                // 插入到 DOM 与数组中
                if (cur.nextSibling) { container.insertBefore(newWrap, cur.nextSibling); }
                else { container.appendChild(newWrap); }
                pages.splice(i + 1, 0, newWrap);
                added++;

                // 如果新页本身也超高，继续在同一页上切
                if (newWrap.offsetHeight > maxH + 0.5) {
                    cur = newWrap;  // 继续切分新页
                    i = pages.indexOf(cur);
                    continue;
                } else {
                    // 切下一页（如果原末页仍然超高还会再循环）
                    cur = wrap;
                }
            }

            // 更新元信息
            renumberPages();
            refreshPageStarts(i);
            if (typeof rebuildIndexNow === 'function') { rebuildIndexNow(); }

            // 仍让当前页可见（如果原来就在末页）
            if (wasCurrent) { applyPage(); }

            return { ok: true, split: true, added: added };
        }


        window.addEventListener('resize', throttle(function () { if (active) { rebuild(); } }, 250));
        return { enable, disable, rebuild, goto, next, prev, isActive, totalPages, currentPage, pageOfElement, pageOfLine, updatePageHTML };

    })();

    // 将 DomPager 暴露到全局，供其他独立作用域（如 initScrollSync）访问
    try { window.DomPager = DomPager; } catch (_) { }

    /* ======= 分页模式：按页增量渲染入口 ======= */
    (function enablePagedIncrementalUpdate() {
        // 协议：
        //   { type:'docRenderPage', pageIndex:Number, html:String }
        // 行为：
        //   - 如果不是最后一页：只替换该页；若超高 -> DomPager.rebuild()
        //   - 如果是最后一页：替换 + 溢出拆分为新页；单节点超页 -> DomPager.rebuild()
        function isPaged() {
            return document.body.classList.contains('reader-paged');
        }

        // ✅ 用本函数拼出“该页的新完整 HTML = 左侧保留 + 补丁 + 右侧保留”
        function buildPatchedPageHTML(pageIndex, fromLine, toLine, patchHTML) {
            var pageEl = document.querySelector('.anh-page[data-page="' + pageIndex + '"]');
            if (!pageEl) { return null; }
            var nodes = Array.from(pageEl.querySelectorAll('[data-line]'));
            var left = nodes.filter(function (n) { return (+n.getAttribute('data-line')) < fromLine; });
            var right = nodes.filter(function (n) { return (+n.getAttribute('data-line')) > toLine; });

            var tpl = document.createElement('template');
            tpl.innerHTML = String(patchHTML || '');
            var fragBlocks = Array.from(tpl.content.querySelectorAll('[data-line],pre'));

            var box = document.createElement('div');
            left.forEach(function (n) { box.appendChild(n.cloneNode(true)); });
            fragBlocks.forEach(function (n) { box.appendChild(n.cloneNode(true)); });
            right.forEach(function (n) { box.appendChild(n.cloneNode(true)); });

            return box.innerHTML;
        }

        function bumpUi() {
            // ⛔️ 别再触发 resize 了，会导致 DomPager.rebuild()
            // window.dispatchEvent(new Event('resize'));
            try { updatePaging(); } catch (_) { }
        }

        //   function bumpUi() {
        //       // 触发一次 UI 进度条刷新（你的 updatePaging 绑定在 resize/scroll 上）
        //       try { window.dispatchEvent(new Event('resize')); } catch (_) { }
        //   }

        window.addEventListener('message', function (ev) {
            var msg = ev && ev.data;
            if (!msg) { return; }
            if (!isPaged() || !window.DomPager || !DomPager.isActive || !DomPager.isActive()) { return; }

            // ① 分页模式增量补丁：docPatch（注意：不要被 docRenderPage 的判断拦住）
            if (msg.type === 'docPatch'
                && typeof msg.fromLine === 'number'
                && typeof msg.toLine === 'number'
                && typeof msg.html === 'string') {

                var p1 = DomPager.pageOfLine(msg.fromLine | 0);
                var p2 = DomPager.pageOfLine(msg.toLine | 0);

                if (p1 < 0 || p2 < 0) { DomPager.rebuild(); bumpUi(); return; }

                // 仅处理补丁完全落在同一页的高频场景；跨页直接全量
                if (p1 !== p2) { DomPager.rebuild(); bumpUi(); return; }

                var pageIdx = p1;
                var newPageHTML = buildPatchedPageHTML(pageIdx, msg.fromLine | 0, msg.toLine | 0, msg.html);
                if (newPageHTML === null) { DomPager.rebuild(); bumpUi(); return; }

                var isLast = (pageIdx === DomPager.totalPages() - 1);
                var rPatch = DomPager.updatePageHTML(pageIdx, newPageHTML, { allowSplit: !!isLast });
                if (!rPatch.ok) { DomPager.rebuild(); }
                bumpUi();
                return;
            }

            // ② 单页重绘：docRenderPage
            if (msg.type === 'docRenderPage') {
                var idx = (msg.pageIndex | 0);
                var html = String(msg.html || '');
                var last = (idx === DomPager.totalPages() - 1);

                var r = DomPager.updatePageHTML(idx, html, { allowSplit: !!last });
                if (!r.ok) { DomPager.rebuild(); }
                bumpUi();
                return;
            }
        });

    })();


    // 在 DomPager 定义完成后、TTS联动代码附近追加（但不在 updatePaging 里）
    (function wireDomPagerOutboundSync() {
        try {
            // 防止重复包装
            if (window.__anhDomPagerWired) { return; }
            window.__anhDomPagerWired = true;

            if (typeof DomPager === 'undefined') { return; }

            // 本地读取同步开关
            function isSyncOnLocal() {
                try {
                    var meta = JSON.parse(localStorage.getItem('anhReaderSettings') || '{}');
                    var presets = JSON.parse(localStorage.getItem('anhReaderPresets') || '{}');
                    var name = (meta && meta.lastPreset) ? meta.lastPreset : '__default__';
                    var s = (presets && presets[name]) ? presets[name] : {};
                    return !s.sync || s.sync === 'on';
                } catch (_) { return true; }
            }

            // 保存原方法
            var _goto = DomPager.goto;
            var _next = DomPager.next;
            var _prev = DomPager.prev;

            function notifyPaged() {
                if (!document.body.classList.contains('reader-paged')) { return; }
                if (!DomPager.isActive || !DomPager.isActive()) { return; }
                if (!vscode) { return; }
                if (!isSyncOnLocal()) { return; }

                // 优先用全局可见区间函数（若稍后 initScrollSync 才绑定，也有本地回退）
                var vr = (window.__anhVisibleRange && window.__anhVisibleRange());
                if (!vr) {
                    // 回退：用 index 二分 y->line
                    function lineAtY(y) {
                        if (!index || !index.length) { return 0; }
                        var lo = 0, hi = index.length - 1, ans = 0;
                        while (lo <= hi) {
                            var mid = (lo + hi) >> 1;
                            if (index[mid].top <= y) { ans = mid; lo = mid + 1; }
                            else { hi = mid - 1; }
                        }
                        return index[ans] ? (index[ans].line | 0) : 0;
                    }
                    var yTop = window.scrollY + 2;
                    var yBot = yTop + window.innerHeight - 2;
                    vr = { top: lineAtY(yTop), bottom: lineAtY(yBot) };
                }
                try { vscode.postMessage({ type: 'previewViewport', top: vr.top, bottom: vr.bottom, dir: 'down' }); } catch (_) { }
            }

            // 包装翻页方法（一次性）
            DomPager.goto = function (i) { _goto(i); notifyPaged(); };
            DomPager.next = function () { _next(); notifyPaged(); };
            DomPager.prev = function () { _prev(); notifyPaged(); };

            // 页码条按钮：避免重复绑定
            var btnPrev = document.getElementById('rp-prev');
            var btnNext = document.getElementById('rp-next');
            if (btnPrev && !btnPrev.__wiredNotify) {
                btnPrev.__wiredNotify = true;
                btnPrev.addEventListener('click', function () { setTimeout(notifyPaged, 0); });
            }
            if (btnNext && !btnNext.__wiredNotify) {
                btnNext.__wiredNotify = true;
                btnNext.addEventListener('click', function () { setTimeout(notifyPaged, 0); });
            }
        } catch (_) { }
    })();

    /* 将 DomPager 与 TTS 高亮联动 */
    (function integrateDomPagerWithTTS() {
        var origLocate = locateAndHighlight;
        locateAndHighlight = function (startIdx, len, isSel) {
            origLocate(startIdx, len, isSel);
            try {
                if (!DomPager.isActive() || !currentHighlightEl) { return; }
                var el = currentHighlightEl;
                var pg = DomPager.pageOfElement(el);
                if (pg >= 0 && pg !== DomPager.currentPage()) {
                    DomPager.goto(pg);
                    if (pageInfo) {
                        var curp = DomPager.currentPage() + 1, totp = DomPager.totalPages();
                        pageInfo.textContent = curp + ' / ' + totp;
                        if (pageProgress) { pageProgress.style.width = (totp > 0 ? (curp / totp * 100) : 0) + '%'; }
                    }
                }
            } catch (_) { }
        };
    })();

    /* 分页模式下的滚动条翻页联动（非 DomPager 时） */
    (function enableTTSAutoPage() {
        var origLocate = locateAndHighlight;
        locateAndHighlight = function (startIdx, len, isSel) {
            // ✨ 若 DomPager 已启用，直接交给 integrateDomPagerWithTTS 处理，避免双重干预
            if (typeof DomPager !== 'undefined' && DomPager.isActive && DomPager.isActive()) {
                return origLocate(startIdx, len, isSel);
            }

            origLocate(startIdx, len, isSel);
            try {
                var bodyPaged = document.body.classList.contains('reader-paged');
                if (!bodyPaged) { return; }
                var h = (function () {
                    try {
                        var st = JSON.parse(localStorage.getItem('anhReaderSettings') || '{}');
                        if (st && st.heightMode === 'manual' && st.height > 0) { return st.height; }
                        return window.innerHeight - 40;
                    } catch (_) { return window.innerHeight - 40; }
                })();
                if (!currentHighlightEl) { return; }
                var r = currentHighlightEl.getBoundingClientRect();
                var y = window.scrollY;
                var pageIndex = Math.floor(y / h);
                var highlightPage = Math.floor((r.top + y - 10) / h);
                if (highlightPage > pageIndex) {
                    window.scrollTo({ top: highlightPage * h, behavior: 'smooth' });
                }
            } catch (_) { }
        };
    })();


    /* 多列滚动定位优化（目前保持与垂直滚动一致） */
    (function fixColumnScroll() {
        var origScrollToLine = scrollToLine;
        scrollToLine = function (line, smooth, scrollRatio, totalLines) {
            var content = document.getElementById('reader-content');
            if (content && getComputedStyle(content).columnCount !== '1') {
                // 多列模式仍采用垂直滚动，无需特别处理
            }
            return origScrollToLine(line, smooth, scrollRatio, totalLines);
        };
    })();

    reflect();
})();

function showPrompt(msg, defVal) {
    var modal = document.getElementById('anh-modal');
    if (!modal) {
        return Promise.resolve(window.prompt(msg || '输入', defVal || ''));
    }
    return new Promise(function (resolve) {
        var title = document.getElementById('anh-modal-title');
        var body = document.getElementById('anh-modal-body');
        var input = document.getElementById('anh-modal-input');
        var ok = document.getElementById('anh-modal-ok');
        var cancel = document.getElementById('anh-modal-cancel');
        var backdrop = document.getElementById('anh-modal-backdrop');

        title.textContent = '提示';
        body.textContent = msg || '';
        input.value = defVal || '';
        modal.style.display = 'flex';

        function close(v) {
            modal.style.display = 'none';
            cleanup();
            resolve(v);
        }
        function onKey(e) {
            if (e.key === 'Enter') { e.preventDefault(); ok.click(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel.click(); }
        }
        function cleanup() {
            ok.removeEventListener('click', onOk);
            cancel.removeEventListener('click', onCancel);
            backdrop.removeEventListener('click', onCancel);
            document.removeEventListener('keydown', onKey);
        }
        function onOk() { close(input.value); }
        function onCancel() { close(null); }

        ok.addEventListener('click', onOk);
        cancel.addEventListener('click', onCancel);
        backdrop.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKey);
        try { input.focus(); input.select(); } catch (_) { }
    });
}

function showConfirm(msg) {
    var modal = document.getElementById('anh-modal');
    if (!modal) {
        return Promise.resolve(window.confirm(msg || '确认？'));
    }
    return new Promise(function (resolve) {
        var title = document.getElementById('anh-modal-title');
        var body = document.getElementById('anh-modal-body');
        var inputWrap = document.getElementById('anh-modal-input-wrap');
        var ok = document.getElementById('anh-modal-ok');
        var cancel = document.getElementById('anh-modal-cancel');
        var backdrop = document.getElementById('anh-modal-backdrop');

        title.textContent = '确认';
        body.textContent = msg || '';
        inputWrap.style.display = 'none';
        modal.style.display = 'flex';

        function close(v) {
            modal.style.display = 'none';
            inputWrap.style.display = '';
            cleanup();
            resolve(v);
        }
        function onKey(e) {
            if (e.key === 'Enter') { e.preventDefault(); ok.click(); }
            else if (e.key === 'Escape') { e.preventDefault(); cancel.click(); }
        }
        function cleanup() {
            ok.removeEventListener('click', onOk);
            cancel.removeEventListener('click', onCancel);
            backdrop.removeEventListener('click', onCancel);
            document.removeEventListener('keydown', onKey);
        }
        function onOk() { close(true); }
        function onCancel() { close(false); }

        ok.addEventListener('click', onOk);
        cancel.addEventListener('click', onCancel);
        backdrop.addEventListener('click', onCancel);
        document.addEventListener('keydown', onKey);
        try { ok.focus(); } catch (_) { }
    });
}

/* ================== Preview ↔ VSCode 同步滚动 ================== */
(function initScrollSync() {

    if (!window.acquireVsCodeApi) { return; }
    function lineAtY(y) {
        if (!index.length) { return 0; }
        var lo = 0, hi = index.length - 1, ans = 0;
        while (lo <= hi) {
            var mid = (lo + hi) >> 1;
            if (index[mid].top <= y) { ans = mid; lo = mid + 1; }
            else { hi = mid - 1; }
        }
        return index[ans] ? (index[ans].line | 0) : 0;
    }
    function visibleSrcLineRange() {
        var yTop = window.scrollY + 2;
        var yBot = yTop + window.innerHeight - 2;
        return { top: lineAtY(yTop), bottom: lineAtY(yBot) };
    }
    // 暴露给其他 IIFE（如 DomPager 的 wire 通知）
    try { window.__anhVisibleRange = visibleSrcLineRange; } catch (_) { }

    function postPreviewViewport() {
        if (!isSyncOn()) { return; }
        var r = visibleSrcLineRange();
        try { vscode.postMessage({ type: 'previewViewport', top: r.top, bottom: r.bottom, dir: 'down' }); } catch (_) { }
    }

    // —— 读当前预设的同步开关、模式（不依赖内部 state 变量）——
    function getCurrentState() {
        try {
            var meta = JSON.parse(localStorage.getItem('anhReaderSettings') || '{}');
            var presets = JSON.parse(localStorage.getItem('anhReaderPresets') || '{}');
            var name = (meta && meta.lastPreset) ? meta.lastPreset : '__default__';
            return (presets && presets[name]) ? presets[name] : {};
        } catch (_) { return {}; }
    }
    function isSyncOn() {
        var s = getCurrentState();
        return !s.sync || s.sync === 'on';
    }
    function isPaged() { return document.body.classList.contains('reader-paged'); }

    // —— spacer 工具：让滚动模式下总高度与 Editor 一致 —— 
    function ensureSpacer() {
        var s = document.querySelector('.scroll-spacer');
        if (!s) {
            s = document.createElement('div');
            s.className = 'scroll-spacer';
            var root = document.querySelector('.reader-root');
            if (root && root.parentNode) {
                if (root.nextSibling) { root.parentNode.insertBefore(s, root.nextSibling); }
                else { root.parentNode.appendChild(s); }
            } else {
                document.body.appendChild(s);
            }
        }
        return s;
    }
    function adjustSpacerToTotalHeight(targetTotal) {
        if (!targetTotal || targetTotal <= 0 || isPaged()) { return; }
        var s = ensureSpacer();
        var doc = document.documentElement;
        var spacerPx = parseFloat(getComputedStyle(s).height) || 0;
        var currentTotal = doc.scrollHeight;
        var base = currentTotal - spacerPx; // 去掉 spacer 后的真实内容高度
        var need = Math.max(0, targetTotal - base);
        if (Math.abs(need - spacerPx) > 1) { s.style.height = need + 'px'; }
    }

    // —— 公共度量 & 发消息 —— 
    function getScrollMetrics() {
        var doc = document.documentElement;
        var max = Math.max(1, doc.scrollHeight - window.innerHeight);
        var ratio = max > 0 ? (window.scrollY / max) : 0;
        return {
            ratio: Math.min(1, Math.max(0, ratio)),
            scrollHeight: doc.scrollHeight,
            viewport: window.innerHeight
        };
    }
    function postPreviewRatio() {
        if (!isSyncOn()) { return; }
        var mode = isPaged() ? 'paged' : 'scroll';
        var payload = { type: 'previewScroll', mode: mode };

        if (mode === 'paged' && window.DomPager && window.DomPager.isActive && window.DomPager.isActive()) {
            var page = window.DomPager.currentPage();
            var total = Math.max(1, window.DomPager.totalPages());
            payload.ratio = total > 1 ? (page / (total - 1)) : 0;
            payload.ratio = +payload.ratio.toFixed(4);
        } else {
            var m = getScrollMetrics();
            payload.ratio = +m.ratio.toFixed(4);
            var vr = getVisibleLineRange();
            payload.topLine = vr.topLine;
            payload.bottomLine = vr.bottomLine;
        }

        if (!shouldSend(payload.ratio)) { return; }
        try { vscode.postMessage(payload); } catch (_) { }
    }


    // —— 防回声控制 —— 
    var lockUntil = 0;          // 禁止“接收后又发”的时间窗（滚动期间不发出去）
    var muteSendUntil = 0;      // 静音窗口：本端滚动时不向扩展上报
    var lastEditorRatio = null; // 最近一次“扩展→预览”要求的比例
    var EPS = 0.02;             // 死区：比例差低于 2% 不触发回传

    function inLock() { return Date.now() < lockUntil; }
    function withLock(ms, fn) {
        lockUntil = Date.now() + (typeof ms === 'number' ? ms : 350);
        muteSendUntil = lockUntil;
        try { fn(); } finally { }
    }
    function shouldSend(currentRatio) {
        if (Date.now() < muteSendUntil) { return false; }
        if (lastEditorRatio !== null && Math.abs(currentRatio - lastEditorRatio) <= EPS) { return false; }
        return true;
    }


    // —— 预览 → 扩展：本地滚动上报 —— 
    window.addEventListener('scroll', throttle(function () {
        if (!isSyncOn() || inLock()) { return; }
        // 这里让 postPreviewRatio 自己做死区判断
        postPreviewRatio();
    }, 60));



    // —— 扩展 → 预览：接收滚动/翻页指令 —— 
    window.addEventListener('message', function (ev) {
        var msg = ev && ev.data;
        if (!msg || !isSyncOn()) { return; }

        // 接收来自扩展的编辑器字体设置，供「跟随 VS Code」模式使用
        try {
            if (typeof msg.vscodeFontFamily === 'string') {
                vscodeFontFamily = String(msg.vscodeFontFamily || '');
                try { reflect(); } catch (_) { }
            }
        } catch (_) { }

        if (msg.type === 'editorScroll') {
            var ratio = (typeof msg.ratio === 'number') ? Math.min(1, Math.max(0, msg.ratio)) : 0;
            lastEditorRatio = ratio;

            if (isPaged() && window.DomPager && window.DomPager.isActive && window.DomPager.isActive()) {
                var total = Math.max(1, window.DomPager.totalPages());
                var targetIdx = null;

                // 优先用 ratio；没有就用 topLine/totalLines 推出 ratio；都没有则忽略
                if (typeof msg.ratio === 'number') {
                    var r = Math.min(1, Math.max(0, msg.ratio));
                    targetIdx = Math.min(total - 1, Math.max(0, Math.round(r * (total - 1))));
                    lastEditorRatio = r;
                } else if (Number.isInteger(msg.topLine) && Number.isInteger(msg.totalLines) && msg.totalLines > 1) {
                    var r2 = Math.min(1, Math.max(0, msg.topLine / (msg.totalLines - 1)));
                    targetIdx = Math.min(total - 1, Math.max(0, Math.round(r2 * (total - 1))));
                    lastEditorRatio = r2;
                } else {
                    // 关键信息缺失：不要默认 0（否则会跳第一页）
                    return;
                }

                withLock(350, function () {
                    window.DomPager.goto(targetIdx);
                    try {
                        var info = document.getElementById('rp-info');
                        var bar = document.getElementById('rp-progress');
                        if (info) { info.textContent = (window.DomPager.currentPage() + 1) + ' / ' + total; }
                        if (bar) { bar.style.width = (total > 0 ? ((window.DomPager.currentPage() + 1) / total * 100) : 0) + '%'; }
                    } catch (_) { }
                });
                return;
            }
            else {
                // 滚动模式：优先使用来自编辑器的 topLine 来定位；否则退回比例
                if (typeof msg.editorScrollHeight === 'number' && msg.editorScrollHeight > 0) {
                    adjustSpacerToTotalHeight(msg.editorScrollHeight);
                }
                var doc = document.documentElement;
                if (Number.isInteger(msg.topLine) && Number.isInteger(msg.totalLines) && msg.totalLines > 1) {
                    var r = Math.min(1, Math.max(0, msg.topLine / (msg.totalLines - 1)));
                    var max = Math.max(1, doc.scrollHeight - window.innerHeight);
                    var top = r * max;
                    withLock(350, function () { window.scrollTo({ top: top, behavior: 'auto' }); });
                } else {
                    var max2 = Math.max(1, doc.scrollHeight - window.innerHeight);
                    var top2 = ratio * max2;
                    withLock(350, function () { window.scrollTo({ top: top2, behavior: 'auto' }); });
                }
            }
        } else if (msg.type === 'revealLine') {
            // 备用协议：按行数/比例定位（与你已有 scrollToLine 保持一致）
            withLock(function () {
                scrollToLine(msg.line || 0, true, msg.ratio, msg.totalLines);
            });
        } else if (msg.type === 'editorViewport') {
            var mid = Math.round(((msg.top | 0) + (msg.bottom | 0)) / 2);
            if (isPaged()) {
                if (window.DomPager && window.DomPager.isActive && window.DomPager.isActive() && window.DomPager.pageOfLine) {
                    var pg = window.DomPager.pageOfLine(mid);
                    withLock(function () { window.DomPager.goto(pg); });
                }
                // 分页页内无需再滚动，applyPage() 里已 rebuildIndexNow()
            } else {
                withLock(function () { scrollToLine(mid, true); });
            }
            return;
        }
    });

    // —— 暴露给外部（可选） —— 
    window.__anhSync = { adjustSpacerToTotalHeight: adjustSpacerToTotalHeight };
})();


/* ================== 增量 DOM 更新（仅滚动模式） ================== */
(function enableIncrementalDomForScrollMode() {
    var CONTAINER_ID = 'reader-content';
    var container = null;

    function getContainer() {
        return container || (container = document.getElementById(CONTAINER_ID));
    }
    function isPagedMode() { return document.body.classList.contains('reader-paged'); }

    // 可视区锚点（用中线行号 + 元素顶部偏移保持视口）
    function captureAnchor() {
        var vr = (window.__anhVisibleRange && window.__anhVisibleRange()) || getVisibleLineRange();
        var anchorLine = Math.round(((vr.top || 0) + (vr.bottom || 0)) / 2);
        var el = findNodeAtOrBefore(anchorLine);
        var top = el ? el.getBoundingClientRect().top : 0;
        return { line: anchorLine, top: top };
    }
    function restoreAnchor(anchor) {
        if (!anchor) { return; }
        var el = findNodeAtOrBefore(anchor.line);
        if (!el) { return; }
        var newTop = el.getBoundingClientRect().top;
        var dy = newTop - anchor.top;
        if (dy) { window.scrollBy({ top: dy, behavior: 'auto' }); }
    }
    function findNodeAtOrBefore(line) {
        var root = getContainer();
        if (!root) { return null; }
        var nodes = root.querySelectorAll('[data-line]');
        var best = null, bestVal = -Infinity;
        for (var i = 0; i < nodes.length; i++) {
            var l = +(nodes[i].getAttribute('data-line') || 0);
            if (l <= line && l > bestVal) { bestVal = l; best = nodes[i]; }
        }
        return best || nodes[0] || null;
    }

    // 解析整块 HTML 到离屏 fragment
    function parseHTML(html) {
        var t = document.createElement('template');
        t.innerHTML = html || '';
        return t.content;
    }

    // 收集行号序列
    function collectLines(root) {
        var arr = [], nodes = root.querySelectorAll('[data-line]');
        for (var i = 0; i < nodes.length; i++) { arr.push(+nodes[i].getAttribute('data-line')); }
        return { nodes: nodes, lines: arr };
    }

    // —— 整块 HTML 的“前后缀”粗粒度 diff，替换中间变更区间 —— //
    function applyIncrementalHTML(newHTML) {
        if (isPagedMode()) { hardSwap(newHTML); return; } // 仅滚动模式

        var root = getContainer();
        if (!root) { return; }

        var anchor = captureAnchor();

        var newFrag = parseHTML(newHTML);
        var oldInfo = collectLines(root);
        var newInfo = collectLines(newFrag);

        if (!oldInfo.lines.length || !newInfo.lines.length) { hardSwap(newHTML, anchor); return; }

        // 前缀
        var p = 0;
        while (p < oldInfo.lines.length && p < newInfo.lines.length && oldInfo.lines[p] === newInfo.lines[p]) { p++; }

        // 后缀
        var s = 0;
        while (s < (oldInfo.lines.length - p) && s < (newInfo.lines.length - p) &&
            oldInfo.lines[oldInfo.lines.length - 1 - s] === newInfo.lines[newInfo.lines.length - 1 - s]) { s++; }

        // 安全阈值：前后缀都太短或重叠不稳时直接全量替换
        var minKeep = 3; // 至少保留 3 个 data-line 作为稳定锚
        if ((p < minKeep && s < minKeep) || (p + s >= Math.min(oldInfo.lines.length, newInfo.lines.length))) {
            hardSwap(newHTML, anchor);
            return;
        }

        // 计算需替换的中段
        var oldStart = p;
        var oldEndEx = oldInfo.lines.length - s;
        var newStart = p;
        var newEndEx = newInfo.lines.length - s;

        // 构造中段新片段
        var midFrag = document.createDocumentFragment();
        for (var i = newStart; i < newEndEx; i++) {
            midFrag.appendChild(newInfo.nodes[i].cloneNode(true));
        }

        // 找到“后缀首节点”，用于插入位置
        var beforeNode = (oldEndEx < oldInfo.nodes.length) ? oldInfo.nodes[oldEndEx] : null;

        // 删除旧中段
        for (var j = oldStart; j < oldEndEx; j++) {
            var el = oldInfo.nodes[j];
            if (el && el.parentNode) { el.parentNode.removeChild(el); }
        }

        // 插入新中段
        if (beforeNode && beforeNode.parentNode) { beforeNode.parentNode.insertBefore(midFrag, beforeNode); }
        else { root.appendChild(midFrag); }

        // 重建索引并还原视口
        rebuildIndexNow();
        restoreAnchor(anchor);
    }

    // —— 基于行号的 Hunks（扩展侧直接发补丁） —— //
    // hunk: { start: <含>, end: <不含>, html: "<...>" }  都用 data-line 行号
    function applyHunks(hunks) {
        if (isPagedMode()) { return; } // 仅滚动模式
        var root = getContainer();
        if (!root || !Array.isArray(hunks) || !hunks.length) { return; }

        // 锚点
        var anchor = captureAnchor();

        // 为避免相互干扰，按 start 逆序应用
        hunks.sort(function (a, b) { return b.start - a.start; });

        hunks.forEach(function (h) {
            var start = +h.start | 0;
            var endEx = +h.end | 0;
            if (!(endEx > start)) { return; }

            // 找到 [start, endEx) 区间内的节点
            var nodes = root.querySelectorAll('[data-line]');
            var toRemove = [];
            for (var i = 0; i < nodes.length; i++) {
                var ln = +(nodes[i].getAttribute('data-line') || 0);
                if (ln >= start && ln < endEx) { toRemove.push(nodes[i]); }
            }

            // 插入位置：endEx 的第一个节点（如果存在），否则追加
            var before = null;
            for (var j = 0; j < nodes.length; j++) {
                var ln2 = +(nodes[j].getAttribute('data-line') || 0);
                if (ln2 >= endEx) { before = nodes[j]; break; }
            }

            // 删除
            for (var k = 0; k < toRemove.length; k++) {
                if (toRemove[k].parentNode) { toRemove[k].parentNode.removeChild(toRemove[k]); }
            }

            // 插入新片段
            if (h.html && typeof h.html === 'string') {
                var frag = parseHTML(h.html);
                // 只插入其中的 [data-line] 片段（防御）
                var inject = document.createDocumentFragment();
                var nn = frag.querySelectorAll('[data-line]');
                if (nn.length) {
                    for (var z = 0; z < nn.length; z++) { inject.appendChild(nn[z].cloneNode(true)); }
                    if (before && before.parentNode) { before.parentNode.insertBefore(inject, before); }
                    else { root.appendChild(inject); }
                }
            }
        });

        rebuildIndexNow();
        restoreAnchor(anchor);
    }

    // —— 全量替换（兜底），保持滚动比例或锚点 —— //
    function hardSwap(html, anchor) {
        var root = getContainer();
        if (!root) { return; }
        var ratio = Math.min(1, Math.max(0,
            (document.documentElement.scrollHeight > window.innerHeight)
                ? (window.scrollY / (document.documentElement.scrollHeight - window.innerHeight))
                : 0));

        root.innerHTML = html || '';
        rebuildIndexNow();

        if (anchor) {
            restoreAnchor(anchor);
        } else {
            var max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
            window.scrollTo({ top: ratio * max, behavior: 'auto' });
        }
    }

    // —— 合帧调度，合并连续更新 —— //
    var _pending = null, _scheduled = false;
    function scheduleWholeHtml(html) {
        _pending = { type: 'whole', html: html };
        if (_scheduled) { return; }
        _scheduled = true;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            var task = _pending; _pending = null; _scheduled = false;
            if (!task) { return; }
            applyIncrementalHTML(task.html);
        }));
    }
    function scheduleHunks(hunks) {
        _pending = { type: 'hunks', hunks: hunks };
        if (_scheduled) { return; }
        _scheduled = true;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            var task = _pending; _pending = null; _scheduled = false;
            if (!task) { return; }
            applyHunks(task.hunks);
        }));
    }

    // —— 消息接入 —— //
    window.addEventListener('message', function (ev) {
        var msg = ev && ev.data;
        if (!msg) { return; }

        // 扩展端若能给出行补丁，优先用它（零闪烁）
        if (msg.type === 'docPatch' && Array.isArray(msg.hunks)) {
            if (!isPagedMode()) { scheduleHunks(msg.hunks); }
            return;
        }

        // 扩展端只给整块 HTML（同文件）：sameDoc=true
        if (msg.type === 'docRender' && msg.sameDoc && typeof msg.html === 'string') {
            if (!isPagedMode()) { scheduleWholeHtml(msg.html); }
            return;
        }

        // 其他情况忽略（或在这里兼容你已有协议）
    });
})();