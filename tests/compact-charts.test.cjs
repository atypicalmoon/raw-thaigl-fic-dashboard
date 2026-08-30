const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');
const d3 = require('../vendor/d3.v7.min.js');

const read = path => readFileSync(join(__dirname, '..', path), 'utf8');
const monthlySource = read('reports/cp-report.js');
const dashboardSource = read('script.js');
const geometryScope = {};
runInNewContext(monthlySource.slice(monthlySource.indexOf('function monthChartGeometry('), monthlySource.indexOf('  const months=')), geometryScope);
const { monthChartGeometry } = geometryScope;
const tickScope = {};
runInNewContext(dashboardSource.slice(dashboardSource.indexOf('function cpProfileXTicks('), dashboardSource.indexOf('function drawCpBar(')), tickScope);
const tickValues = (max, compact) => Array.from(tickScope.cpProfileXTicks(d3.scaleSqrt().domain([0, max]).nice(), compact));
const dataScope = { window: {} };
runInNewContext(read('reports/cp-report-data.js'), dataScope);
const reports = dataScope.window.CP_REPORT_DATA;

// 执行真实报告渲染入口，DOM 桩只提供尺寸和写入目标。
function renderReport(data, width = 267.2, height = 160) {
    const svg = { innerHTML: '', attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getBoundingClientRect: () => ({ width, height }) };
    const main = { innerHTML: '', classList: { remove() {} }, querySelector: () => svg };
    const scratch = { set innerHTML(v) { this.value = v; } };
    let redraw;
    const scope = {
        window: { CP_REPORT_DATA: { sample: structuredClone(data) }, matchMedia: () => ({ matches: width < 640 }) },
        document: { createElement: () => scratch, querySelector: selector => selector === 'main' ? main : {} },
        location: { search: '?cp=sample' }, URLSearchParams,
        ResizeObserver: class { constructor(callback) { redraw = callback; } observe() {} }
    };
    runInNewContext(monthlySource.slice(0, monthlySource.indexOf('/* =========================================================')), scope);
    return { main, svg, resize(w, h) { width = w; height = h; redraw(); } };
}

test('月度图使用当年上限、零基线与真实手机高度', () => {
    const g = monthChartGeometry([201, 157, 245, 225, 217, 181, 204, 198], 267.2, 160, true);
    assert.equal(g.maximum, 300);
    assert.equal(g.bottom, 120);
    assert.equal(g.points[0].x, 14);
    assert.equal(g.points.at(-1).x, 253.2);
    assert.ok(g.points[1].y - g.points[2].y > 27);
    assert.equal(monthChartGeometry([0], 267.2, 160, true).points[0].y, 120);
});

test('零数据、单月和低产出月份不出现无效坐标', () => {
    for (const values of [[], [0], [1], [0, 2, 0], Array(12).fill(0)]) {
        const g = monthChartGeometry(values, 267.2, 160, true);
        assert.ok(g.maximum >= 1);
        assert.ok(g.points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && p.y >= g.top && p.y <= g.bottom));
        if (values.length === 1) assert.equal(g.points[0].x, 133.6);
    }
    assert.equal(monthChartGeometry([0, 2, 0], 267.2, 160, true).maximum, 3);
});

test('12 个月首尾标注保留边距，手机和平板桌面均有界', () => {
    for (const [width, height, compact] of [[267.2, 160, true], [337.6, 160, true], [687.2, 170.075, false], [1054.4, 226, false]]) {
        const g = monthChartGeometry(Array.from({ length: 12 }, (_, i) => i * 32), width, height, compact);
        assert.ok(g.points.every(p => p.x >= 14 && p.x <= width - 14 && p.y >= g.top));
        assert.equal(g.points.length, 12);
    }
});

