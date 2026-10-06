import test from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../dist/internal/history.js';

test('history replay retains failed commands and preserves per-kind notification timing', () => {
  let value = 'after';
  let allowed = false;
  const entry = {
    kind: 'values',
    changes: [{ rowIndex: 0, columnKey: 'name', rowId: 1, previous: 'before', value: 'after' }],
  };
  const context = {
    destroyed: false,
    past: [entry],
    future: [],
    formats: new Map(),
    columnIndices: new Map([['name', 0]]),
    dataSource: { getRowId: () => 1, getValue: () => value },
  };
  const notifications = [];
  const history = createHistory(context, {
    requirePermission: () => {
      if (!allowed) throw new Error('denied');
    },
    write: (updates) => {
      value = updates[0].value;
    },
    writeFormats: () => {},
    notifyCells: (_, source) => notifications.push([source, context.past.length, context.future.length, value]),
    changeVisibility: (_, __, hidden, record, source) => {
      assert.equal(record, false);
      notifications.push([source, context.past.length, context.future.length, hidden]);
    },
  });
  assert.throws(() => history.replay(false), /denied/);
  assert.deepEqual(context.past, [entry]);
  assert.deepEqual(context.future, []);
  assert.equal(value, 'after');
  assert.deepEqual(notifications, []);
  allowed = true;
  assert.equal(history.replay(false), true);
  assert.equal(history.replay(true), true);
  assert.deepEqual(notifications, [
    ['undo', 0, 1, 'before'],
    ['redo', 1, 0, 'after'],
  ]);
  context.past.push({ kind: 'visibility', axis: 'row', indices: [0], hidden: true });
  assert.equal(history.replay(false), true);
  assert.deepEqual(notifications.at(-1), ['undo', 2, 0, false]);
  context.destroyed = true;
  assert.equal(history.replay(true), false);
});
