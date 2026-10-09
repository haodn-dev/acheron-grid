import test from 'node:test';
import assert from 'node:assert/strict';
import { chartGeometry, createChartRenderer } from '../dist/index.js';

const kinds = ['line', 'area', 'column', 'bar'];
const cell = { columnKey: 'trend', value: [0, 10], x: 10, y: 20, width: 116, height: 52 };
function drawing(options, values = cell.value, patch = {}, fail) {
  const calls = [],
    state = { globalAlpha: 0.5 };
  const context = new Proxy(state, {
    get: (target, key) =>
      key in target
        ? target[key]
        : (...args) => {
            calls.push({ method: key, args, state: { ...state } });
            if (key === fail) throw new Error(`failed ${key}`);
          },
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  });
  const renderer = createChartRenderer({ trend: options });
  const render = (values, patch = {}) => renderer(context, { ...cell, value: values, ...patch });
  return { calls, state, context, render, result: fail ? undefined : render(values, patch) };
}
const operations = (drawing, method) => drawing.calls.filter((call) => call.method === method);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) <= 1e-10, `${actual} != ${expected}`);

test('geometry rejects invalid series, dimensions, kind and domain shapes', () => {
  for (const values of [null, undefined, '1,2', {}, new Float64Array([1]), Array(513)])
    assert.throws(() => chartGeometry(values, 100, 40), RangeError);
  for (const size of [0, -1, NaN, Infinity, -Infinity, '40', null, undefined]) {
    assert.throws(() => chartGeometry([1], size, 40), RangeError);
    assert.throws(() => chartGeometry([1], 100, size), RangeError);
  }
  for (const kind of ['', 'pie', null, 3]) assert.throws(() => chartGeometry([1], 100, 40, kind), RangeError);
  for (const domain of [
    null,
    {},
    '0,10',
    [],
    [0],
    [0, 1, 2],
    ['0', 10],
    [NaN, 10],
    [0, -Infinity],
    [0, 0],
    [1, 0],
    Array(2),
  ])
    assert.throws(() => chartGeometry([1], 100, 40, 'line', domain), RangeError);
});

