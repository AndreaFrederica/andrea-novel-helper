/* time-stats.js — Chart.js 版本 */
const vscode = acquireVsCodeApi();

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

// 用于主题 &网格配色
const COLOR_FG = () => cssVar('--fg', '#aab');
const COLOR_GRID = () => cssVar('--grid', '#556'); // 若无此变量，Chart.js 会回落到默认
const COLOR_ACCENT = () => cssVar('--accent', '#66aaff');

// 统一管理/销毁图表实例，避免重复创建导致的内存泄露
const charts = {
    line: null,
    todayBars: null,
    todayHeatmap: null,
    yearlyHeatmap: null,
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
    requestStatsData();
    // 每 1 秒刷新一次
    setInterval(requestStatsData, 1 * 1000);
});

window.addEventListener('message', (e) => {
    const data = e.data;
    if (!data) return;

    if (data.type !== 'time-stats-data') return;

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
        drawLineChart(document.getElementById('lineChart'), newPerFileLine);
        dataCache.perFileLine = JSON.parse(JSON.stringify(newPerFileLine));
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
        // 周柱状图（需要在 HTML 里新增 <canvas id="weekBars">）
        const weekEl = document.getElementById('weekBars');
        if (weekEl) {
            drawThisWeekBars(weekEl, newHeatmap);
        }

        // 月热力图（沿用 server 传来的 daily heatmap）
        const monthEl = document.getElementById('heatmap');
        if (monthEl) {
            drawMonthlyHeatmap(monthEl, newHeatmap, new Date());
        }
        
        dataCache.heatmap = JSON.parse(JSON.stringify(newHeatmap));
    }
});

// // ===== 折线图：每分钟 CPM 变化（perFileLine） =====
// function drawLineChart(canvas, rows) {
//     destroyChart('line');
//     const ctx = canvas.getContext('2d');

//     // 筛出 x/y
//     const labels = rows.map(r => new Date(r.t));
//     const values = rows.map(r => r.cpm ?? 0);

//     const dsColor = COLOR_ACCENT();

//     charts.line = new Chart(ctx, {
//         type: 'line',
//         data: {
//             labels,
//             datasets: [{
//                 label: 'CPM',
//                 data: values,
//                 borderColor: dsColor,
//                 backgroundColor: dsColor,
//                 pointRadius: 0,
//                 tension: 0.25,
//                 borderWidth: 2,
//             }]
//         },
//         options: {
//             responsive: true,
//             maintainAspectRatio: false,
//             parsing: false,
//             scales: {
//                 x: {
//                     type: 'time',
//                     time: { unit: 'minute' },
//                     ticks: {
//                         color: COLOR_FG(),
//                         autoSkip: true,
//                         maxTicksLimit: 8,
//                         // 直接用本地格式化为 24h，避免 a.m./p.m.
//                         callback: (v) => new Date(v).toLocaleTimeString([], {
//                             hour: '2-digit', minute: '2-digit', hour12: false
//                         })
//                     },
//                     grid: { color: 'rgba(127,127,127,0.15)' }
//                 },
//                 y: {
//                     beginAtZero: true,
//                     ticks: { color: COLOR_FG() },
//                     grid: { color: 'rgba(127,127,127,0.15)' },
//                     title: { display: true, text: 'CPM', color: COLOR_FG() },
//                     suggestedMax: Math.max(60, ...values) // 让曲线不贴边
//                 }
//             },
//             layout: { padding: 4 },
//             animation: false,

//             plugins: {
//                 legend: { display: false },
//                 tooltip: {
//                     callbacks: {
//                         title: (items) => {
//                             const d = items[0]?.label;
//                             return d ? `时间：${d}` : '';
//                         },
//                         label: (item) => `CPM：${item.raw}`
//                     }
//                 }
//             }
//         }
//     });
// }

