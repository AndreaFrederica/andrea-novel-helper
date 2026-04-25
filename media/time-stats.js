/* time-stats.js — Chart.js 版本 */
const vscode = acquireVsCodeApi();

// ====== 常量与持久化键 ======
const LS_PREFIX = 'ANH_TIME_';
const PRESET_VALUES = [15, 30, 60, 120];     // 预设列表（最大 2 小时）
const CUSTOM_MIN = 15;                       // 自定义最小 15 分
const CUSTOM_MAX = 1440;                     // 自定义最大 24 小时

/** 持久化单个 uiState 键到 localStorage */
function saveState(key, value) {
    try { localStorage.setItem(LS_PREFIX + key, value); } catch (_) {}
}

// —— 交互状态（带持久化） —— //
const uiState = {
    rangeMode: localStorage.getItem(LS_PREFIX + 'rangeMode') || 'full',
    gapPolicy: localStorage.getItem(LS_PREFIX + 'gapPolicy') || 'zero',
    continuityGapMinutes: +(localStorage.getItem(LS_PREFIX + 'continuityGapMinutes')
        || document.body.dataset.continuityGapMinutes
        || 120),
    weekOffsetDays: +(localStorage.getItem(LS_PREFIX + 'weekOffsetDays') || 0),
    weekButtonPressed: false,
    weekButtonLast: null,
    calMonthOffset: +(localStorage.getItem(LS_PREFIX + 'calMonthOffset') || 0),
    calViewMode: localStorage.getItem(LS_PREFIX + 'calViewMode') || 'heatmap',
    // 按钮色系：'vscode'（跟随主题）或 '#rrggbb'
    btnColor: localStorage.getItem(LS_PREFIX + 'btnColor') || 'vscode',
    // 图表色系：'vscode'（跟随主题）或 {r,g,b} 自定义
    chartColor: (() => {
        const s = localStorage.getItem(LS_PREFIX + 'chartColor');
        if (!s) { return { r: 102, g: 170, b: 255 }; }
        if (s === 'vscode') { return 'vscode'; }
        try { return JSON.parse(s) || { r: 102, g: 170, b: 255 }; } catch (e) { return { r: 102, g: 170, b: 255 }; }
    })(),
    // 日历是否显示0字数格子
    showZeroCalCells: (localStorage.getItem(LS_PREFIX + 'showZeroCalCells') || 'true') === 'true',
    // 每个组件是否显示
    sectionVisible: (() => {
        const DEFAULTS = { secLine: true, secTodayBars: true, secTodayHeatmap: true, secWeek: true, secMonthly: true, secYearHeatmap: true };
        const saved = JSON.parse(localStorage.getItem(LS_PREFIX + 'sectionVisible') || 'null');
        if (!saved) { return DEFAULTS; }
        // 新增组件默认可见
        Object.keys(DEFAULTS).forEach(k => { if (!(k in saved)) { saved[k] = true; } });
        return saved;
    })(),
    // 面板排列顺序
    sectionOrder: (() => {
        const ALL = ['secLine', 'secTodayBars', 'secTodayHeatmap', 'secWeek', 'secMonthly', 'secYearHeatmap'];
        const saved = JSON.parse(localStorage.getItem(LS_PREFIX + 'sectionOrder') || 'null');
        if (!saved) { return ALL; }
        // 将新增的组件追加到已保存顺序末尾（向后兼容）
        ALL.forEach(id => { if (!saved.includes(id)) { saved.push(id); } });
        return saved;
    })(),
    // 年热力图年平移（0=今年）
    yearOffset: +(localStorage.getItem(LS_PREFIX + 'yearOffset') || 0),
};

// —— 缺口与连续段阈值（分钟） —— //
const GAP_MINUTES = +(document.body.dataset.gapMinutes || 10);                 // 用于“断线”策略
const MAX_FILL_POINTS = 24 * 60;                                              // 零填充上限

// —— 小工具 —— //
function fmtMinutes(ms) {
    const mins = Math.round(ms / 60000);
    return mins + ' 分钟';
}
function cssVar(name, fallback) {
    const v = getComputedStyle(document.body).getPropertyValue(name).trim();
    return v || fallback;
}
/** 解析 CSS 颜色（'#rrggbb' 或 'rgb(r,g,b)'）→ {r,g,b}，失败返回 null */
function parseCssColor(str) {
    if (!str) { return null; }
    const t = str.trim();
    if (t.startsWith('#')) { return hexToRgb(t); }
    const m = t.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
}
/** 解析图表色到 {r,g,b}；若为 'vscode' 则从主题 CSS 变量读取强调色 */
function resolveChartRgb() {
    if (uiState.chartColor === 'vscode') {
        const raw = cssVar('--vscode-button-background', '')
                 || cssVar('--vscode-focusBorder', '');
        return parseCssColor(raw) || { r: 102, g: 170, b: 255 };
    }
    return uiState.chartColor;
}
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function lerp(a, b, t) { return a + (b - a) * t; }


// ====== 最近连续段切片（使用 uiState.continuityGapMinutes） ======
function sliceToRecentContinuous(rows, gapMs) {
    if (!rows || !rows.length) { return rows || []; }
    const gms = gapMs ?? (uiState.continuityGapMinutes * 60_000); // ← 关键修复

    const sorted = [...rows].sort((a, b) => new Date(a.t) - new Date(b.t));
    let end = sorted.length - 1;
    let prev = new Date(sorted[end].t).getTime();

    let i = end - 1;
    for (; i >= 0; i--) {
        const ts = new Date(sorted[i].t).getTime();
        if ((prev - ts) >= gms) { break; } // 断开
        prev = ts;
    }
    const start = Math.max(0, i + 1);
    return sorted.slice(start);
}


function buildLinePoints(rows, gapPolicy = uiState.gapPolicy) {
    if (!rows || !rows.length) { return []; }
    const sorted = [...rows].sort((a, b) => new Date(a.t) - new Date(b.t));

    const STEP = 60_000;
    const GAP = GAP_MINUTES * STEP;
    const out = [];
    let lastTs = null;

    for (const r of sorted) {
        const curTs = new Date(r.t).getTime();
        const curY = r.cpm ?? 0;

        if (lastTs !== null && curTs > lastTs) {
            const delta = curTs - lastTs;
            if (gapPolicy === 'zero') {
                const miss = Math.min(MAX_FILL_POINTS, Math.floor(delta / STEP) - 1);
                for (let k = 1; k <= miss; k++) {
                    out.push({ x: new Date(lastTs + k * STEP), y: 0 });
                }
            } else if (gapPolicy === 'break' && delta >= GAP) {
                out.push({ x: new Date(lastTs + 1), y: null }); // 让 Chart.js 断线
            }
        }

        out.push({ x: new Date(curTs), y: curY });
        lastTs = curTs;
    }
    return out;
}

function rerenderLine() {
    const canvas = document.getElementById('lineChart');
    const rows = dataCache.perFileLine || [];
    const scope = (uiState.rangeMode === 'recent') ? sliceToRecentContinuous(rows) : rows;
    drawLineChart(canvas, scope);
}



// 用于主题 &网格配色
const COLOR_FG = () => cssVar('--fg', '#aab');
const COLOR_GRID = () => cssVar('--grid', '#556');
// 读取当前图表色（自定义或跟随 VS Code 主题）
const COLOR_ACCENT = () => {
    const { r, g, b } = resolveChartRgb();
    return `rgb(${r},${g},${b})`;
};
// 返回解析后的 {r,g,b} 对象
const CHART_RGB = () => resolveChartRgb();