for (const kind of kinds) {
  test(`${kind}: empty, missing, zero, constant, signed and singleton geometry`, () => {
    for (const values of [[], [null, undefined, NaN, Infinity, -Infinity, '2', false, {}, 2n], Array(3)]) {
      const result = chartGeometry(values, 100, 40, kind);
      assert.equal(result.count, 0);
      assert.equal(result.min, 0);
      assert.equal(result.max, 0);
      assert.deepEqual(
        result.points,
        Array.from(values, () => null),
      );
    }
    for (const value of [-7, 0, 7]) {
      const result = chartGeometry([value], 100, 40, kind);
      assert.equal(result.points[0].x, 50);
      assert.equal(result.points[0].y, kind === 'line' || value === 0 ? 20 : value > 0 ? 0 : 40);
      assert.equal(
        result.baseline,
        kind === 'line' ? (value === 0 ? 20 : value > 0 ? 40 : 0) : value === 0 ? 20 : value > 0 ? 40 : 0,
      );
    }
    assert.deepEqual(chartGeometry([-5, 0, 5], 100, 40, kind).points, [
      { x: 0, y: 40 },
      { x: 50, y: 20 },
      { x: 100, y: 0 },
    ]);
    const constant = chartGeometry([4, 4, 4], 100, 40, kind);
    assert.ok(constant.points.every((point) => point.y === (kind === 'line' ? 20 : 0)));
  });

  test(`${kind}: fixed domains, extreme finite values, subnormals and 512-point budget`, () => {
    const domain = [-Number.MAX_VALUE, Number.MAX_VALUE];
    const extreme = chartGeometry([-Number.MAX_VALUE, 0, Number.MAX_VALUE], 100, 40, kind, domain);
    assert.deepEqual(
      extreme.points.map((point) => point.y),
      [40, 20, 0],
    );
    assert.equal(extreme.baseline, 20);
    assert.deepEqual(
      chartGeometry([-Number.MIN_VALUE, 0, Number.MIN_VALUE], 100, 40, kind).points.map((p) => p.y),
      [40, 20, 0],
    );
    const values = Object.freeze(Array.from({ length: 512 }, (_, i) => i - 256));
    const result = chartGeometry(values, 100, 40, kind, [-100, 100]);
    assert.equal(result.count, 512);
    assert.equal(result.points.length, 512);
    assert.deepEqual(result.points[0], { x: 0, y: 40 });
    assert.deepEqual(result.points.at(-1), { x: 100, y: 0 });
    assert.ok(result.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.y >= 0 && p.y <= 40));
    assert.deepEqual(chartGeometry([], 100, 40, kind, [-100, 100]).points, []);
    if (kind !== 'line') {
      for (const bounds of [
        [1, 10],
        [-10, -1],
      ])
        assert.throws(() => chartGeometry(values, 100, 40, kind, bounds), RangeError);
    }
  });

  test(`${kind}: no marks for empty/invalid data; zero baseline follows orientation`, () => {
    for (const values of [[], [null, NaN], Array(3)]) {
      const result = drawing({ kind, showBaseline: true, threshold: 0, highlight: ['min', 'max', 'last'] }, values);
      for (const method of ['arc', 'fill', 'fillRect', 'stroke', 'setLineDash'])
        assert.equal(operations(result, method).length, 0);
      assert.equal(result.calls[0].method, 'save');
      assert.equal(result.calls.at(-1).method, 'restore');
    }
    const result = drawing({ kind, showBaseline: true, markerRadius: 0 }, [-5, 5]);
    assert.deepEqual(operations(result, 'moveTo')[0].args, kind === 'bar' ? [50, 0] : [0, 20]);
    assert.deepEqual(operations(result, 'lineTo')[0].args, kind === 'bar' ? [50, 40] : [100, 20]);
  });

  test(`${kind}: threshold endpoints, outside domain, zero and empty series`, () => {
    for (const threshold of [-10, -5, 0, 5, 10]) {
      const result = drawing({ kind, domain: [-10, 10], threshold, markerRadius: 0 }, [-10, 10]);
      const stroke = operations(result, 'stroke').at(-1);
      assert.equal(stroke.state.strokeStyle, '#64748b');
      assert.equal(stroke.state.lineWidth, 1);
      const y = (10 - threshold) * 2;
      assert.deepEqual(operations(result, 'moveTo').at(-1).args, kind === 'bar' ? [100 * (1 - y / 40), 0] : [0, y]);
      assert.deepEqual(operations(result, 'lineTo').at(-1).args, kind === 'bar' ? [100 * (1 - y / 40), 40] : [100, y]);
      assert.deepEqual(
        operations(result, 'setLineDash').map((c) => c.args),
        [[[3, 3]], [[]]],
      );
    }
    for (const threshold of [-11, 11])
      assert.equal(operations(drawing({ kind, domain: [-10, 10], threshold }, [-10, 10]), 'setLineDash').length, 0);
    assert.equal(operations(drawing({ kind, threshold: 0 }, []), 'setLineDash').length, 0);
    assert.equal(operations(drawing({ kind, threshold: 0 }, [0]), 'setLineDash').length, 2);
    const huge = drawing({ kind, threshold: 0 }, [-Number.MAX_VALUE, Number.MAX_VALUE]);
    assert.ok(
      operations(huge, 'moveTo')
        .flatMap((c) => c.args)
        .every(Number.isFinite),
    );
  });
}

test('geometry preserves sparse positions, input and immutable outputs', () => {
  const values = Object.freeze([1, , 3]);
  const domain = Object.freeze([0, 4]);
  const result = chartGeometry(values, 100, 40, 'line', domain);
  assert.deepEqual(result.points, [{ x: 0, y: 30 }, null, { x: 100, y: 10 }]);
  assert.equal(1 in values, false);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.points) && Object.isFrozen(result.points[0]));
  assert.throws(() => {
    result.points[0].y = 99;
  }, TypeError);
  assert.throws(() => result.points.push({ x: 0, y: 0 }), TypeError);
  assert.throws(() => {
    result.min = 99;
  }, TypeError);
});

