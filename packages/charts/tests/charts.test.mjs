import test from 'node:test';
import assert from 'node:assert/strict';
import { chartGeometry, createChartRenderer } from '../dist/index.js';
test('shared domains align rows, clamp outliers and validate zero-based chart domains', () => {
  assert.equal(chartGeometry([5], 100, 40, 'line', [0, 20]).points[0].y, 30);
  assert.equal(chartGeometry([5, 10], 100, 40, 'line', [0, 20]).points[0].y, 30);
  assert.deepEqual(
    chartGeometry([-Number.MAX_VALUE, Number.MAX_VALUE], 100, 40, 'line', [-1, 1]).points.map((p) => p.y),
    [40, 0],
  );
  for (const domain of [[1, 1], [2, 1], [0, Infinity], [0], Array(2)])
    assert.throws(() => chartGeometry([], 100, 40, 'line', domain), RangeError);
  assert.throws(() => createChartRenderer({ x: { kind: 'area', domain: [1, 10] } }), RangeError);
  assert.throws(() => createChartRenderer({ x: { kind: 'line', threshold: NaN } }), TypeError);
  assert.throws(() => createChartRenderer({ x: { kind: 'line', highlight: ['first'] } }), TypeError);
  assert.throws(() => createChartRenderer({ x: { kind: 'line', highlight: Array(1) } }), TypeError);
});

test('thresholds follow chart orientation and highlights use raw extrema with trailing gaps', () => {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      set: () => true,
      get:
        (_, key) =>
        (...args) =>
          calls.push([key, ...args]),
    },
  );
  const domain = [0, 10],
    highlight = ['min', 'max', 'last'];
  const renderer = createChartRenderer({ trend: { kind: 'line', domain, threshold: 5, markerRadius: 0, highlight } });
  domain[1] = 100;
  highlight.length = 0;
  const cell = { columnKey: 'trend', value: [20, -10, 4, null], x: 0, y: 0, width: 116, height: 52 };
  renderer(ctx, cell);
  assert.ok(calls.some(([key, x, y]) => key === 'moveTo' && x === 0 && y === 20));
  assert.deepEqual(
    calls.filter(([key]) => key === 'arc').map(([, x, y]) => [x, y]),
    [
      [100 / 3, 40],
      [0, 0],
      [200 / 3, 24],
    ],
  );
  assert.deepEqual(
    calls.filter(([key]) => key === 'setLineDash'),
    [
      ['setLineDash', [3, 3]],
      ['setLineDash', []],
    ],
  );
  calls.length = 0;
  createChartRenderer({ trend: { kind: 'bar', domain: [-10, 10], threshold: 5 } })(ctx, cell);
  assert.ok(calls.some(([key, x, y]) => key === 'moveTo' && x === 75 && y === 0));
  calls.length = 0;
  renderer(ctx, { ...cell, value: [null] });
  assert.equal(calls.filter(([key]) => key === 'arc' || key === 'setLineDash').length, 0);
});
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
test('smooth area curves stay bounded, split gaps, and honor column styles', () => {
  const calls = [];
  const context = new Proxy(
    { globalAlpha: 0.5 },
    {
      get: (target, key) => (key in target ? target[key] : (...args) => calls.push([key, ...args])),
      set: (target, key, value) => {
        target[key] = value;
        return true;
      },
    },
  );
  const options = { kind: 'area', curve: 'smooth', color: '#123456', lineWidth: 2, markerRadius: 0, fillOpacity: 0.4 };
  const render = createChartRenderer({ trend: options });
  options.color = '#ffffff';
  render(context, { columnKey: 'trend', value: [0, 10, null, -10, 5], x: 0, y: 0, width: 116, height: 52 });
  const curves = calls.filter(([key]) => key === 'bezierCurveTo');
  const expected = [
    ['bezierCurveTo', 25 / 3, 20 - 20 / 3, 25 - 25 / 3, 20 / 3, 25, 0],
    ['bezierCurveTo', 75 + 25 / 3, 30, 100 - 25 / 3, 20, 100, 10],
  ];
  assert.equal(curves.length, expected.length);
  curves.forEach((curve, index) =>
    curve.forEach((value, part) =>
      typeof value === 'number'
        ? assert.ok(Math.abs(value - expected[index][part]) < 1e-10)
        : assert.equal(value, expected[index][part]),
    ),
  );
  assert.equal(calls.filter(([key]) => key === 'closePath').length, 2);
  assert.equal(calls.filter(([key]) => key === 'arc').length, 0);
  assert.equal(context.globalAlpha, 0.5);
  assert.equal(context.fillStyle, '#123456');
  assert.equal(context.lineWidth, 2);
  assert.equal(calls.at(-1)[0], 'restore');
  assert.equal(chartGeometry([-2, 2], 100, 20, 'area').baseline, 10);
  for (const invalid of [
    { curve: 'invalid' },
    { lineWidth: 0 },
    { markerRadius: -1 },
    { fillOpacity: 2 },
    { showBaseline: 'yes' },
  ])
    assert.throws(() => createChartRenderer({ trend: { kind: 'line', ...invalid } }), TypeError);
});

