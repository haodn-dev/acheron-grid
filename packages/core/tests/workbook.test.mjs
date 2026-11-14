import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkbook, evaluateFormula, pivotRows } from '../dist/index.js';

test('pivot keeps typed keys and rejects invalid measures', () => {
  const rows = [
    { team: 1, month: 'May', amount: 3 },
    { team: 1, month: 'May', amount: 4 },
    { team: '1', month: 'May', amount: 2 },
  ];
  assert.equal(pivotRows(rows, 'team', 'month', 'amount').get(1).get('May'), 7);
  assert.equal(pivotRows(rows, 'team', 'month').get('1').get('May'), 1);
  assert.throws(() => pivotRows(rows, 'team', 'month', 'missing'), TypeError);
});

test('formulas enforce precedence, reference errors, cycles and depth', () => {
  const cells = { A1: '=B1 * 2', B1: 3, C1: '=C1' };
  const read = (address) => cells[address];
  assert.equal(evaluateFormula('=(A1 + 2) / -4', read), -2);
  assert.equal(evaluateFormula('=1/0', read), '#DIV/0!');
  assert.equal(evaluateFormula('=Z1', read), '#REF!');
  assert.equal(evaluateFormula('=C1', read), '#CYCLE!');
  assert.equal(evaluateFormula('=Math.random()', read), '#VALUE!');
  assert.equal(evaluateFormula('=' + '-'.repeat(100) + '1', read), '#LIMIT!');
});

test('workbook updates references and isolates sheets while rejecting stale or partial edits', () => {
  const book = createWorkbook(['Plan', 'Actual']);
  assert.deepEqual(
    book.apply(0, [
      { sheet: 'Plan', address: 'A1', value: 3 },
      { sheet: 'Plan', address: 'B1', value: '=A1*2' },
    ]),
    { status: 'accepted', revision: 1 },
  );
  assert.equal(book.read('Plan', 'B1'), 6);
  assert.equal(book.read('Actual', 'A1'), undefined);
  assert.deepEqual(book.apply(0, [{ sheet: 'Plan', address: 'A1', value: 99 }]), { status: 'conflict', revision: 1 });
  assert.throws(
    () =>
      book.apply(1, [
        { sheet: 'Plan', address: 'A1', value: 9 },
        { sheet: 'Actual', address: 'A0', value: 1 },
      ]),
    TypeError,
  );
  assert.equal(book.read('Plan', 'A1'), 3);
  book.apply(1, [{ sheet: 'Plan', address: 'A1', value: 4 }]);
  assert.equal(book.read('Plan', 'B1'), 8);
  assert.equal(JSON.parse(JSON.stringify(book.snapshot())).sheets[0].cells.B1, '=A1*2');
});