// 统一管理/销毁图表实例，避免重复创建导致的内存泄露
const charts = {
    line: null,
    todayBars: null,
    todayHeatmap: null,
    weekBars: null,
    monthlyHeatmap: null,
};

// 数据缓存，用于避免不必要的重绘
const dataCache = {
    perFileLine: null,
    todayHourly: null,
    todayQuarterHourly: null,
    heatmap: null
};

function destroyChart(key) {
    if (charts[key]) {
        charts[key].destroy();
        charts[key] = null;
    }
}

// 检查数据是否发生变化
function hasDataChanged(newData, cachedData) {
    return JSON.stringify(newData) !== JSON.stringify(cachedData);
}

// —— 数据请求 —— //
function requestStatsData() {
    vscode.postMessage({ type: 'get-stats-data' });
}

window.addEventListener('DOMContentLoaded', () => {
    // ====== 绑定控件（新增 preset + custom 逻辑，持久化到 ANH_TIME_*） ======
    function bindControls() {
        const full = document.getElementById('rangeFull');
        const recent = document.getElementById('rangeRecent');
        const zero = document.getElementById('gapZero');
        const brk = document.getElementById('gapBreak');

        const contPreset = document.getElementById('contPreset');
        const contCustom = document.getElementById('contCustom');
        const contHint = document.getElementById('contHint');

        // —— 恢复勾选 —— //
        (uiState.rangeMode === 'recent' ? recent : full).checked = true;
        (uiState.gapPolicy === 'break' ? brk : zero).checked = true;

        // preset/custom 初始同步
        function syncPresetFromState() {
            const val = +uiState.continuityGapMinutes || 120;
            const isPreset = PRESET_VALUES.includes(val);
            contPreset.value = isPreset ? String(val) : '__custom__';
            contCustom.value = String(val);
            contCustom.disabled = (contPreset.value !== '__custom__');
            contHint.textContent = (contPreset.value === '__custom__')
                ? `自定义：${Math.max(CUSTOM_MIN, Math.min(CUSTOM_MAX, val))} 分`
                : '';
        }

        function clampCustom(v) {
            if (!Number.isFinite(v)) { return CUSTOM_MIN; }
            return Math.max(CUSTOM_MIN, Math.min(CUSTOM_MAX, Math.round(v)));
        }

        function setContinuityMinutes(mins, rerender = true) {
            const vv = clampCustom(mins);
            uiState.continuityGapMinutes = vv;
            saveState('continuityGapMinutes', vv);
            syncPresetFromState();
            if (rerender) { rerenderLine(); }
        }

        function setContDisabledByRange() {
            const disabled = (uiState.rangeMode !== 'recent');
            contPreset.disabled = disabled;
            contCustom.disabled = disabled || (contPreset.value !== '__custom__');
            contHint.style.opacity = disabled ? 0.5 : 1;
        }


        syncPresetFromState();
        setContDisabledByRange();

        // —— 事件 —— //
        full?.addEventListener('change', () => {
            uiState.rangeMode = full.checked ? 'full' : 'recent';
            saveState('rangeMode', uiState.rangeMode);
            setContDisabledByRange();
            rerenderLine();
        });

        recent?.addEventListener('change', () => {
            uiState.rangeMode = recent.checked ? 'recent' : 'full';
            saveState('rangeMode', uiState.rangeMode);
            setContDisabledByRange();
            rerenderLine();
        });

        zero?.addEventListener('change', () => {
            uiState.gapPolicy = zero.checked ? 'zero' : 'break';
            saveState('gapPolicy', uiState.gapPolicy);
            rerenderLine();
        });

        brk?.addEventListener('change', () => {
            uiState.gapPolicy = brk.checked ? 'break' : 'zero';
            saveState('gapPolicy', uiState.gapPolicy);
            rerenderLine();
        });

        contPreset?.addEventListener('change', () => {
            if (contPreset.value === '__custom__') {
                contCustom.disabled = (uiState.rangeMode !== 'recent') ? true : false;
                contCustom.focus();
                contCustom.select();
                contHint.textContent = `自定义：${contCustom.value || uiState.continuityGapMinutes} 分`;
            } else {
                const mins = +contPreset.value;
                setContinuityMinutes(mins);
            }
        });

        // 用 input 让用户边敲边生效太“抖”，这里用 change；想更灵敏可改成 input + 防抖
        contCustom?.addEventListener('change', () => {
            const val = clampCustom(+contCustom.value || uiState.continuityGapMinutes);
            // 如果正好落在预设上，自动切回预设项；否则保持自定义
            if (PRESET_VALUES.includes(val)) {
                contPreset.value = String(val);
            } else {
                contPreset.value = '__custom__';
            }
            setContinuityMinutes(val);
        });

        contCustom?.addEventListener('input', () => {
            // 友好提示当前数值
            const val = clampCustom(+contCustom.value || uiState.continuityGapMinutes);
            contHint.textContent = `自定义：${val} 分`;
        });
    }

    function bindWeekControls() {
        // 直接使用 document.getElementById 绑定元素（不再使用 $ 简写）
        // 抽出的具名函数：统一保存偏移并触发重绘
        function applyWeekOffset() {
            localStorage.setItem(LS_PREFIX + 'weekOffsetDays', String(uiState.weekOffsetDays));
            console.log('[week] offsetDays =', uiState.weekOffsetDays); // ✅ 调试
            rerenderWeekBars();
        }

        // 全局 flag：表示有周控件按钮被按下（以及记录最后一次按下的信息）
        function setWeekButtonFlag(id) {
            try {
                uiState.weekButtonPressed = true;
                uiState.weekButtonLast = { id: id || null, ts: Date.now() };
            } catch (e) {
                // ignore in case window not writable
            }
        }

        // 各按钮的具名处理器
        function weekBack7Handler() { uiState.weekOffsetDays -= 7; setWeekButtonFlag('weekBack7'); applyWeekOffset(); }
        function weekBack1Handler() { uiState.weekOffsetDays -= 1; setWeekButtonFlag('weekBack1'); applyWeekOffset(); }
        function weekResetHandler() { uiState.weekOffsetDays = 0; setWeekButtonFlag('weekReset'); applyWeekOffset(); }
        function weekFwd1Handler() { uiState.weekOffsetDays += 1; setWeekButtonFlag('weekFwd1'); applyWeekOffset(); }
        function weekFwd7Handler() { uiState.weekOffsetDays += 7; setWeekButtonFlag('weekFwd7'); applyWeekOffset(); }

        document.getElementById('weekBack7')?.addEventListener('click', weekBack7Handler);
        document.getElementById('weekBack1')?.addEventListener('click', weekBack1Handler);
        document.getElementById('weekReset')?.addEventListener('click', weekResetHandler);
        document.getElementById('weekFwd1')?.addEventListener('click', weekFwd1Handler);
        document.getElementById('weekFwd7')?.addEventListener('click', weekFwd7Handler);
    }

    // 初始化：绑定控件，拉取一次数据并每秒刷新一次
    bindControls();
    bindWeekControls();
    bindCalendarControls();
    bindYearHeatmapControls();
    bindSettingsPanel();
    applyCalViewMode();
    applySectionVisibility();
    applySectionOrder();
    rerenderYearHeatmap();
    requestStatsData();
    setInterval(requestStatsData, 1 * 1000);
});