test('baseline follows horizontal bar orientation and context restores after drawing failure', () => {
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
  const cell = { columnKey: 'trend', value: [-2, 2], x: 0, y: 0, width: 116, height: 52 };
  createChartRenderer({ trend: { kind: 'bar', showBaseline: true } })(context, cell);
  assert.ok(calls.some(([key, x, y]) => key === 'moveTo' && x === 50 && y === 0));
  assert.ok(calls.some(([key, x, y]) => key === 'lineTo' && x === 50 && y === 40));
  const failing = new Proxy(context, {
    get: (target, key) =>
      key === 'bezierCurveTo'
        ? () => {
            throw new Error('draw failure');
          }
        : target[key],
  });
  assert.throws(() => createChartRenderer({ trend: { kind: 'line', curve: 'smooth' } })(failing, cell), /draw failure/);
  assert.equal(calls.at(-1)[0], 'restore');
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

test('smooth updates retain continuous bounded tangents when the sample count changes', () => {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      set: () => true,
      get:
        (_, key) =>
        (...args) =>
          calls.push([key, ...args]),
    },
  );
  const render = createChartRenderer({ trend: { kind: 'line', curve: 'smooth', domain: [0, 10], markerRadius: 0 } });
  for (const [previousValue, value] of [
    [
      [0, 3],
      [0, 4, 8, 10],
    ],
    [[0], [0, 4, 8, 10]],
    [
      [0, 4, 8, 10],
      [0, 3],
    ],
  ]) {
    for (const animationProgress of [0, 0.2, 0.5, 0.9, 1]) {
      calls.length = 0;
      render(ctx, { columnKey: 'trend', previousValue, value, animationProgress, x: 0, y: 0, width: 116, height: 52 });
      const curves = calls.filter(([key]) => key === 'bezierCurveTo');
      let start = calls.find(([key]) => key === 'moveTo').slice(1);
      for (const [index, curve] of curves.entries()) {
        const [, x1, y1, x2, y2, x, y] = curve;
        assert.ok(curve.slice(1).every(Number.isFinite));
        for (let step = 0; step <= 20; step++) {
          const t = step / 20;
          const height = (1 - t) ** 3 * start[1] + 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3 * y;
          assert.ok(height >= Math.min(start[1], y) - 1e-10 && height <= Math.max(start[1], y) + 1e-10);
        }
        const next = curves[index + 1];
        if (next && x !== x2 && next[1] !== x) {
          const incoming = (y - y2) / (x - x2);
          const outgoing = (next[2] - y) / (next[1] - x);
          assert.ok(Math.abs(incoming - outgoing) < 1e-10, 'tangent must remain continuous');
        }
        start = [x, y];
      }
    }
  }
});

test('chart update interpolates geometry, appends from the last point and respects gaps', () => {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      set: () => true,
      get:
        (_, key) =>
        (...args) =>
          calls.push([key, ...args]),
    },
  );
  const render = createChartRenderer({ trend: { kind: 'line', curve: 'linear', domain: [0, 10], markerRadius: 0 } });
  const cell = {
    columnKey: 'trend',
    value: [10, 0, 5],
    previousValue: [0, 10],
    animationProgress: 0.5,
    x: 0,
    y: 0,
    width: 116,
    height: 52,
  };
  render(ctx, cell);
  assert.ok(calls.some(([key, x, y]) => key === 'moveTo' && x === 0 && y === 20));
  assert.ok(calls.some(([key, x, y]) => key === 'lineTo' && x === 75 && y === 20));
  assert.ok(calls.some(([key, x, y]) => key === 'lineTo' && x === 100 && y === 10));
  calls.length = 0;
  render(ctx, { ...cell, animationProgress: 1 });
  assert.ok(calls.some(([key, x, y]) => key === 'moveTo' && x === 0 && y === 0));
  calls.length = 0;
  render(ctx, { ...cell, value: [10, null, 5] });
  assert.equal(calls.filter(([key]) => key === 'lineTo').length, 0);
});