test('line domains may exclude zero without expanding the scale', () => {
  for (const [domain, baseline] of [
    [[1, 10], 40],
    [[-10, -1], 0],
  ]) {
    const result = chartGeometry([-Number.MAX_VALUE, ...domain, Number.MAX_VALUE], 120, 40, 'line', domain);
    assert.equal(result.min, domain[0]);
    assert.equal(result.max, domain[1]);
    assert.equal(result.baseline, baseline);
    assert.deepEqual(
      result.points.map((point) => point.y),
      [40, 40, 0, 0],
    );
  }
});

test('every renderer accepts the complete 512-point budget', () => {
  const values = Array.from({ length: 512 }, (_, i) => (i % 11) - 5);
  for (const kind of kinds) {
    const result = drawing({ kind, curve: 'smooth', markerRadius: 0 }, values);
    assert.equal(result.result, true);
    assert.equal(
      operations(result, kind === 'line' || kind === 'area' ? 'bezierCurveTo' : 'fillRect').length,
      kind === 'line' || kind === 'area' ? 511 : 512,
    );
    assert.equal(result.calls.at(-1).method, 'restore');
  }
});

test('constant line baseline uses the nearest zero edge while samples and threshold stay centered', () => {
  for (const [value, baseline] of [
    [7, 40],
    [-7, 0],
    [0, 20],
  ]) {
    const result = drawing({ kind: 'line', showBaseline: true, threshold: value, markerRadius: 0 }, [value, value]);
    assert.deepEqual(
      operations(result, 'moveTo').map((call) => call.args),
      [
        [0, baseline],
        [0, 20],
        [0, 20],
      ],
    );
  }
});

test('renderer rejects malformed options eagerly', () => {
  const invalid = [
    { kind: 'pie' },
    { kind: null },
    { curve: '' },
    { curve: null },
    { showBaseline: 1 },
    ...['color', 'thresholdColor', 'highlightColor'].flatMap((key) =>
      ['', '  ', null, 123].map((value) => ({ [key]: value })),
    ),
    ...['lineWidth', 'markerRadius', 'fillOpacity'].flatMap((key) =>
      [NaN, Infinity, -Infinity, '1', null, undefined].map((value) => ({ [key]: value })),
    ),
    { lineWidth: 0 },
    { lineWidth: -1 },
    { markerRadius: -1 },
    { fillOpacity: -0.1 },
    { fillOpacity: 1.1 },
    ...[NaN, Infinity, -Infinity, '5', null].map((threshold) => ({ threshold })),
    ...[null, {}, 'min', ['first'], [null], Array(1)].map((highlight) => ({ highlight })),
  ];
  for (const patch of invalid)
    assert.throws(() => createChartRenderer({ trend: { kind: 'line', ...patch } }), TypeError, JSON.stringify(patch));
  for (const options of [null, undefined, {}, 123])
    assert.throws(() => createChartRenderer({ trend: options }), TypeError);
  for (const kind of kinds)
    assert.doesNotThrow(() =>
      createChartRenderer({
        trend: { kind, lineWidth: 0.1, markerRadius: 0, fillOpacity: 0, threshold: 0, domain: [-1, 1] },
      }),
    );
});

test('legacy defaults, per-column overrides and bindings are captured without prototype routing', () => {
  const bindings = { trend: 'line' };
  const render = createChartRenderer(bindings, '#123456');
  bindings.trend = 'bar';
  bindings.later = 'line';
  const result = drawing('line');
  result.calls.length = 0;
  assert.equal(render(result.context, cell), true);
  assert.equal(operations(result, 'fillRect').length, 0);
  assert.equal(operations(result, 'stroke')[0].state.strokeStyle, '#123456');
  assert.equal(operations(result, 'stroke')[0].state.lineWidth, 1.5);
  assert.ok(operations(result, 'arc').every((c) => c.args[2] === 1.5));
  for (const key of ['later', 'toString', 'constructor', '__proto__'])
    assert.equal(render(result.context, { ...cell, columnKey: key }), false);
  const own = createChartRenderer(Object.fromEntries([['__proto__', 'bar']]));
  assert.equal(own(result.context, { ...cell, columnKey: '__proto__' }), true);
  const overridden = drawing({ kind: 'line', color: '#abcdef', lineWidth: 3, markerRadius: 4 });
  assert.equal(operations(overridden, 'stroke')[0].state.strokeStyle, '#abcdef');
  assert.equal(operations(overridden, 'stroke')[0].state.lineWidth, 3);
  assert.ok(operations(overridden, 'arc').every((c) => c.args[2] === 4));
});