function drawLineChart(canvas, rows) {
    destroyChart('line');
    if (!canvas) return;                       // 防空
    const ctx = canvas.getContext('2d');

    // rows: [{ t: 时间戳/ISO, cpm: number }]
    const points = rows.map(r => ({ x: new Date(r.t), y: r.cpm ?? 0 }));
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
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,

            // 显式解析 {x,y}
            parsing: { xAxisKey: 'x', yAxisKey: 'y' },

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
                    suggestedMax: Math.max(60, ...points.map(p => p.y))
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

// ===== “矩阵式”热力图：今日 24×4（15 分钟粒度） =====
// function drawTodayHeatmap(canvas, quarterHourly) {
//     destroyChart('todayHeatmap');
//     const ctx = canvas.getContext('2d');

//     // 24 小时 * 4 刻度，共 96 点
//     // 用“条形图”模拟矩阵：y 轴为 4 个刻度，x 轴为 24 小时。
//     const yLabels = ['00', '15', '30', '45'];
//     const xLabels = Array.from({ length: 24 }, (_, h) => h);

//     // 找最大值用于颜色映射
//     let maxVal = 0;
//     const values = [];
//     for (let h = 0; h < 24; h++) {
//         for (let q = 0; q < 4; q++) {
//             const idx = h * 4 + q;
//             const v = quarterHourly[idx] || 0;
//             values.push({ h, q, v });
//             if (v > maxVal) maxVal = v;
//         }
//     }
//     // 生成每个“格子”的颜色（浅->深）
//     const base = { r: 102, g: 170, b: 255 }; // #66aaff
//     function colorFor(v) {
//         if (maxVal <= 0) return `rgba(${base.r},${base.g},${base.b},0.15)`;
//         const t = clamp01(v / maxVal);
//         const a = lerp(0.15, 1.0, Math.sqrt(t));
//         return `rgba(${base.r},${base.g},${base.b},${a})`;
//     }

//     // 我们创建 4 个数据集（对应 y=00/15/30/45），每个数据集 24 个柱子
//     const datasets = yLabels.map((ylab, q) => ({
//         label: `: ${ylab}`,
//         data: xLabels.map((h) => {
//             const v = quarterHourly[h * 4 + q] || 0;
//             return {
//                 x: h,
//                 y: yLabels[q],   // 类别刻度
//                 v,
//             };
//         }),
//         parsing: {
//             xAxisKey: 'x',
//             yAxisKey: 'y',
//         },
//         borderWidth: 1,
//         borderColor: 'transparent',
//         backgroundColor: (ctx) => {
//             const v = ctx.raw?.v ?? 0;
//             return colorFor(v);
//         },
//         // 调小条宽，看起来更接近方块
//         barPercentage: 1.0,
//         categoryPercentage: 1.0,
//     }));

//     charts.todayHeatmap = new Chart(ctx, {
//         type: 'bar',
//         data: { datasets },
//         options: {
//             responsive: true,
//             maintainAspectRatio: false,
//             indexAxis: 'x',
//             scales: {
//                 x: {
//                     type: 'linear',
//                     min: 0,
//                     max: 23,
//                     ticks: {
//                         color: COLOR_FG(),
//                         stepSize: 1,
//                         callback: (v) => String(v).padStart(2, '0')
//                     },
//                     grid: { display: false },
//                     stacked: true,
//                 },
//                 y: {
//                     type: 'category',
//                     labels: yLabels,
//                     ticks: { color: COLOR_FG() },
//                     grid: { display: false },
//                     stacked: true,
//                 }
//             },
//             plugins: {
//                 legend: { display: false },
//                 tooltip: {
//                     callbacks: {
//                         title: (items) => {
//                             const h = items[0]?.raw?.x ?? 0;
//                             const q = items[0]?.raw?.y ?? '00';
//                             return `时间 ${String(h).padStart(2, '0')}:${q}`;
//                         },
//                         label: (item) => `字符：${item.raw?.v ?? 0}`
//                     }
//                 }
//             }
//         }
//     });
// }
// ===== “矩阵式”热力图：今日 24×4（15 分钟粒度，修正版） =====
function drawTodayHeatmap(canvas, quarterHourly) {
    destroyChart('todayHeatmap');
    const ctx = canvas.getContext('2d');

    const yLabels = ['00', '15', '30', '45']; // 4 行
    const hours = Array.from({ length: 24 }, (_, h) => h);

    // 颜色映射
    let maxVal = 0;
    for (let i = 0; i < 96; i++) maxVal = Math.max(maxVal, quarterHourly[i] || 0);
    const base = { r: 102, g: 170, b: 255 };
    const colorFor = (v) => {
        if (maxVal <= 0) return `rgba(${base.r},${base.g},${base.b},0.15)`;
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
            if (!ca) return;
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
            if (!out && v > maxVal) maxVal = v;
        }
    }

    // 颜色映射
    const base = { r: 102, g: 170, b: 255 };
    const colorFor = (v, out) => {
        if (maxVal <= 0) return `rgba(${base.r},${base.g},${base.b},${out ? 0.08 : 0.15})`;
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
            if (!ca) return;
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

function drawThisWeekBars(canvas, dailyMap) {
    destroyChart('weekBars');
    const ctx = canvas.getContext('2d');

    const dayMs = 24 * 3600 * 1000;
    const yLabels = ['一', '二', '三', '四', '五', '六', '日'];

    // —— 计算本周（周一为 0）——
    const now = new Date();
    const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekdayMon0 = (new Date(today0).getDay() + 6) % 7;
    const weekStart = today0 - weekdayMon0 * dayMs;

    // 组装 7 天数据
    let maxVal = 0;
    const points = [];
    for (let i = 0; i < 7; i++) {
        const ts = weekStart + i * dayMs;
        const v = dailyMap[ts] || 0;
        points.push({ x: `周${yLabels[i]}`, y: v, ts, isToday: i === weekdayMon0 });
        if (v > maxVal) maxVal = v;
    }

    // 颜色映射（和你热力图同风格）
    const base = { r: 102, g: 170, b: 255 };
    const colorFor = (v, emph) => {
        if (maxVal <= 0) return `rgba(${base.r},${base.g},${base.b},0.18)`;
        const t = Math.min(1, v / maxVal);
        const a = 0.18 + 0.82 * Math.sqrt(t);
        // 今天稍微强调一点透明度
        const a2 = Math.min(1, a + (emph ? 0.10 : 0));
        return `rgba(${base.r},${base.g},${base.b},${a2})`;
    };

    charts.weekBars = new Chart(ctx, {
        type: 'bar',
        data: {
            datasets: [{
                label: '本周',
                data: points,
                parsing: { xAxisKey: 'x', yAxisKey: 'y' },
                backgroundColor: (c) => {
                    const raw = c.raw || {};
                    return colorFor(raw.y ?? 0, raw.isToday);
                },
                borderColor: (c) => (c.raw?.isToday ? COLOR_FG() : 'transparent'),
                borderWidth: (c) => (c.raw?.isToday ? 1 : 0),
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
                    labels: points.map(p => p.x),
                    ticks: { color: COLOR_FG() },
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
                            return ts ? new Date(ts).toLocaleDateString() : '';
                        },
                        label: (item) => `字符：${item.raw?.y ?? 0}`
                    }
                }
            },
            animation: false
        }
    });
}
