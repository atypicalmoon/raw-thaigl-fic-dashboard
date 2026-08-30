const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { runInNewContext } = require('node:vm');
const { test } = require('node:test');

const source = readFileSync(join(__dirname, '../script.js'), 'utf8');
const scope = {};
runInNewContext(source.slice(source.indexOf('function continuousMonths('), source.indexOf('function showTooltip(')), scope);
const months = (rows, range, cutoff) => Array.from(scope.growthMonthDomain(rows, range, cutoff));

test('近两年包含截止月，共 24 个月，且跨年连续', () => {
    const actual = months([], '24', '2026-08-29 13:26');
    assert.equal(actual.length, 24);
    assert.equal(actual[0], '2024-09');
    assert.equal(actual.at(-1), '2026-08');
    assert.deepEqual(actual.slice(3, 5), ['2024-12', '2025-01']);
});

test('近一年包含截止月，共 12 个月', () => {
    const actual = months([], '12', '2026-01-31');
    assert.equal(actual.length, 12);
    assert.equal(actual[0], '2025-02');
    assert.equal(actual.at(-1), '2026-01');
});

test('CP 停更不会把最近区间退回历史月份', () => {
    assert.equal(months([{ month_year: '2020-03' }], '24', '2026-08-29').at(-1), '2026-08');
});

test('全历史保留首尾月份并补齐空月', () => {
    assert.deepEqual(months([{ month_year: '2025-03' }, { month_year: '2024-12' }], 'all', '2026-08-29'), ['2024-12', '2025-01', '2025-02', '2025-03']);
});

test('单月历史不丢失，空数据不制造日期', () => {
    assert.deepEqual(months([{ month_year: '2018-09' }], 'all'), ['2018-09']);
    assert.deepEqual(months([], 'all'), []);
    assert.deepEqual(months([], '24'), []);
});

test('无截止信息时取数据的最新月，不依赖系统日期', () => {
    assert.equal(months([{ month_year: '2024-01' }, { month_year: '2025-02' }], '12').at(-1), '2025-02');
});

test('默认近两年、Top 10，不按手机宽度降低曲线数量', () => {
    const html = readFileSync(join(__dirname, '../index.html'), 'utf8');
    assert.match(html, /id="growthRangeSelect"[^>]*>[\s\S]*?<option value="24" selected>/);
    assert.match(html, /id="growthTopNSelect"[^>]*><option value="10" selected>/);
    assert.match(html, /id="growthTotalScroll"/);
    assert.match(html, /id="growthCpScroll"/);
});
