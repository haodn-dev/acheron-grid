import type { Column } from '@acheron-grid/core';
import type { ColumnEditor } from '../grid.js';

export function validateColumnEditor(column: Column, config: ColumnEditor): ColumnEditor {
  if (!column || !config || !['select', 'multiselect', 'checkbox'].includes(config.type))
    throw new TypeError('Invalid column editor configuration.');
  if (config.type === 'select' || config.type === 'multiselect') {
    if (!Array.isArray(config.values) || !config.values.length) throw new TypeError('Select options must be nonempty.');
    const values = Array.from(config.values, (value) => (typeof value === 'string' ? { value } : value));
    if (
      values.some(
        (value) =>
          !value ||
          typeof value.value !== 'string' ||
          (value.label !== undefined && typeof value.label !== 'string') ||
          (value.disabled !== undefined && typeof value.disabled !== 'boolean'),
      ) ||
      new Set(values.map((value) => value.value)).size !== values.length
    )
      throw new TypeError('Select values must be unique strings with optional labels.');
    if (config.type === 'multiselect' && values.some((option) => !option.value || option.value.includes(',')))
      throw new TypeError('Multiselect values must be nonempty and contain no commas.');
    return Object.freeze({
      type: config.type,
      values: Object.freeze(values.map((value) => Object.freeze({ ...value }))),
      ...(config.choiceEditor === undefined
        ? {}
        : { choiceEditor: config.choiceEditor === false ? false : Object.freeze({ ...config.choiceEditor }) }),
    });
  } else {
    if (column.editable && typeof column.parse !== 'function')
      throw new TypeError('Checkbox columns require a boolean parser.');
    return Object.freeze({ type: 'checkbox' });
  }
}