window.addEventListener('message', (e) => {
    const data = e.data;
    if (!data) { return; }

    if (data.type !== 'time-stats-data') { return; }

    // KPI
    document.getElementById('k_total').textContent = fmtMinutes(data.totalMillisAll);
    document.getElementById('k_today_time').textContent = fmtMinutes(data.today.millis);
    const avgCPM = data.today.avgCPM ?? 0;
    const peakCPM = data.today.peakCPM ?? 0;
    const avgCPH = avgCPM * 60;
    const peakCPH = peakCPM * 60;
    document.getElementById('k_today_avg').textContent = `${avgCPM} 字/分钟 | ${avgCPH} 字/小时`;
    document.getElementById('k_today_peak').textContent = `${peakCPM} 字/分钟 | ${peakCPH} 字/小时`;
    document.getElementById('scopeTag').textContent = data.supportsGlobal
        ? (data.approximateGlobal ? '跨文件粗略汇总' : '跨文件汇总')
        : '仅当前文件';

    // 图表渲染 - 只在数据变化时重绘
    const newPerFileLine = data.perFileLine || [];
    const newTodayHourly = data.today?.hourly || {};
    const newTodayQuarterHourly = data.today?.quarterHourly || [];
    const newHeatmap = data.heatmap || {};

    if (hasDataChanged(newPerFileLine, dataCache.perFileLine)) {
        console.log('Line chart data changed, redrawing...');
        const scoped = (uiState.rangeMode === 'recent')
            ? sliceToRecentContinuous(newPerFileLine)
            : newPerFileLine;
        drawLineChart(document.getElementById('lineChart'), scoped);
        dataCache.perFileLine = JSON.parse(JSON.stringify(newPerFileLine));
    } else {
        // 数据没变但用户切换了模式时也能即时重绘
        rerenderLine();
    }

    if (hasDataChanged(newTodayHourly, dataCache.todayHourly)) {
        console.log('Today hourly data changed, redrawing...');
        drawTodayBars(document.getElementById('todayBars'), newTodayHourly);
        dataCache.todayHourly = JSON.parse(JSON.stringify(newTodayHourly));
    }

    if (hasDataChanged(newTodayQuarterHourly, dataCache.todayQuarterHourly)) {
        console.log('Today quarter hourly data changed, redrawing...');
        drawTodayHeatmap(document.getElementById('todayHeatmap'), newTodayQuarterHourly);
        dataCache.todayQuarterHourly = JSON.parse(JSON.stringify(newTodayQuarterHourly));
    }

    if (hasDataChanged(newHeatmap, dataCache.heatmap)) {
        console.log('Heatmap data changed, redrawing...');
        const weekEl = document.getElementById('weekBars');
        if (weekEl) {
            drawThisWeekBars(weekEl, newHeatmap, uiState.weekOffsetDays); // 传偏移
        }
        rerenderMonthly(newHeatmap);
        rerenderYearHeatmap(newHeatmap);
        dataCache.heatmap = JSON.parse(JSON.stringify(newHeatmap));
    } else {
        if (uiState.weekButtonPressed) {
            // 热力图没变，但用户可能点了偏移按钮
            rerenderWeekBars();
            uiState.weekButtonPressed = false;
        }
    }
});



function drawLineChart(canvas, rows) {
    destroyChart('line');
    if (!canvas) { return; }
    const ctx = canvas.getContext('2d');

    const points = buildLinePoints(rows, uiState.gapPolicy);
    const dsColor = COLOR_ACCENT();

    charts.line = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'CPM',
                data: points,
                borderColor: dsColor,
                backgroundColor: dsColor,
                pointRadius: 0,
                tension: 0.25,
                borderWidth: 2,
                spanGaps: false, // y=null 处断线
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            parsing: { xAxisKey: 'x', yAxisKey: 'y' },
            normalized: true,
            scales: {
                x: {
                    type: 'time',
                    time: { unit: 'minute' },
                    ticks: {
                        color: COLOR_FG(),
                        autoSkip: true,
                        maxTicksLimit: 8,
                        callback: (v) => new Date(v).toLocaleTimeString([], {
                            hour: '2-digit', minute: '2-digit', hour12: false
                        })
                    },
                    grid: { color: 'rgba(127,127,127,0.15)' }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: COLOR_FG() },
                    grid: { color: 'rgba(127,127,127,0.15)' },
                    title: { display: true, text: 'CPM', color: COLOR_FG() },
                    suggestedMax: Math.max(60, ...points.map(p => p?.y ?? 0))
                }
            },
            layout: { padding: 4 },
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            const d = items[0]?.raw?.x;
                            return d ? `时间：${new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}` : '';
                        },
                        label: (item) => `CPM：${item.raw?.y ?? 0}`
                    }
                }
            }
        }
    });
}


// ===== 柱状图：今日每小时输入（today.hourly） =====
function drawTodayBars(canvas, hourly) {
    destroyChart('todayBars');
    const ctx = canvas.getContext('2d');

    const labels = Array.from({ length: 24 }, (_, h) => `${h.toString().padStart(2, '0')}:00`);
    const data = labels.map((_, idx) => hourly[idx] || 0);

    const barColor = COLOR_ACCENT();

    charts.todayBars = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: '今日每小时输入',
                data,
                backgroundColor: barColor,
                borderWidth: 0,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    ticks: { color: COLOR_FG(), maxRotation: 0, autoSkip: true },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: COLOR_FG(),
                        callback: (v) => Number(v).toLocaleString()
                    },
                    grid: { color: 'rgba(127,127,127,0.15)' },
                    title: { display: true, text: '字符数', color: COLOR_FG() }
                }

            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (item) => `字符：${item.raw}`
                    }
                }
            },
            animation: false  // 禁用动画
        }
    });
}

function drawTodayHeatmap(canvas, quarterHourly) {
    destroyChart('todayHeatmap');
    const ctx = canvas.getContext('2d');

    const yLabels = ['00', '15', '30', '45']; // 4 行
    const hours = Array.from({ length: 24 }, (_, h) => h);

    // 颜色映射
    let maxVal = 0;
    for (let i = 0; i < 96; i++) { maxVal = Math.max(maxVal, quarterHourly[i] || 0); }
    const base = CHART_RGB();
    const colorFor = (v) => {
        if (maxVal <= 0) { return `rgba(${base.r},${base.g},${base.b},0.15)`; }
        const t = Math.min(1, v / maxVal);
        const a = 0.15 + 0.85 * Math.sqrt(t);
        return `rgba(${base.r},${base.g},${base.b},${a})`;
    };

    // 每一行一个 dataset，x 用浮动条 [start, end] 占 1 小时
    const datasets = yLabels.map((lab, q) => ({
        label: lab,
        data: hours.map((h) => ({
            // 浮动条：从 h 到 h+1（正好 1 小时宽）
            x: [h, h + 1],
            y: lab,
            v: quarterHourly[h * 4 + q] || 0
        })),
        parsing: { xAxisKey: 'x', yAxisKey: 'y' },
        backgroundColor: (c) => colorFor(c.raw?.v ?? 0),
        borderColor: 'transparent',
        borderSkipped: false,
        grouped: false,          // 不并排分组
        barPercentage: 1,
        categoryPercentage: 1,
        barThickness: (ctx) => {
            const ca = ctx.chart.chartArea;
            if (!ca) { return; }
            const rowH = ca.height / yLabels.length;
            return Math.max(2, Math.floor(rowH)); // 每行留 2px 间隙
        },
        maxBarThickness: 40
    }));

    charts.todayHeatmap = new Chart(ctx, {
        type: 'bar',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            // 关键：把索引轴放到 y 轴（行），数值轴放到 x 轴（时间）
            indexAxis: 'y',
            scales: {
                x: {
                    type: 'linear',
                    min: 0,
                    max: 24, // 用 24，浮动条才不会被截掉右边界
                    ticks: {
                        color: COLOR_FG(),
                        stepSize: 1,
                        callback: (v) => String(v).padStart(2, '0')
                    },
                    grid: { display: false },
                    stacked: false
                },
                y: {
                    type: 'category',
                    labels: yLabels,
                    offset: true,
                    ticks: { color: COLOR_FG() },
                    grid: { display: false },
                    stacked: false
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            const hEnd = items[0]?.raw?.x?.[1] ?? 0;
                            const h = Math.max(0, Math.min(23, Math.floor(hEnd - 1)));
                            const q = items[0]?.raw?.y ?? '00';
                            return `时间 ${String(h).padStart(2, '0')}:${q}`;
                        },
                        label: (item) => `字符：${item.raw?.v ?? 0}`
                    }
                }
            },
            animation: false
        }
    });
}



