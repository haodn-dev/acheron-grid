import test from 'node:test';
import assert from 'node:assert/strict';
import { validateColumnEditor } from '../dist/internal/editor-config.js';
import { createNumberDisplay } from '../dist/internal/display.js';
import { headerLayout, reorderedHeaderGroups } from '../dist/headers.js';
import { validateMediaValue, mediaItems, parseMediaValue } from '../dist/media.js';
import { safeWebUrl, detectLinks } from '../dist/links.js';
import { resolveMotion } from '../dist/internal/motion.js';

test('sparse media and select options are rejected before rendering', () => {
  for (const value of [Array(1), ['image', , 'last']]) {
    assert.throws(() => validateMediaValue(value), TypeError);
    assert.deepEqual(mediaItems(value), []);
  }
  for (const type of ['select', 'multiselect'])
    for (const values of [Array(1), ['first', , 'last']])
      assert.throws(() => validateColumnEditor({ key: 'a', title: 'A' }, { type, values }), TypeError);
});

test('motion settings reject array objects and validate boundaries without changing caller options', () => {
  const doc = { createElement: () => ({ animate: () => ({ cancel() {} }) }) };
  for (const value of [[], [220], null, 'fast', 1]) assert.throws(() => resolveMotion(value, doc), TypeError);
  for (const key of ['duration', 'selectionDuration', 'surfaceDuration']) {
    for (const value of [-1, 1001, NaN, Infinity])
      assert.throws(() => resolveMotion({ [key]: value }, doc), RangeError);
    for (const value of [0, 1000]) assert.equal(resolveMotion({ [key]: value }, doc)[key], value);
  }
  for (const key of ['layout', 'selection', 'surfaces', 'liveSort', 'valueIndicators', 'chartUpdates'])
    assert.throws(() => resolveMotion({ [key]: 'true' }, doc), TypeError);
  const options = { duration: 300, liveSort: true };
  const resolved = resolveMotion(options, doc);
  options.duration = 500;
  assert.equal(resolved.duration, 300);
  assert.ok(Object.isFrozen(resolved));
  assert.throws(() => resolveMotion({ easing: 1 }, doc), TypeError);
  const invalidEasing = {
    createElement: () => ({
      animate() {
        throw new Error('invalid');
      },
    }),
  };
  assert.throws(() => resolveMotion({ easing: 'invalid' }, invalidEasing), /Invalid motion easing/);
});

test('sparse header groups cannot silently omit a configured group', () => {
  const columns = [{ key: 'a', title: 'A' }];
  assert.throws(() => headerLayout(columns, Array(1)), TypeError);
  assert.throws(() => headerLayout(columns, [{ title: 'Group', children: Array(1) }]), TypeError);
});

test('editor configuration validates option fields, duplicates and immutable choice modes', () => {
  const column = { key: 'a', title: 'A', editable: true, parse: Boolean };
  for (const config of [
    null,
    {},
    { type: 'unknown' },
    { type: 'select', values: [] },
    { type: 'select', values: {} },
    ...[null, 1, {}, { value: 1 }, { value: 'a', label: 1 }, { value: 'a', disabled: 'yes' }].map((value) => ({
      type: 'select',
      values: [value],
    })),
  ])
    assert.throws(() => validateColumnEditor(column, config), TypeError);
  assert.throws(() => validateColumnEditor(null, { type: 'checkbox' }), TypeError);
  for (const type of ['select', 'multiselect']) {
    const options = { search: true };
    const result = validateColumnEditor(column, {
      type,
      values: ['a', { value: 'b', label: 'B', disabled: true }],
      choiceEditor: options,
    });
    options.search = false;
    assert.equal(result.choiceEditor.search, true);
    assert.ok(Object.isFrozen(result.choiceEditor));
    assert.deepEqual(result.values[0], { value: 'a' });
    assert.equal(validateColumnEditor(column, { type, values: ['a'], choiceEditor: false }).choiceEditor, false);
    assert.equal(Object.hasOwn(validateColumnEditor(column, { type, values: ['a'] }), 'choiceEditor'), false);
  }
  assert.deepEqual(validateColumnEditor(column, { type: 'checkbox' }), { type: 'checkbox' });
});

