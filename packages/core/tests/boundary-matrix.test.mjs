import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGridEngine,
  LocalDataSource,
  restoreGridConfiguration,
  encodeBlocks,
  decodeBlocks,
  blocksToTsv,
} from '../dist/index.js';
import { readGridState } from '../dist/state.js';
import { clipboardCellLimit, clipboardTextLimit } from '../dist/tsv.js';

const columns = [
  { key: 'a', title: 'A', editable: true },
  { key: 'b', title: 'B', editable: true },
];
const configuration = () => ({
  version: 1,
  columns: columns.map((c) => ({ key: c.key, width: 100 })),
  frozenRows: 0,
  frozenColumns: 0,
  view: {},
});
const block = (values = [['value']], extra = {}) => ({ row: 0, column: 0, values, ...extra });
const decode = (blocks) => decodeBlocks(JSON.stringify({ version: 1, blocks }));

test('state envelope validates every required collection and independent metadata caps', () => {
  const valid = Object.fromEntries(
    ['rowIds', 'rowHeights', 'manualRows', 'ranges', 'merges', 'groups', 'locks', 'formats'].map((key) => [key, []]),
  );
  valid.version = 1;
  for (const input of [null, undefined, [], 'state', 1, { ...valid, version: 2 }])
    assert.throws(() => readGridState(input), TypeError);
  for (const key of Object.keys(valid).filter((key) => key !== 'version'))
    for (const value of [undefined, null, {}])
      assert.throws(() => readGridState({ ...valid, [key]: value }), TypeError);
  for (const [key, limit] of [
    ['ranges', 128],
    ['merges', 1024],
    ['groups', 1024],
  ]) {
    assert.equal(readGridState({ ...valid, [key]: Array(limit) })[key].length, limit);
    assert.throws(() => readGridState({ ...valid, [key]: Array(limit + 1) }), RangeError);
  }
});

test('configuration rejects malformed layout, frozen counts, sorts and filters before using host columns', () => {
  const patches = [
    { columns: null },
    { columns: [null, null] },
    {
      columns: [
        { key: 'missing', width: 10 },
        { key: 'b', width: 10 },
      ],
    },
    ...[0, -1, NaN, Infinity, '100'].map((width) => ({
      columns: [
        { key: 'a', width },
        { key: 'b', width: 100 },
      ],
    })),
    ...['frozenRows', 'frozenColumns'].flatMap((key) => [-1, 3, 0.5, '1', Infinity].map((value) => ({ [key]: value }))),
    { view: null },
    { view: { sort: { columnKey: 'a', direction: 'bad' } } },
    { view: { sorts: {} } },
    { view: { sort: { columnKey: 'a', direction: 'asc' }, sorts: [] } },
    {
      view: {
        sorts: [
          { columnKey: 'a', direction: 'asc' },
          { columnKey: 'a', direction: 'desc' },
        ],
      },
    },
    { view: { sorts: [{ columnKey: 'a', direction: null }] } },
    { view: { sorts: [{ columnKey: 'missing', direction: 'asc' }] } },
    { view: { filters: {} } },
    { view: { filters: [null] } },
    { view: { filters: [{ columnKey: 'a', query: 1 }] } },
    { view: { filters: [{ columnKey: 'a', query: '', operator: 'bad' }] } },
  ];
  for (const patch of patches)
    assert.throws(() => restoreGridConfiguration({ ...configuration(), ...patch }, columns, 2));
  for (const count of [-1, 0.1, NaN, Infinity, '2'])
    assert.throws(() => restoreGridConfiguration(configuration(), columns, count), RangeError);
  assert.throws(() => restoreGridConfiguration(configuration(), [columns[0], columns[0]], 2), TypeError);
  for (const operator of [undefined, 'contains', 'equals', 'empty', 'not-empty']) {
    const input = {
      ...configuration(),
      view: {
        sorts: [{ columnKey: 'b', direction: 'desc' }],
        filters: [{ columnKey: 'a', query: 'x', ...(operator ? { operator } : {}) }],
      },
    };
    const result = restoreGridConfiguration(input, columns, 2);
    assert.equal(result.columns[0], columns[0]);
    input.view.sorts[0].direction = 'asc';
    input.view.filters[0].query = 'changed';
    assert.equal(result.view.sorts[0].direction, 'desc');
    assert.equal(result.view.filters[0].query, 'x');
  }
});