function drawMonthlyHeatmap(canvas, heatmap, refDate = new Date()) {
    destroyChart('monthlyHeatmap');
    const ctx = canvas.getContext('2d');

    const dayMs = 24 * 3600 * 1000;
    const yLabels = ['一', '二', '三', '四', '五', '六', '日']; // 周一开头

    // —— 当月范围（本地零点）——
    const Y = refDate.getFullYear();
    const M = refDate.getMonth();                 // 0..11
    const monthStart = new Date(Y, M, 1).getTime();
    const daysInMonth = new Date(Y, M + 1, 0).getDate();
    const monthEnd = new Date(Y, M, daysInMonth).getTime(); // 当月最后一天零点

    // 本地把周一作为 0
    const weekdayMon0 = (new Date(monthStart).getDay() + 6) % 7;

    // 从该周的周一开始铺格子
    const startDay = monthStart - weekdayMon0 * dayMs;

    // 需要的列数（周数）
    const cols = Math.ceil((weekdayMon0 + daysInMonth) / 7);

    // 扫描并计算最大值
    let maxVal = 0;
    const matrix = []; // {col, rowLabel, ts, v, out}
    for (let c = 0; c < cols; c++) {
        for (let d = 0; d < 7; d++) {
            const ts = startDay + (c * 7 + d) * dayMs;      // 该格子对应的本地零点
            const v = heatmap[ts] || 0;
            const out = (ts < monthStart || ts > monthEnd); // 非当月的灰格
            matrix.push({ col: c, rowLabel: yLabels[d], ts, v, out });
            if (!out && v > maxVal) { maxVal = v; }
        }
    }

    // 颜色映射
    const base = CHART_RGB();
    const colorFor = (v, out) => {
        if (maxVal <= 0) { return `rgba(${base.r},${base.g},${base.b},${out ? 0.08 : 0.15})`; }
        const t = Math.min(1, v / maxVal);
        const a = (out ? 0.08 : 0.15) + 0.85 * Math.sqrt(t);
        return `rgba(${base.r},${base.g},${base.b},${a})`;
    };

    // 每个“星期行”一个 dataset；x 用浮动条 [col, col+1]，y 为类别行
    const datasets = yLabels.map((label) => ({
        label: `周${label}`,
        data: matrix
            .filter(m => m.rowLabel === label)
            .map(m => ({ x: [m.col, m.col + 1], y: label, v: m.v, ts: m.ts, out: m.out })),
        parsing: { xAxisKey: 'x', yAxisKey: 'y' },
        backgroundColor: (ctx) => {
            const raw = ctx.raw || {};
            return colorFor(raw.v ?? 0, raw.out);
        },
        borderColor: 'transparent',
        borderSkipped: false,
        grouped: false,
        barPercentage: 1,
        categoryPercentage: 1,
        barThickness: (ctx) => {
            const ca = ctx.chart.chartArea;
            if (!ca) { return; }
            const rowH = ca.height / 7;
            return Math.max(2, Math.floor(rowH));
        },
        maxBarThickness: 40,
    }));

    charts.monthlyHeatmap = new Chart(ctx, {
        type: 'bar',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',                       // 行=索引轴
            scales: {
                x: {
                    type: 'linear',
                    min: 0,
                    max: cols,                        // 浮动条右端不会被裁掉
                    grid: { display: false },
                    ticks: {
                        color: COLOR_FG(),
                        stepSize: 1,
                        // 显示第几周（从当月第一周算起）
                        callback: (v) => `W${v + 1}`
                    },
                    stacked: false
                },
                y: {
                    type: 'category',
                    labels: yLabels,
                    offset: true,
                    grid: { display: false },
                    ticks: { color: COLOR_FG() },
                    stacked: false
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            const ts = items[0]?.raw?.ts;
                            return ts ? new Date(ts).toLocaleDateString() : '';
                        },
                        label: (item) => `字符：${item.raw?.v ?? 0}`
                    }
                }
            },
            animation: false
        }
    });
}

function rerenderWeekBars() {
    const weekEl = document.getElementById('weekBars');
    if (weekEl && dataCache.heatmap) {
        drawThisWeekBars(weekEl, dataCache.heatmap, uiState.weekOffsetDays);
    }
}

// function drawThisWeekBars(canvas, dailyMap, offsetDays = 0) {
//     destroyChart('weekBars');
//     const ctx = canvas.getContext('2d');

//     const dayMs = 24 * 3600 * 1000;
//     const ZH_WEEK = ['日', '一', '二', '三', '四', '五', '六'];

//     // —— 窗口“起点”= 本地零点 + 偏移（今天在最左侧）——
//     const start = new Date();
//     start.setHours(0, 0, 0, 0);
//     const startTs = start.getTime() + offsetDays * dayMs;

//     // —— 从左到右：今天(起点)、昨天、前天… 共 7 根柱 —— //
//     // （也就是时间向右“倒序”，满足“今天在最左侧”）
//     let maxVal = 0;
//     const points = [];
//     const labels = [];
//     for (let i = 0; i < 7; i++) {
//         const ts = startTs - i * dayMs;   // i=0 最左（今天/起点），i=6 最右（起点-6天）
//         const d = new Date(ts);
//         const v = dailyMap[ts] || 0;

//         const mm = String(d.getMonth() + 1).padStart(2, '0');
//         const dd = String(d.getDate()).padStart(2, '0');
//         const label = `${mm}/${dd}`;

//         labels.push(label);
//         points.push({ x: label, y: v, ts, isStart: i === 0 }); // ✅ 高亮最左柱（今天/起点）
//         if (v > maxVal) { maxVal = v; }
//     }

//     // 颜色映射（与热力图一致），起点稍微强调
//     const base = { r: 102, g: 170, b: 255 };
//     const colorFor = (v, emph) => {
//         if (maxVal <= 0) { return `rgba(${base.r},${base.g},${base.b},0.18)`; }
//         const t = Math.min(1, v / maxVal);
//         const a = 0.18 + 0.82 * Math.sqrt(t);
//         const a2 = Math.min(1, a + (emph ? 0.10 : 0));
//         return `rgba(${base.r},${base.g},${base.b},${a2})`;
//     };

