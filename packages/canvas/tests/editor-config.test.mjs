import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateColumnEditor } from '../dist/internal/editor-config.js';

test('internal editor configuration retains validation and immutable snapshots', () => {
  const column = { key: 'status', title: 'Status', editable: true, parse: String };
  const input = { type: 'select', values: [{ value: 'todo', label: 'Todo' }], choiceEditor: { search: true } };
  const result = validateColumnEditor(column, input);
  assert.notEqual(result, input);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.values), true);
  assert.equal(Object.isFrozen(result.values[0]), true);
  input.values[0].label = 'Changed';
  assert.equal(result.values[0].label, 'Todo');
  assert.throws(() => validateColumnEditor(column, { type: 'select', values: ['a', 'a'] }), /unique/);
  assert.throws(() => validateColumnEditor(column, { type: 'multiselect', values: ['a,b'] }), /commas/);
  assert.throws(() => validateColumnEditor(column, { type: 'multiselect', values: [''] }), /nonempty/);
  assert.throws(
    () => validateColumnEditor({ key: 'x', title: 'X', editable: true }, { type: 'checkbox' }),
    /boolean parser/,
  );
  assert.deepEqual(validateColumnEditor({ key: 'x', title: 'X' }, { type: 'checkbox' }), { type: 'checkbox' });
});
