import assert from 'node:assert/strict';
import test from 'node:test';
import { createNumberDisplay } from '../dist/internal/display.js';

test('number display preserves finite-number formatting and plain-value fallbacks', () => {
  const display = createNumberDisplay({ locale: 'en-US', currency: 'USD' });
  assert.equal(display(1234.567, 'decimal'), '1,234.57');
  assert.equal(display(12.7, 'integer'), '13');
  assert.equal(display(0.125, 'percent'), '12.5%');
  assert.equal(display(12.5, 'currency'), '$12.50');
  assert.equal(display(12.5), '12.5');
  assert.equal(display('12.50', 'currency'), '12.50');
  assert.equal(display(null, 'decimal'), '');
  assert.equal(display(undefined), '');
  assert.equal(display(NaN, 'decimal'), 'NaN');
  assert.equal(display(Infinity, 'decimal'), 'Infinity');
  assert.equal(createNumberDisplay({ locale: 'de-DE', currency: 'EUR' })(1234.5, 'decimal'), '1.234,5');
  assert.throws(() => createNumberDisplay({ currency: 'invalid' }), RangeError);
});