//     charts.weekBars = new Chart(ctx, {
//         type: 'bar',
//         data: {
//             datasets: [{
//                 label: '7 天窗口',
//                 data: points,
//                 parsing: { xAxisKey: 'x', yAxisKey: 'y' },
//                 backgroundColor: (c) => colorFor(c.raw?.y ?? 0, c.raw?.isStart),
//                 borderColor: (c) => (c.raw?.isStart ? COLOR_FG() : 'transparent'),
//                 borderWidth: (c) => (c.raw?.isStart ? 1 : 0),
//                 borderSkipped: false,
//                 barPercentage: 0.9,
//                 categoryPercentage: 0.9
//             }]
//         },
//         options: {
//             responsive: true,
//             maintainAspectRatio: false,
//             scales: {
//                 x: {
//                     type: 'category',
//                     labels,
//                     ticks: { color: COLOR_FG(), maxRotation: 0, autoSkip: false },
//                     grid: { display: false }
//                 },
//                 y: {
//                     type: 'linear',
//                     beginAtZero: true,
//                     ticks: {
//                         color: COLOR_FG(),
//                         callback: (v) => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v
//                     },
//                     grid: { color: COLOR_GRID() }
//                 }
//             },
//             plugins: {
//                 legend: { display: false },
//                 tooltip: {
//                     callbacks: {
//                         title: (items) => {
//                             const ts = items[0]?.raw?.ts;
//                             if (!ts) { return ''; }
//                             const d = new Date(ts);
//                             const w = ZH_WEEK[d.getDay()];
//                             return `${d.toLocaleDateString()}（周${w}）`;
//                         },
//                         label: (item) => `字符：${item.raw?.y ?? 0}`
//                     }
//                 }
//             },
//             animation: false
//         }
//     });
// }

function drawThisWeekBars(canvas, dailyMap, offsetDays = 0) {
    destroyChart('weekBars');
    const ctx = canvas.getContext('2d');

    const dayMs = 24 * 3600 * 1000;
    const ZH_WEEK = ['日', '一', '二', '三', '四', '五', '六'];

    // 窗口结束日：本地零点 + 偏移（offsetDays=0 时，今天是右端）
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const endTs = end.getTime() + offsetDays * dayMs;

    let maxVal = 0;
    const points = [];
    const labels = [];

    // 从左到右：endTs-6d, ..., endTs（今天在最右侧）
    for (let i = 0; i <= 6; i++) {
        const ts = endTs - (6 - i) * dayMs; // i=0 -> -6d ... i=6 -> 0d(今天/窗口终点)
        const d = new Date(ts);
        const v = dailyMap[ts] || 0;

        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        const label = `${mm}/${dd}`;

        labels.push(label);
        points.push({ x: label, y: v, ts, isEnd: i === 6 }); // 右端高亮
        if (v > maxVal) {maxVal = v;}
    }

    const base = CHART_RGB();
    const colorFor = (v, emph) => {
        if (maxVal <= 0) {return `rgba(${base.r},${base.g},${base.b},0.18)`;}
        const t = Math.min(1, v / maxVal);
        const a = 0.18 + 0.82 * Math.sqrt(t);
        const a2 = Math.min(1, a + (emph ? 0.10 : 0));
        return `rgba(${base.r},${base.g},${base.b},${a2})`;
    };

    charts.weekBars = new Chart(ctx, {
        type: 'bar',
        data: {
            datasets: [{
                label: '7 天窗口',
                data: points,
                parsing: { xAxisKey: 'x', yAxisKey: 'y' },
                backgroundColor: (c) => colorFor(c.raw?.y ?? 0, c.raw?.isEnd),
                borderColor: (c) => (c.raw?.isEnd ? COLOR_FG() : 'transparent'),
                borderWidth: (c) => (c.raw?.isEnd ? 1 : 0),
                borderSkipped: false,
                barPercentage: 0.9,
                categoryPercentage: 0.9
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'category',
                    labels,
                    ticks: { color: COLOR_FG(), maxRotation: 0, autoSkip: false },
                    grid: { display: false }
                },
                y: {
                    type: 'linear',
                    beginAtZero: true,
                    ticks: {
                        color: COLOR_FG(),
                        callback: (v) => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v
                    },
                    grid: { color: COLOR_GRID() }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            const ts = items[0]?.raw?.ts;
                            if (!ts) {return '';}
                            const d = new Date(ts);
                            const w = ZH_WEEK[d.getDay()];
                            return `${d.toLocaleDateString()}（周${w}）`;
                        },
                        label: (item) => `字符：${item.raw?.y ?? 0}`
                    }
                }
            },
            animation: false
        }
    });
}

// ============================================================
// 码字日历（卡片格子视图）
// ============================================================

/** 根据 calMonthOffset 获取当前要展示的月份基准日期 */
function getCalRefDate() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + uiState.calMonthOffset, 1);
}

/** 更新月份标签文字 */
function updateCalMonthLabel() {
    const ref = getCalRefDate();
    const label = document.getElementById('calMonthLabel');
    if (label) {
        label.textContent = `${ref.getFullYear()}年${ref.getMonth() + 1}月`;
    }
}

/** 更新月度摘要（本月码字天数 + 累计字符数） */
function updateCalSummary(heatmap) {
    const summary = document.getElementById('calSummary');
    if (!summary || !heatmap) { return; }
    const ref = getCalRefDate();
    const Y = ref.getFullYear();
    const M = ref.getMonth();
    const daysInMonth = new Date(Y, M + 1, 0).getDate();
    let daysWritten = 0;
    let totalChars = 0;
    for (let d = 1; d <= daysInMonth; d++) {
        const ts = new Date(Y, M, d).getTime();
        const v = heatmap[ts] || 0;
        if (v > 0) { daysWritten++; totalChars += v; }
    }
    const charsStr = totalChars >= 10000
        ? (totalChars / 10000).toFixed(1) + '万'
        : totalChars.toLocaleString();
    summary.textContent = `本月已码字${daysWritten}天 · 累计${charsStr}字`;
}

/** 渲染日历卡片格子 */
function drawMonthCalendar(container, heatmap) {
    container.innerHTML = '';
    const ref = getCalRefDate();
    const Y = ref.getFullYear();
    const M = ref.getMonth();
    const dayMs = 24 * 3600 * 1000;
    const daysInMonth = new Date(Y, M + 1, 0).getDate();
    const monthStart = new Date(Y, M, 1).getTime();

    // 星期列头（周一开始）
    const headers = ['一', '二', '三', '四', '五', '六', '日'];
    headers.forEach(h => {
        const cell = document.createElement('div');
        cell.className = 'cal-header-cell';
        cell.textContent = h;
        container.appendChild(cell);
    });

    // 计算当月最大值（用于色阶）
    let maxVal = 0;
    for (let d = 1; d <= daysInMonth; d++) {
        const v = heatmap[new Date(Y, M, d).getTime()] || 0;
        if (v > maxVal) { maxVal = v; }
    }

    // 今天零点时间戳
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const todayTs = todayMidnight.getTime();

    // 第一天是周几（周一=0）
    const firstWeekday = (new Date(monthStart).getDay() + 6) % 7;

    // 前补空格
    for (let i = 0; i < firstWeekday; i++) {
        const empty = document.createElement('div');
        empty.className = 'cal-cell out-month';
        container.appendChild(empty);
    }

    const base = CHART_RGB();

    // 日期格子
    for (let d = 1; d <= daysInMonth; d++) {
        const ts = new Date(Y, M, d).getTime();
        const v = heatmap[ts] || 0;

        // 0字数且不显示0 → 跳过（但仍占格子保持布局）
        const showZero = uiState.showZeroCalCells;
        const cell = document.createElement('div');
        cell.className = 'cal-cell';
        if (ts === todayTs) { cell.classList.add('today'); }

        if (v > 0) {
            cell.classList.add('has-writing');
            const t = Math.min(1, v / Math.max(1, maxVal));
            const a = 0.15 + 0.70 * Math.sqrt(t);
            cell.style.backgroundColor = `rgba(${base.r},${base.g},${base.b},${a.toFixed(3)})`;
        }

        const dayEl = document.createElement('div');
        dayEl.className = 'cal-day';
        dayEl.textContent = d;
        cell.appendChild(dayEl);

        if (v > 0 || showZero) {
            const countEl = document.createElement('div');
            countEl.className = 'cal-count';
            countEl.textContent = v === 0 ? '0' : (v >= 10000 ? (v / 10000).toFixed(1) + '万' : v.toLocaleString());
            cell.appendChild(countEl);
        }
        container.appendChild(cell);
    }
}

