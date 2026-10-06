import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headerLayout } from '../dist/headers.js';

test('nested headers retain flat coordinates, leaf row spans and reject ambiguous groups', () => {
  const columns = ['id', 'ios', 'android', 'chrome'].map((key) => ({ key, title: key }));
  const layout = headerLayout(columns, [
    { title: 'Result', children: [{ title: 'Mobile', children: ['ios', 'android'] }, 'chrome'] },
  ]);
  assert.equal(layout.levels, 3);
  assert.deepEqual(
    layout.cells.find((cell) => cell.title === 'id'),
    { title: 'id', start: 0, end: 1, level: 0, rowSpan: 3, leaf: true },
  );
  assert.equal(layout.cells.find((cell) => cell.title === 'chrome').rowSpan, 2);
  for (const children of [['ios', 'id'], ['ios', 'chrome'], ['ios', 'ios'], ['missing'], []])
    assert.throws(() => headerLayout(columns, [{ title: 'Invalid', children }]));
});