test('header reordering sorts nested groups, prunes deleted leaves and rejects broken contiguous spans', () => {
  const original = [
    { title: 'AB', children: ['a', { title: 'B', children: ['b', 'deleted'] }] },
    { title: 'gone', children: ['deleted'] },
    { title: 'C', children: ['c'] },
  ];
  const before = structuredClone(original);
  const columns = ['c', 'b', 'a'].map((key) => ({ key, title: key }));
  assert.deepEqual(reorderedHeaderGroups(columns, original), [
    { title: 'C', children: ['c'] },
    { title: 'AB', children: [{ title: 'B', children: ['b'] }, 'a'] },
  ]);
  assert.deepEqual(original, before);
  assert.deepEqual(reorderedHeaderGroups([], original), []);
  assert.throws(
    () =>
      reorderedHeaderGroups(
        ['a', 'c', 'b'].map((key) => ({ key, title: key })),
        before,
      ),
    /contiguous/,
  );
  for (const group of [null, {}, { title: '', children: ['a'] }, { title: 'A', children: null }])
    assert.throws(() => headerLayout(columns, [group]), TypeError);
  let tree = 'a';
  for (let i = 0; i < 16; i++) tree = { title: String(i), children: [tree] };
  assert.throws(() => headerLayout(columns, [tree]), RangeError);
  assert.equal(headerLayout(columns).levels, 1);
});

test('media validation bounds lists, rejects every invalid field and safely handles display fallbacks', () => {
  for (const input of [
    null,
    1,
    {},
    Array(101).fill('a'),
    [null],
    [[]],
    [{}],
    [{ src: 1 }],
    [{ name: true }],
    [{ alt: 1, src: 'a' }],
    [{ name: 'Ada', id: Infinity }],
    [{ name: 'Ada', id: false }],
    [{ src: 'a', unexpected: true }],
  ]) {
    assert.throws(() => validateMediaValue(input), TypeError);
    assert.deepEqual(mediaItems(input), []);
  }
  const items = [{ name: 'Ada', id: 0 }, { src: '/image.png', alt: 'Alt', id: 'img' }, 'raw'];
  const result = validateMediaValue(items);
  items[0].name = 'changed';
  assert.equal(result[0].name, 'Ada');
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result[0]));
  assert.equal(validateMediaValue(Array(100).fill('image')).length, 100);
  assert.deepEqual(mediaItems('/image.png'), [{ src: '/image.png' }]);
  assert.deepEqual(mediaItems(''), []);
  assert.deepEqual(mediaItems(undefined), []);
  assert.equal(parseMediaValue(' text '), ' text ');
  assert.deepEqual(parseMediaValue(' \n '), []);
  assert.throws(() => parseMediaValue('[bad'), SyntaxError);
});

test('URL validation rejects credentials, control characters, relative and unsafe schemes', () => {
  for (const value of [
    ' https://example.com',
    'https://example.com ',
    'https://example.com\n',
    'https://user:pass@example.com',
    'https://user@example.com',
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///a',
    '/relative',
    'not a URL',
    'http://[',
  ])
    assert.equal(safeWebUrl(value), undefined);
  assert.equal(safeWebUrl('www.example.com'), 'https://www.example.com/');
  assert.equal(safeWebUrl('http://example.com/a'), 'http://example.com/a');
  assert.deepEqual(detectLinks(null), []);
  assert.deepEqual(detectLinks('email@www.example.com /https://example.com'), []);
  const input = 'See (https://example.com/a(b)), and https://example.com/path!';
  const links = detectLinks(input);
  assert.deepEqual(
    links.map((link) => link.text),
    ['https://example.com/a(b)', 'https://example.com/path'],
  );
  for (const link of links) {
    assert.equal(input.slice(link.start, link.end), link.text);
    assert.ok(Object.isFrozen(link));
  }
});

test('number formatting applies platform defaults, preserves non-numbers and validates locale/currency', () => {
  const display = createNumberDisplay({});
  for (const [value, format] of [
    [1234.5, 'decimal'],
    [0.25, 'percent'],
    [12.5, 'currency'],
    [1.6, 'integer'],
  ]) {
    const options =
      format === 'currency'
        ? { style: 'currency', currency: 'USD' }
        : format === 'percent'
          ? { style: 'percent', maximumFractionDigits: 2 }
          : { maximumFractionDigits: format === 'integer' ? 0 : 2 };
    assert.equal(display(value, format), new Intl.NumberFormat('en', options).format(value));
  }
  for (const value of [false, 1n, '123', {}, NaN, Infinity, -Infinity])
    assert.equal(display(value, 'currency'), String(value));
  assert.equal(display(undefined), '');
  assert.throws(() => createNumberDisplay({ locale: 'invalid_locale' }), RangeError);
});