/** 根据 calViewMode 显示/隐藏热力图和日历区域，并更新切换按钮状态 */
function applyCalViewMode() {
    const mode = uiState.calViewMode;
    const heatmapSec = document.getElementById('heatmapSection');
    const calSec = document.getElementById('calendarSection');

    if (heatmapSec) { heatmapSec.style.display = (mode === 'heatmap' || mode === 'both') ? '' : 'none'; }
    if (calSec)     { calSec.style.display     = (mode === 'calendar' || mode === 'both') ? '' : 'none'; }

    // 更新按钮高亮
    ['calViewHeatmap', 'calViewCalendar', 'calViewBoth'].forEach(id => {
        const btn = document.getElementById(id);
        if (!btn) { return; }
        const btnMode = id === 'calViewHeatmap' ? 'heatmap' : id === 'calViewCalendar' ? 'calendar' : 'both';
        btn.classList.toggle('view-active', btnMode === mode);
    });
}

/** 重新渲染月度热力图 + 日历（传入 heatmap 数据，或用缓存） */
function rerenderMonthly(heatmap) {
    const data = heatmap || dataCache.heatmap;
    if (!data) { return; }
    const ref = getCalRefDate();

    // 热力图 canvas
    const monthEl = document.getElementById('heatmap');
    if (monthEl) { drawMonthlyHeatmap(monthEl, data, ref); }

    // 日历格子
    const calGrid = document.getElementById('calGrid');
    if (calGrid) { drawMonthCalendar(calGrid, data); }

    // 更新摘要 & 标签
    updateCalMonthLabel();
    updateCalSummary(data);
}

/** 绑定日历区域的视图切换和月份导航控件 */
function bindCalendarControls() {
    updateCalMonthLabel();

    // 视图切换
    function setViewMode(mode) {
        uiState.calViewMode = mode;
        saveState('calViewMode', mode);
        applyCalViewMode();
        // 切换到日历时补充渲染（热力图已经存在不必重绘）
        if ((mode === 'calendar' || mode === 'both') && dataCache.heatmap) {
            const calGrid = document.getElementById('calGrid');
            if (calGrid) { drawMonthCalendar(calGrid, dataCache.heatmap); }
            updateCalSummary(dataCache.heatmap);
        }
    }

    document.getElementById('calViewHeatmap')?.addEventListener('click', () => setViewMode('heatmap'));
    document.getElementById('calViewCalendar')?.addEventListener('click', () => setViewMode('calendar'));
    document.getElementById('calViewBoth')?.addEventListener('click', () => setViewMode('both'));

    // 月份导航
    function applyMonthOffset() {
        saveState('calMonthOffset', uiState.calMonthOffset);
        rerenderMonthly();
    }

    document.getElementById('calPrevMonth')?.addEventListener('click', () => {
        uiState.calMonthOffset -= 1;
        applyMonthOffset();
    });
    document.getElementById('calNextMonth')?.addEventListener('click', () => {
        uiState.calMonthOffset += 1;
        applyMonthOffset();
    });
    document.getElementById('calResetMonth')?.addEventListener('click', () => {
        uiState.calMonthOffset = 0;
        applyMonthOffset();
    });
}

// ============================================================
// 年度热力图
// ============================================================

function getYearRefDate() {
    const now = new Date();
    return new Date(now.getFullYear() + uiState.yearOffset, 0, 1);
}

function drawYearHeatmap(container, heatmap) {
    container.innerHTML = '';
    const tooltip = document.getElementById('yhTooltip');
    const base = CHART_RGB();

    const refDate = getYearRefDate();
    const year = refDate.getFullYear();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTs = today.getTime();

    // 计算年内每天的时间戳 -> 字数 map
    const MONTHS = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
    const WEEKDAYS = ['一','二','三','四','五','六','日'];  // 周一开始
    const dayMs = 86400000;

    // 年第一天和最后一天
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);

    // 周一开始： yearStart 的周天（周一=0）
    const startDow = (yearStart.getDay() + 6) % 7;  // 0=Mon
    // 網格第一格 = yearStart 前的多少天
    const gridStart = new Date(yearStart.getTime() - startDow * dayMs);

    // 总周数
    const daysInYear = (new Date(year, 11, 31).getTime() - gridStart.getTime()) / dayMs + 1;
    const totalWeeks = Math.ceil(daysInYear / 7);

    // 年内最大字数（用于归一化）
    let maxVal = 0;
    for (let d = 0; d < 366; d++) {
        const ts = new Date(year, 0, d + 1).getTime();
        const v = heatmap[ts] || 0;
        if (v > maxVal) { maxVal = v; }
    }

    // —— 设置 grid 列数：1列星期标签 + N列周 ——
    container.style.gridTemplateColumns = `20px repeat(${totalWeeks}, 14px)`;
    container.style.gridTemplateRows = `14px repeat(7, 14px)`;

    // —— 样品行（第一行）：展位占位格 + 月标签 ——
    // 第0列 第0行 = 空
    const corner = document.createElement('div');
    corner.style.gridColumn = '1';
    corner.style.gridRow = '1';
    container.appendChild(corner);

    // 月标签：记录每个月第一周的列索引
    let lastMonthDrawn = -1;
    for (let w = 0; w < totalWeeks; w++) {
        const weekStart = new Date(gridStart.getTime() + w * 7 * dayMs);
        const mo = weekStart.getMonth();
        if (weekStart.getFullYear() === year && mo !== lastMonthDrawn) {
            lastMonthDrawn = mo;
            const lbl = document.createElement('div');
            lbl.className = 'yh-month-label';
            lbl.textContent = MONTHS[mo];
            lbl.style.gridColumn = `${w + 2}`;
            lbl.style.gridRow = '1';
            container.appendChild(lbl);
        }
    }

    // —— 周几标签（左侧）：仅显示一、三、五、日 ——
    [0, 2, 4, 6].forEach(row => {
        const lbl = document.createElement('div');
        lbl.className = 'yh-day-label';
        lbl.textContent = WEEKDAYS[row];
        lbl.style.gridColumn = '1';
        lbl.style.gridRow = `${row + 2}`;
        container.appendChild(lbl);
    });

    // —— 天格子 ——
    for (let w = 0; w < totalWeeks; w++) {
        for (let dow = 0; dow < 7; dow++) {
            const cellDate = new Date(gridStart.getTime() + (w * 7 + dow) * dayMs);
            const cellTs = cellDate.getTime();
            const inYear = cellDate.getFullYear() === year;

            const cell = document.createElement('div');
            cell.className = 'yh-cell';
            cell.style.gridColumn = `${w + 2}`;
            cell.style.gridRow = `${dow + 2}`;

            if (!inYear) {
                cell.style.background = 'transparent';
            } else {
                const v = heatmap[cellTs] || 0;
                if (v > 0) {
                    const t = Math.min(1, v / Math.max(1, maxVal));
                    const a = 0.18 + 0.72 * Math.sqrt(t);
                    cell.style.background = `rgba(${base.r},${base.g},${base.b},${a.toFixed(3)})`;
                }
                if (cellTs === todayTs) { cell.classList.add('yh-today'); }

                // tooltip
                if (tooltip) {
                    const v = heatmap[cellTs] || 0;
                    const dateStr = `${year}年${cellDate.getMonth()+1}月${cellDate.getDate()}日`;
                    const countStr = v === 0 ? '无记录' : `${v.toLocaleString()} 字`;
                    cell.addEventListener('mouseenter', (e) => {
                        tooltip.textContent = `${dateStr}\u2003${countStr}`;
                        tooltip.classList.add('visible');
                    });
                    cell.addEventListener('mousemove', (e) => {
                        tooltip.style.left = (e.clientX + 14) + 'px';
                        tooltip.style.top  = (e.clientY - 28) + 'px';
                    });
                    cell.addEventListener('mouseleave', () => {
                        tooltip.classList.remove('visible');
                    });
                }
            }
            container.appendChild(cell);
        }
    }

    // —— 跟新色彩重绘 ——
    updateYearHeatmapLabel();
    updateYearSummary(heatmap);
}

