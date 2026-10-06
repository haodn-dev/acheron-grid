import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvasTranslator, canvasEnglishMessages, canvasVietnameseMessages } from '../dist/index.js';
test('Canvas translator snapshots overrides, interpolates templates and preserves unknown host text', () => {
  const messages = { Copy: 'Copier', 'Select row {0}': 'Ligne {0}' };
  const t = createCanvasTranslator('fr-FR', messages);
  messages.Copy = 'changed';
  assert.equal(t('Copy'), 'Copier');
  assert.equal(t('Select row {0}', 4), 'Ligne 4');
  assert.equal(t('Select row 7'), 'Ligne 7');
  assert.equal(t('Custom validation'), 'Custom validation');
  assert.equal(createCanvasTranslator('vi-VN')('Copy'), 'Sao chép');
  assert.equal(canvasEnglishMessages['Copy'], 'Copy');
  assert.throws(() => createCanvasTranslator('en', { Copy: 4 }));
  assert.deepEqual(Object.keys(canvasEnglishMessages).sort(), Object.keys(canvasVietnameseMessages).sort());
});
