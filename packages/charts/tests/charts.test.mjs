import test from 'node:test';
import assert from 'node:assert/strict';
import { chartGeometry, createChartRenderer } from '../dist/index.js';
test('chart domains handle missing, constant, negative and extreme values', () => {
  const line = chartGeometry([1, null, 3], 100, 20);
  assert.deepEqual(line.points, [{ x: 0, y: 20 }, null, { x: 100, y: 0 }]);
  assert.equal(chartGeometry([7], 100, 20).points[0].y, 10);
  assert.equal(chartGeometry([Infinity, NaN], 100, 20).count, 0);
  const columns = chartGeometry([-2, 2], 100, 20, 'column');
  assert.equal(columns.baseline, 10);
  const extreme = chartGeometry([-Number.MAX_VALUE, Number.MAX_VALUE], 100, 20, 'column');
  assert.deepEqual(extreme.points, [
    { x: 0, y: 20 },
    { x: 100, y: 0 },
  ]);
  assert.throws(() => chartGeometry(Array(513), 100, 20), RangeError);
  assert.deepEqual(chartGeometry([0, Number.MIN_VALUE], 100, 20).points, [
    { x: 0, y: 20 },
    { x: 100, y: 0 },
  ]);
});
test('renderers route configured columns, preserve context and do not join missing line segments', () => {
  const calls = [];
  const context = new Proxy(
    {},
    {
      set: () => true,
      get:
        (_, key) =>
        (...args) =>
          calls.push([key, ...args]),
    },
  );
  const cell = { columnKey: 'trend', value: [1, null, 3], x: 10, y: 10, width: 100, height: 40 };
  assert.equal(createChartRenderer({ trend: 'line' })(context, cell), true);
  assert.equal(calls.filter(([key]) => key === 'lineTo').length, 0);
  assert.equal(calls.at(-1)[0], 'restore');
  for (const kind of ['column', 'bar']) {
    calls.length = 0;
    createChartRenderer({ trend: kind })(context, { ...cell, value: [-2, 2] });
    assert.equal(calls.filter(([key]) => key === 'fillRect').length, 2);
  }
  assert.equal(createChartRenderer({ trend: 'line' })(context, { ...cell, columnKey: 'name' }), false);
});