test('unhandled cells and cells with no drawing space allocate no context operations', () => {
  for (const value of [null, undefined, 12, '12', {}, new Float64Array([1])]) {
    const result = drawing('line');
    result.calls.length = 0;
    assert.equal(result.render(value), false);
    assert.deepEqual(result.calls, []);
  }
  for (const patch of [{ columnKey: 'other' }, { width: 16 }, { width: 0 }, { height: 12 }, { height: -1 }]) {
    const result = drawing('line', [1], patch);
    assert.equal(result.result, patch.columnKey ? false : true);
    assert.deepEqual(result.calls, []);
  }
  const result = drawing('line');
  result.calls.length = 0;
  assert.throws(() => result.render(Array(513)), RangeError);
  assert.deepEqual(result.calls, []);
  assert.throws(() => result.render([1], { width: NaN }), RangeError);
  assert.deepEqual(result.calls, []);
});

test('renderers clip and translate before drawing and always restore after drawing failures', () => {
  for (const kind of kinds) {
    const result = drawing(kind);
    assert.deepEqual(
      result.calls.slice(0, 5).map((c) => [c.method, ...c.args]),
      [['save'], ['beginPath'], ['rect', 10, 20, 116, 52], ['clip'], ['translate', 18, 26]],
    );
    assert.equal(result.calls.at(-1).method, 'restore');
  }
  for (const [kind, fail] of [
    ['line', 'clip'],
    ['line', 'stroke'],
    ['line', 'arc'],
    ['area', 'fill'],
    ['bar', 'fillRect'],
    ['column', 'fillRect'],
    ['line', 'setLineDash'],
  ]) {
    const result = drawing({ kind, threshold: 5 }, [0, 10], {}, fail);
    assert.throws(() => result.render([0, 10]), new RegExp(`failed ${fail}`));
    assert.equal(result.calls.at(-1).method, 'restore');
  }
});