test('failed state restores leave data, selection, layout and undo history unchanged', () => {
  const source = new LocalDataSource(
    [
      { a: 'old', b: 1 },
      { a: 'other', b: 2 },
    ],
    (_, i) => i,
  );
  const engine = createGridEngine({ columns, dataSource: source });
  engine.select(0, 0);
  engine.editCell(0, 0, 'draft');
  const before = engine.exportState();
  const mutations = [
    (state) => {
      state.rowIds[0] = 'wrong';
    },
    (state) => {
      state.rowHeights = [[0]];
    },
    (state) => {
      state.rowHeights = [[0, -1]];
    },
    (state) => {
      state.manualRows = [0, 0];
    },
    (state) => {
      state.manualRows = [2];
    },
    (state) => {
      state.formats = [null];
    },
    (state) => {
      state.groups = [{ id: '', startRow: 0, endRow: 1, collapsed: false }];
    },
    (state) => {
      state.hiddenRows = {};
    },
    (state) => {
      state.hiddenColumns = [2];
    },
    (state) => {
      state.selection.columnKey = 'wrong';
    },
    (state) => {
      state.selection.rowId = 'wrong';
    },
    (state) => {
      state.anchor = null;
    },
    (state) => {
      state.activeParts = 0;
    },
    (state) => {
      state.displayAnchor = { row: 99, col: 0 };
    },
  ];
  try {
    for (const corrupt of mutations) {
      const saved = structuredClone(before);
      corrupt(saved);
      assert.throws(() => engine.restoreState(saved));
      assert.deepEqual(engine.exportState(), before);
      assert.equal(source.getValue(0, 'a'), 'draft');
      assert.equal(engine.canUndo(), true);
    }
    assert.equal(engine.undo(), true);
    assert.equal(source.getValue(0, 'a'), 'old');
  } finally {
    engine.destroy();
  }
});

test('clipboard envelope and rectangular cell validation reject malformed external payloads', () => {
  for (const payload of [
    null,
    [],
    {},
    { version: 2, blocks: [block()] },
    { version: 1, blocks: [] },
    { version: 1, blocks: Array(129).fill(block()) },
  ])
    assert.throws(() => decodeBlocks(JSON.stringify(payload)), TypeError);
  assert.throws(() => decodeBlocks('{'), SyntaxError);
  for (const item of [
    null,
    {},
    block([], {}),
    block([[]]),
    block(['text']),
    block([['a'], ['a', 'b']]),
    block([[1]]),
    ...['row', 'column'].flatMap((key) =>
      [-1, 0.5, '1', Infinity, Number.MAX_SAFE_INTEGER + 1].map((value) => block(undefined, { [key]: value })),
    ),
  ])
    assert.throws(() => decode([item]), TypeError);
  assert.equal(decode(Array(128).fill(block())).length, 128);
});

test('clipboard format whitelist validates all variants, rejects shape mismatches and preserves text inertly', () => {
  const accepted = {
    background: '#abc',
    textColor: '#ABCD1234',
    numberFormat: 'currency',
    fontWeight: 'bold',
    fontStyle: 'italic',
    contentFormat: 'markdown',
  };
  assert.deepEqual(decode([block([['<script>inert</script>']], { formats: [[accepted]] })])[0].formats, [[accepted]]);
  for (const [key, values] of Object.entries({
    numberFormat: ['decimal', 'integer', 'percent', 'currency'],
    fontWeight: ['normal', 'bold'],
    fontStyle: ['normal', 'italic'],
    contentFormat: ['plain', 'html', 'markdown'],
    background: ['#abc', '#abcd', '#abcdef', '#abcdef01'],
    textColor: ['#ABC', '#ABCD'],
  }))
    for (const value of values)
      assert.equal(decode([block(undefined, { formats: [[{ [key]: value }]] })])[0].formats[0][0][key], value);
  for (const formats of [
    null,
    [],
    [[]],
    ['invalid'],
    [[null]],
    [[{ unknown: 'x' }]],
    [[{ fontWeight: 'heavy' }]],
    [[{ fontStyle: 'oblique' }]],
    [[{ contentFormat: 'javascript' }]],
    [[{ numberFormat: 'date' }]],
    [[{ background: 'red' }]],
    [[{ textColor: '#12' }]],
    [[{ textColor: 123 }]],
  ])
    assert.throws(() => decode([block(undefined, { formats })]), TypeError);
});

test('clipboard cell and text budgets apply to decoding, encoding and TSV packing', () => {
  const row = Array(clipboardCellLimit).fill('');
  assert.equal(decode([block([row])])[0].values[0].length, clipboardCellLimit);
  assert.throws(() => decode([block([row]), block()]), RangeError);
  assert.throws(() => decodeBlocks(' '.repeat(clipboardTextLimit + 1)), RangeError);
  assert.throws(() => decodeBlocks(123), RangeError);
  assert.throws(() => encodeBlocks([block([['x'.repeat(clipboardTextLimit)]])]), RangeError);
  assert.equal(blocksToTsv([]), '');
  assert.equal(blocksToTsv([block([['a', 'b']]), block([['c']], { column: 5 })]), 'a\tb\tc');
  assert.equal(blocksToTsv([block([['a']]), block([['b', 'c']], { row: 2 })]), 'a\t\r\nb\tc');
  assert.throws(() => blocksToTsv([block([row]), block([row], { column: 1 })]), RangeError);
  assert.throws(() => blocksToTsv([block([row]), block([row], { row: 1 })]), RangeError);
  assert.throws(() => blocksToTsv([block([['x'.repeat(clipboardTextLimit + 1)]])]), RangeError);
});