function updateYearHeatmapLabel() {
    const lbl = document.getElementById('yhYearLabel');
    if (lbl) {
        const ref = getYearRefDate();
        lbl.textContent = ref.getFullYear() + '年';
    }
}

function updateYearSummary(heatmap) {
    const el = document.getElementById('yearSummary');
    if (!el || !heatmap) { return; }
    const year = getYearRefDate().getFullYear();
    let totalChars = 0;
    let writingDays = 0;
    for (let d = 0; d < 366; d++) {
        const ts = new Date(year, 0, d + 1).getTime();
        if (new Date(ts).getFullYear() !== year) { break; }
        const v = heatmap[ts] || 0;
        if (v > 0) { totalChars += v; writingDays++; }
    }
    const fmt = totalChars >= 10000 ? (totalChars / 10000).toFixed(1) + '万字' : totalChars.toLocaleString() + '字';
    el.textContent = `${year}年共码字 ${writingDays} 天，累计 ${fmt}`;
}

function rerenderYearHeatmap(heatmap) {
    const data = heatmap || dataCache.heatmap;
    if (!data) { return; }
    const grid = document.getElementById('yearHeatmapGrid');
    if (grid) { drawYearHeatmap(grid, data); }
}

function bindYearHeatmapControls() {
    updateYearHeatmapLabel();
    function applyYear() {
        saveState('yearOffset', uiState.yearOffset);
        rerenderYearHeatmap();
    }
    document.getElementById('yhPrevYear')?.addEventListener('click', () => { uiState.yearOffset -= 1; applyYear(); });
    document.getElementById('yhNextYear')?.addEventListener('click', () => { uiState.yearOffset += 1; applyYear(); });
    document.getElementById('yhResetYear')?.addEventListener('click', () => { uiState.yearOffset = 0; applyYear(); });
}

// ============================================================
// 设置面板：色系 + 组件可见性 + 0字数显示
// ============================================================

