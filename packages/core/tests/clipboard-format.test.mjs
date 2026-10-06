import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, LocalDataSource, encodeBlocks } from '../dist/index.js';

test('formatted clipboard writes and replays atomically, checks format permissions before parsers', () => {
  let allow = true,
    parses = 0;
  const source = new LocalDataSource([{ id: 1, a: 'first', b: 'original' }], (row) => row.id);
  const engine = createGridEngine({
    dataSource: source,
    columns: [
      { key: 'a', title: 'A' },
      {
        key: 'b',
        title: 'B',
        editable: true,
        parse: (text) => {
          parses++;
          return text;
        },
      },
    ],
    resolveCellPermission: () => ({ formatting: allow }),
  });
  const payload = encodeBlocks([
    { row: 0, column: 0, values: [['<b>Styled</b>']], formats: [[{ contentFormat: 'html', background: '#ffeecc' }]] },
  ]);
  engine.select(0, 1);
  allow = false;
  assert.throws(() => engine.pasteSelectionBlocks(payload), /format/i);
  assert.equal(parses, 0);
  assert.equal(source.getValue(0, 'b'), 'original');
  assert.equal(engine.canUndo(), false);
  allow = true;
  engine.pasteSelectionBlocks(payload);
  assert.equal(source.getValue(0, 'b'), '<b>Styled</b>');
  assert.deepEqual(engine.getFormat(0, 1), { contentFormat: 'html', background: '#ffeecc' });
  allow = false;
  assert.throws(() => engine.undo(), /format/i);
  assert.equal(source.getValue(0, 'b'), '<b>Styled</b>');
  allow = true;
  assert.equal(engine.undo(), true);
  assert.equal(source.getValue(0, 'b'), 'original');
  assert.deepEqual(engine.getFormat(0, 1), {});
  assert.equal(engine.redo(), true);
  assert.equal(source.getValue(0, 'b'), '<b>Styled</b>');
  const invalid = payload.replace('"html"', '"javascript"');
  assert.throws(() => engine.pasteSelectionBlocks(invalid), /format/i);
  assert.equal(source.getValue(0, 'b'), '<b>Styled</b>');
  engine.destroy();
});
