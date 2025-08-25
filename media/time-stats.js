/* time-stats.js — Chart.js 版本 */
const vscode = acquireVsCodeApi();

// ====== 常量与持久化键 ======
const LS_PREFIX = 'ANH_TIME_';
const PRESET_VALUES = [15, 30, 60, 120];     // 预设列表（最大 2 小时）
const CUSTOM_MIN = 15;                       // 自定义最小 15 分
const CUSTOM_MAX = 1440;                     // 自定义最大 24 小时

// —— 交互状态（带持久化） —— //
const uiState = {
    rangeMode: localStorage.getItem(LS_PREFIX + 'rangeMode') || 'full',          // 'full' | 'recent'
    gapPolicy: localStorage.getItem(LS_PREFIX + 'gapPolicy') || 'zero',          // 'zero' | 'break'
    continuityGapMinutes: +(localStorage.getItem(LS_PREFIX + 'continuityGapMinutes')
        || document.body.dataset.continuityGapMinutes
        || 120),
    // 新增：周图的“日偏移”，单位=天。0 表示“今天在最右侧”。
    weekOffsetDays: +(localStorage.getItem(LS_PREFIX + 'weekOffsetDays') || 0),
    weekButtonPressed: false,
    weekButtonLast: null
};

function saveState(key, val) { localStorage.setItem(LS_PREFIX + key, String(val)); }

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
const COLOR_GRID = () => cssVar('--grid', '#556'); // 若无此变量，Chart.js 会回落到默认
const COLOR_ACCENT = () => cssVar('--accent', '#66aaff');

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
    document.getElementById('k_today_avg').textContent = (data.today.avgCPM ?? 0) + ' CPM';
    document.getElementById('k_today_peak').textContent = (data.today.peakCPM ?? 0) + ' CPM';
    document.getElementById('scopeTag').textContent = data.supportsGlobal ? '跨文件汇总' : '仅当前文件';

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
        const monthEl = document.getElementById('heatmap');
        if (monthEl) {
            drawMonthlyHeatmap(monthEl, newHeatmap, new Date());
        }
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
    const base = { r: 102, g: 170, b: 255 };
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
    const base = { r: 102, g: 170, b: 255 };
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

    const base = { r: 102, g: 170, b: 255 };
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