test('所有 CP 的当年月数、数值和累计文案对应原始报告数据', () => {
    for (const data of Object.values(reports)) {
        const { main, svg } = renderReport(data);
        const year = Number(data.currentYearLabel);
        const count = Number(data.end.split('-')[1]);
        const expected = Array.from({ length: count }, (_, i) => data.months[`${year}-${String(i + 1).padStart(2, '0')}`] || 0);
        const actual = Array.from(svg.innerHTML.matchAll(/class="month-value"[^>]*>([^<]+)</g), m => Number(m[1].replaceAll(',', '')));
        assert.deepEqual(actual, expected, data.cp);
        assert.equal(expected.reduce((a, b) => a + b, 0), data.currentYear, data.cp);
        assert.match(main.innerHTML, /月度新增/);
        assert.match(main.innerHTML, /按首发月统计/);
        assert.doesNotMatch(svg.innerHTML, /NaN|Infinity/);
    }
});

test('未完整月份仅末段虚线，完整月份没有未完整提示', () => {
    const partial = renderReport({ ...reports.LingOrm, end: '2026-08-29' });
    assert.equal((partial.svg.innerHTML.match(/class="month-line partial-line"/g) || []).length, 1);
    assert.equal((partial.svg.innerHTML.match(/class="month-point partial-point"/g) || []).length, 1);
    assert.match(partial.main.innerHTML, /8 月未完整（虚线）/);
    assert.match(partial.main.innerHTML, new RegExp(`截至 8\\/29 共 ${reports.LingOrm.currentYear.toLocaleString('zh-CN')} 篇`));
    const complete = renderReport({ ...reports.LingOrm, end: '2026-08-31' });
    assert.doesNotMatch(complete.svg.innerHTML, /partial-line|partial-point/);
    assert.doesNotMatch(complete.main.innerHTML, /未完整/);
});

test('1 月单点及闰年月底正常渲染，尺寸变化会重绘而不累计节点', () => {
    const january = renderReport({ ...reports.LingOrm, end: '2026-01-15' });
    assert.equal((january.svg.innerHTML.match(/class="month-value"/g) || []).length, 1);
    assert.doesNotMatch(january.svg.innerHTML, /NaN|Infinity/);
    january.resize(1054.4, 226);
    assert.equal(january.svg.attrs.viewBox, '0 0 1054.4 226');
    assert.equal((january.svg.innerHTML.match(/class="month-value"/g) || []).length, 1);
    const leap = { ...reports.LingOrm, currentYearLabel: 2024, end: '2024-02-29' };
    assert.doesNotMatch(renderReport(leap).svg.innerHTML, /partial-line/);
    assert.match(renderReport({ ...leap, end: '2024-02-28' }).svg.innerHTML, /partial-line/);
});

test('散点手机横轴精简为 0 / 1k / 3k / 5k，桌面保留更多刻度', () => {
    assert.deepEqual(tickValues(5437, true), [0, 1000, 3000, 5000]);
    assert.deepEqual(tickValues(5437, false), [0, 1000, 2000, 3000, 4000, 5000]);
});

test('少量作品或大数量筛选下，散点横轴刻度仍是非负整数且有序', () => {
    for (const maximum of [1, 2, 3, 8, 21, 137, 5437, 21196, 1000000]) {
        for (const compact of [true, false]) {
            const ticks = tickValues(maximum, compact);
            assert.equal(ticks[0], 0);
            assert.ok(ticks.every((n, i) => Number.isInteger(n) && n >= 0 && (!i || n > ticks[i - 1])));
        }
    }
});

test('紧凑外观约束：手机小字、固定比例、短轴说明和淡色描边', () => {
    const html = read('reports/cp.html');
    assert.match(html, /aspect-ratio:800\/198/);
    assert.match(html, /\.month-value\{font-size:9px\}/);
    assert.match(html, /\.month-label\{font-size:8\.5px\}/);
    assert.match(read('index.html'), /横轴：作品数 · 纵轴：点赞前 10% 门槛/);
    assert.match(dashboardSource, /\.attr\("stroke", "#b9aab1"\)\.attr\("stroke-opacity", \.6\)\.attr\("stroke-width", \.65\)/);
});

test('半年报告表格横向滚动时固定 CP 首列', () => {
    const css = read('reports/report.css');
    assert.match(css, /thead th:first-child\{left:0;z-index:4/);
    assert.match(css, /tbody th:first-child\{position:sticky;left:0;z-index:2/);
    assert.match(read('reports/report.html'), /report\.css\?v=[a-f0-9]{12}/);
    assert.match(read('reports/index.html'), /report\.css\?v=[a-f0-9]{12}/);
});