for (const kind of ['line', 'area']) {
  test(`${kind}: linear/smooth segments preserve all gap boundaries and isolated samples`, () => {
    for (const curve of ['linear', 'smooth']) {
      const result = drawing({ kind, curve }, [null, 1, null, 2, 3, NaN, 4, null]);
      assert.equal(operations(result, 'moveTo').length, 3);
      assert.equal(operations(result, 'stroke').length, 3);
      assert.equal(operations(result, 'bezierCurveTo').length, curve === 'smooth' ? 1 : 0);
      assert.equal(operations(result, 'arc').length, 4);
      assert.equal(operations(result, 'closePath').length, kind === 'area' ? 3 : 0);
    }
    const isolated = drawing({ kind, markerRadius: 0 }, [1]);
    assert.equal(operations(isolated, 'arc').length, 0);
    assert.equal(operations(isolated, 'bezierCurveTo').length, 0);
  });

  test(`${kind}: smooth cubics stay within data ranges and have matching tangents across samples`, () => {
    for (const values of [
      [0, 10, 5, 5, -5],
      [4, 4, 4],
      [0, 1, 4, 5, 9],
      [9, 5, 4, 1, 0],
      [-Number.MAX_VALUE, 0, Number.MAX_VALUE],
      [-Number.MIN_VALUE, 0, Number.MIN_VALUE],
    ]) {
      const result = drawing({ kind, curve: 'smooth', markerRadius: 0 }, values);
      const points = chartGeometry(values, 100, 40, kind).points;
      const curves = operations(result, 'bezierCurveTo');
      assert.equal(curves.length, values.length - 1);
      curves.forEach((call, i) => {
        const [x1, y1, x2, y2, x3, y3] = call.args;
        const start = points[i],
          end = points[i + 1];
        assert.ok(y1 >= Math.min(start.y, end.y) - 1e-10 && y1 <= Math.max(start.y, end.y) + 1e-10);
        assert.ok(y2 >= Math.min(start.y, end.y) - 1e-10 && y2 <= Math.max(start.y, end.y) + 1e-10);
        if (i > 0) assert.ok(Math.abs(start.y - curves[i - 1].args[3] - (y1 - start.y)) < 1e-10);
        if (
          i === 0 &&
          values[0] !== values[1] &&
          values[1] !== values[2] &&
          Math.sign(values[1] - values[0]) === Math.sign(values[2] - values[1])
        )
          assert.notEqual(y2, end.y);
        assert.equal(x3, end.x);
        assert.equal(y3, end.y);
        assert.ok(start.x <= x1 && x1 <= x2 && x2 <= end.x);
        for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
          const y = (1 - t) ** 3 * start.y + 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3 * y3;
          assert.ok(y >= Math.min(start.y, end.y) - 1e-10 && y <= Math.max(start.y, end.y) + 1e-10);
        }
      });
    }
  });

  test(`${kind}: highlight modes, first ties, deduplication, last finite and radius`, () => {
    for (const [highlight, expected] of [
      [['min'], [0]],
      [['max'], [50]],
      [['last'], [75]],
      [
        ['min', 'max', 'last'],
        [0, 50, 75],
      ],
    ]) {
      const result = drawing({ kind, markerRadius: 0, highlight, highlightColor: '#abcdef' }, [1, 1, 5, 5, null]);
      assert.deepEqual(
        operations(result, 'arc').map((c) => c.args[0]),
        expected,
      );
      assert.ok(operations(result, 'arc').every((c) => c.args[2] === 3 && c.state.fillStyle === '#abcdef'));
    }
    for (const values of [[1], [null, 1, null]]) {
      const result = drawing({ kind, markerRadius: 0, highlight: ['min', 'min', 'max', 'last'] }, values);
      assert.equal(operations(result, 'arc').length, 1);
    }
    const large = drawing({ kind, markerRadius: 4, highlight: ['last'] });
    assert.equal(operations(large, 'arc').at(-1).args[2], 5);
  });
}

test('area fills each signed segment to zero with multiplied opacity', () => {
  for (const fillOpacity of [0, 0.18, 1]) {
    const result = drawing({ kind: 'area', fillOpacity, markerRadius: 0 }, [-5, null, 5]);
    assert.deepEqual(
      operations(result, 'lineTo').map((c) => c.args),
      [
        [0, 20],
        [0, 20],
        [100, 20],
        [100, 20],
      ],
    );
    assert.equal(operations(result, 'closePath').length, 2);
    assert.ok(operations(result, 'fill').every((c) => c.state.globalAlpha === 0.5 * fillOpacity));
    assert.equal(result.state.globalAlpha, 0.5);
  }
});

for (const kind of ['column', 'bar']) {
  test(`${kind}: exact positive/negative/zero rectangles retain missing slots`, () => {
    const result = drawing({ kind, highlight: ['min', 'max', 'last'] }, [-5, 0, null, 5]);
    const actual = operations(result, 'fillRect').map((c) => c.args);
    const expected =
      kind === 'column'
        ? [
            [2.5, 20, 20, 20],
            [27.5, 20, 20, 0],
            [77.5, 0, 20, 20],
          ]
        : [
            [0, 1, 50, 8],
            [50, 11, 0, 8],
            [50, 31, 50, 8],
          ];
    actual.forEach((args, i) => args.forEach((value, j) => near(value, expected[i][j])));
    assert.equal(actual.length, 3);
    assert.equal(operations(result, 'arc').length, 0);
  });
}

test('reusing a renderer reflects current data and dimensions without stale geometry', () => {
  const result = drawing({ kind: 'line', domain: [0, 10], markerRadius: 0, highlight: ['last'] }, [0, 10]);
  result.calls.length = 0;
  result.render([10, 0], { width: 216, height: 92 });
  assert.deepEqual(operations(result, 'moveTo')[0].args, [0, 0]);
  assert.deepEqual(operations(result, 'lineTo')[0].args, [200, 80]);
  assert.deepEqual(operations(result, 'arc')[0].args.slice(0, 3), [200, 80, 3]);
});