/** 计算颜色亮度，返回 0~1 */
function luminance(r, g, b) {
    const toLinear = c => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** 将背景色调暗/调亮一定比例，生成 hover 色 */
function shadeHex(hex, amount) {
    const rgb = hexToRgb(hex);
    if (!rgb) { return hex; }
    const clamp = v => Math.min(255, Math.max(0, Math.round(v)));
    return rgbToHex({ r: clamp(rgb.r + amount), g: clamp(rgb.g + amount), b: clamp(rgb.b + amount) });
}

/**
 * 应用按钮色系
 * @param {string} value  'vscode' 或 '#rrggbb'
 */
function applyBtnColor(value) {
    uiState.btnColor = value;
    saveState('btnColor', value);
    const root = document.documentElement;
    if (value === 'vscode') {
        // 清除自定义覆盖，回退到 CSS :root 中的 var(--vscode-button-*)
        root.style.removeProperty('--btn-bg');
        root.style.removeProperty('--btn-fg');
        root.style.removeProperty('--btn-hover-bg');
        root.style.removeProperty('--btn2-bg');
        root.style.removeProperty('--btn2-fg');
        root.style.removeProperty('--btn2-hover-bg');
    } else {
        const rgb = hexToRgb(value);
        if (!rgb) { return; }
        const lum = luminance(rgb.r, rgb.g, rgb.b);
        const fg = lum > 0.35 ? '#111111' : '#ffffff';
        const hoverHex = shadeHex(value, lum > 0.35 ? -24 : 24);
        // 次级按钮：降低不透明度的同色系
        const btn2Bg = shadeHex(value, lum > 0.35 ? -48 : 40) + '55'; // 带透明
        root.style.setProperty('--btn-bg',        value);
        root.style.setProperty('--btn-fg',        fg);
        root.style.setProperty('--btn-hover-bg',  hoverHex);
        root.style.setProperty('--btn2-bg',       `rgba(${rgb.r},${rgb.g},${rgb.b},0.18)`);
        root.style.setProperty('--btn2-fg',       value);
        root.style.setProperty('--btn2-hover-bg', `rgba(${rgb.r},${rgb.g},${rgb.b},0.30)`);
    }
}

/** 将 {r,g,b} 应用到 CSS 变量（驱动日历/图表颜色）并存储 */
function applyChartColor(val) {
    uiState.chartColor = val;
    saveState('chartColor', typeof val === 'string' ? val : JSON.stringify(val));
    const rgb = resolveChartRgb();
    const root = document.documentElement;
    root.style.setProperty('--chart-r', rgb.r);
    root.style.setProperty('--chart-g', rgb.g);
    root.style.setProperty('--chart-b', rgb.b);
    root.style.setProperty('--chart-color', `rgb(${rgb.r},${rgb.g},${rgb.b})`);
    // 重绘全部图表
    if (dataCache.perFileLine)        { rerenderLine(); }
    if (dataCache.todayHourly)        { drawTodayBars(document.getElementById('todayBars'), dataCache.todayHourly); }
    if (dataCache.todayQuarterHourly) { drawTodayHeatmap(document.getElementById('todayHeatmap'), dataCache.todayQuarterHourly); }
    if (dataCache.heatmap)            { rerenderMonthly(dataCache.heatmap); rerenderWeekBars(); rerenderYearHeatmap(dataCache.heatmap); }
}

/** 根据 sectionVisible 更新 DOM 显示/隐藏 */
function applySectionVisibility() {
    Object.entries(uiState.sectionVisible).forEach(([sec, visible]) => {
        const el = document.querySelector(`[data-section="${sec}"]`);
        if (el) { el.classList.toggle('section-hidden', !visible); }
    });
}

const SEC_LABELS = {
    secLine: '速度曲线', secTodayBars: '今日按小时',
    secTodayHeatmap: '今日热力图', secWeek: '7天窗口', secMonthly: '月度统计', secYearHeatmap: '年热力图'
};

/** 按 uiState.sectionOrder 重排 #sectionsContainer 内的子节点 */
function applySectionOrder() {
    const container = document.getElementById('sectionsContainer');
    if (!container) { return; }
    uiState.sectionOrder.forEach(secId => {
        const el = container.querySelector(`[data-section="${secId}"]`);
        if (el) { container.appendChild(el); }
    });
}

/** 生成设置面板中可拖拽的面板顺序芯片 */
function buildSectionOrderUI() {
    const list = document.getElementById('sectionOrderList');
    if (!list) { return; }
    list.innerHTML = '';
    uiState.sectionOrder.forEach(secId => {
        const chip = document.createElement('div');
        chip.className = 'section-chip';
        chip.draggable = true;
        chip.dataset.secOrder = secId;
        chip.innerHTML = `<span class="drag-handle-icon">⠿</span>${SEC_LABELS[secId] || secId}`;
        list.appendChild(chip);
    });
    bindChipDrag(list);
}

/** 绑定芯片列表的 HTML5 拖拽排序 */
function bindChipDrag(list) {
    let dragSrc = null;
    list.addEventListener('dragstart', e => {
        const chip = e.target.closest('.section-chip');
        if (!chip) { return; }
        dragSrc = chip;
        e.dataTransfer.effectAllowed = 'move';
    });
    list.addEventListener('dragover', e => {
        e.preventDefault();
        const chip = e.target.closest('.section-chip');
        if (!chip || chip === dragSrc) { return; }
        list.querySelectorAll('.section-chip').forEach(c => c.classList.remove('drag-over'));
        chip.classList.add('drag-over');
        e.dataTransfer.dropEffect = 'move';
    });
    list.addEventListener('dragleave', e => {
        const chip = e.target.closest('.section-chip');
        if (chip) { chip.classList.remove('drag-over'); }
    });
    list.addEventListener('drop', e => {
        e.preventDefault();
        const chip = e.target.closest('.section-chip');
        if (!chip || chip === dragSrc) { return; }
        chip.classList.remove('drag-over');
        const chips = [...list.querySelectorAll('.section-chip')];
        const srcIdx = chips.indexOf(dragSrc);
        const dstIdx = chips.indexOf(chip);
        if (srcIdx < dstIdx) { chip.after(dragSrc); } else { chip.before(dragSrc); }
        const newOrder = [...list.querySelectorAll('.section-chip')].map(c => c.dataset.secOrder);
        uiState.sectionOrder = newOrder;
        saveState('sectionOrder', JSON.stringify(newOrder));
        applySectionOrder();
    });
    list.addEventListener('dragend', () => {
        list.querySelectorAll('.section-chip').forEach(c => c.classList.remove('drag-over'));
        dragSrc = null;
    });
}

/** hex "#rrggbb" → {r,g,b} */
function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

/** {r,g,b} → "#rrggbb" */
function rgbToHex({ r, g, b }) {
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function bindSettingsPanel() {
    const btn = document.getElementById('btnSettings');
    const drawer = document.getElementById('settingsDrawer');
    if (!btn || !drawer) { return; }

    // 齿轮按钮开关
    btn.addEventListener('click', () => {
        drawer.classList.toggle('open');
    });

    // ——— 初始化颜色选择器 ———
    const picker = document.getElementById('colorPicker');
    if (picker) {
        picker.value = rgbToHex(resolveChartRgb());
        picker.addEventListener('input', () => {
            const rgb = hexToRgb(picker.value);
            if (rgb) {
                // 同步取消色样高亮
                document.querySelectorAll('#colorSwatches .color-swatch')
                    .forEach(s => s.classList.remove('swatch-active'));
                applyChartColor(rgb);
            }
        });
    }

    // ——— 初始化色样 ———
    const swatchContainer = document.getElementById('colorSwatches');
    if (swatchContainer) {
        // 标记当前激活的色样
        function syncSwatchActive(val) {
            swatchContainer.querySelectorAll('.color-swatch').forEach(s => {
                if (s.dataset.chartPreset === 'vscode') {
                    s.classList.toggle('swatch-active', val === 'vscode');
                } else {
                    s.classList.toggle('swatch-active',
                        typeof val === 'object' && +s.dataset.r === val.r && +s.dataset.g === val.g && +s.dataset.b === val.b);
                }
            });
        }
        syncSwatchActive(uiState.chartColor);

        swatchContainer.addEventListener('click', (e) => {
            const swatch = e.target.closest('.color-swatch');
            if (!swatch) { return; }
            if (swatch.dataset.chartPreset === 'vscode') {
                syncSwatchActive('vscode');
                applyChartColor('vscode');
            } else {
                const rgb = { r: +swatch.dataset.r, g: +swatch.dataset.g, b: +swatch.dataset.b };
                syncSwatchActive(rgb);
                if (picker) { picker.value = rgbToHex(rgb); }
                applyChartColor(rgb);
            }
        });
    }

    // ——— 初始化"显示0字数"复选框 ———
    const showZeroChk = document.getElementById('calShowZero');
    if (showZeroChk) {
        showZeroChk.checked = uiState.showZeroCalCells;
        showZeroChk.addEventListener('change', () => {
            uiState.showZeroCalCells = showZeroChk.checked;
            saveState('showZeroCalCells', String(showZeroChk.checked));
            if (dataCache.heatmap) { rerenderMonthly(dataCache.heatmap); }
        });
    }

    // ——— 初始化组件可见性复选框 ———
    document.querySelectorAll('.section-toggle-row input[data-sec]').forEach(chk => {
        const sec = chk.dataset.sec;
        // 恢复持久化的状态
        if (sec in uiState.sectionVisible) {
            chk.checked = uiState.sectionVisible[sec];
        }
        chk.addEventListener('change', () => {
            uiState.sectionVisible[sec] = chk.checked;
            saveState('sectionVisible', JSON.stringify(uiState.sectionVisible));
            applySectionVisibility();
        });
    });

    // ——— 页面加载时同步 CSS 变量 ———
    applyChartColor(uiState.chartColor);
    applyBtnColor(uiState.btnColor);

    // ——— 按钮色系色样 ———
    const btnSwatchContainer = document.getElementById('btnColorSwatches');
    const btnPicker = document.getElementById('btnColorPicker');

    function syncBtnSwatchActive(value) {
        btnSwatchContainer?.querySelectorAll('.color-swatch').forEach(s => {
            const isPreset = s.dataset.btnPreset === 'vscode' ? value === 'vscode' : s.dataset.btnHex === value;
            s.classList.toggle('swatch-active', isPreset);
        });
    }

    if (btnSwatchContainer) {
        syncBtnSwatchActive(uiState.btnColor);
        btnSwatchContainer.addEventListener('click', (e) => {
            const swatch = e.target.closest('.color-swatch');
            if (!swatch) { return; }
            const value = swatch.dataset.btnPreset === 'vscode' ? 'vscode' : swatch.dataset.btnHex;
            if (!value) { return; }
            syncBtnSwatchActive(value);
            if (btnPicker && value !== 'vscode') { btnPicker.value = value; }
            applyBtnColor(value);
        });
    }

    if (btnPicker) {
        if (uiState.btnColor !== 'vscode') { btnPicker.value = uiState.btnColor; }
        btnPicker.addEventListener('input', () => {
            btnSwatchContainer?.querySelectorAll('.color-swatch')
                .forEach(s => s.classList.remove('swatch-active'));
            applyBtnColor(btnPicker.value);
        });
    }

    // ——— 初始化面板排序 UI ———
    buildSectionOrderUI();
}
