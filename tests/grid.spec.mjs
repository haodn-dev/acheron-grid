import { test, expect } from '@playwright/test';

test('batch commands repaint only dirty cells and undo/redo atomically', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid, LocalDataSource } = await import('/index.js');
    window.source = new LocalDataSource(Array.from({ length: 100 }, (_, id) => ({ id, name: 'Ada', team: 'Design' })), row => row.id);
    const getValue = window.source.getValue.bind(window.source);
    window.reads = [];
    window.source.getValue = (row, key) => { window.reads.push([row, key]); return getValue(row, key); };
    window.grid = createGrid({ container: document.querySelector('#grid'), dataSource: window.source,
      columns: [{ key: 'id', title: 'ID' }, { key: 'name', title: 'Name', editable: true }, { key: 'team', title: 'Team' }] });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const result = await page.evaluate(async () => {
    const canvas = document.querySelector('canvas');
    const context = canvas.getContext('2d');
    const header = [...context.getImageData(0, 0, canvas.width, 30 * devicePixelRatio).data];
    window.grid.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'First' },
      { rowIndex: 0, columnKey: 'name', value: 'Grace' }, { rowIndex: 1, columnKey: 'team', value: 'Ops' },
      { rowIndex: 99, columnKey: 'name', value: 'Hidden' }]);
    window.reads = [];
    await new Promise(resolve => requestAnimationFrame(resolve));
    const reads = [...window.reads];
    const sameHeader = JSON.stringify(header) === JSON.stringify([...context.getImageData(0, 0, canvas.width, 30 * devicePixelRatio).data]);
    const partial = [...context.getImageData(0, 0, canvas.width, canvas.height).data];
    window.grid.render();
    await new Promise(resolve => requestAnimationFrame(resolve));
    const full = [...context.getImageData(0, 0, canvas.width, canvas.height).data];
    return { reads, sameHeader, samePixels: JSON.stringify(partial) === JSON.stringify(full) };
  });
  expect(result.reads).toEqual([[0, 'name'], [1, 'team']]);
  expect(result.sameHeader).toBe(true);
  expect(result.samePixels).toBe(true);
  const viewport = page.getByLabel(/^Data grid viewport/);
  await viewport.focus();
  await viewport.press('Control+z');
  expect(await page.evaluate(() => [window.source.getValue(0, 'name'), window.source.getValue(1, 'team'), window.source.getValue(99, 'name')])).toEqual(['Ada', 'Design', 'Ada']);
  await viewport.press('Control+Shift+z');
  expect(await page.evaluate(() => window.source.getValue(0, 'name'))).toBe('Grace');
  expect(await page.evaluate(() => {
    window.grid.undo();
    window.grid.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Ada' }]);
    return window.grid.redo();
  })).toBe(true);
  const failures = await page.evaluate(() => {
    const before = window.source.getValue(0, 'name');
    let invalid = false;
    try { window.grid.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Lost' }, { rowIndex: 100, columnKey: 'team', value: '' }]); }
    catch { invalid = window.source.getValue(0, 'name') === before; }
    window.source.setValue(0, 'name', 'External');
    let conflict = false;
    try { window.grid.undo(); } catch (error) { conflict = /conflict/.test(error.message); }
    window.source.setValue(0, 'name', before);
    const retry = window.grid.undo();
    window.grid.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Branch' }]);
    return { invalid, conflict, retry, redo: window.grid.redo() };
  });
  expect(failures).toEqual({ invalid: true, conflict: true, retry: true, redo: false });
  await viewport.click({ position: { x: 180, y: 16 } });
  await viewport.press('F2');
  await page.getByRole('textbox').fill('Editor command');
  await page.getByRole('textbox').press('Enter');
  await viewport.press('Control+z');
  expect(await page.evaluate(() => window.source.getValue(0, 'name'))).toBe('Branch');
  await viewport.press('Control+y');
  expect(await page.evaluate(() => window.source.getValue(0, 'name'))).toBe('Editor command');
  const redraw = await page.evaluate(async () => {
    const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
    await nextFrame();
    window.grid.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'A' }]);
    window.grid.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'B' }]);
    window.reads = [];
    await nextFrame();
    const coalesced = [...window.reads];
    const canvas = document.querySelector('canvas');
    const pixels = () => JSON.stringify([...canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data]);
    const selectedPartial = pixels();
    window.grid.render();
    await nextFrame();
    const sameSelection = selectedPartial === pixels();
    const viewport = document.querySelector('[tabindex]');
    viewport.scrollTop = 640;
    viewport.dispatchEvent(new Event('scroll'));
    window.grid.updateCells([{ rowIndex: 20, columnKey: 'name', value: 'Scrolled update' }]);
    await nextFrame();
    const scrolled = pixels();
    window.grid.render();
    await nextFrame();
    return { coalesced, sameSelection, sameScroll: scrolled === pixels() };
  });
  expect(redraw).toEqual({ coalesced: [[0, 'name']], sameSelection: true, sameScroll: true });
});

test('history preserves failed writes, rejects unsafe custom batches and caps retention', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createGrid, LocalDataSource } = await import('/index.js');
    const source = new LocalDataSource([{ id: 1, name: 'Ada', team: 'Design' }], row => row.id);
    const grid = createGrid({ container: document.querySelector('#grid'), dataSource: source,
      columns: [{ key: 'name', title: 'Name' }, { key: 'team', title: 'Team' }] });
    const setter = source.setValues.bind(source);
    source.setValues = () => { throw new Error('Rejected'); };
    let failed = false;
    try { grid.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Grace' }, { rowIndex: 0, columnKey: 'team', value: 'Ops' }]); } catch { failed = true; }
    const noHistory = !grid.undo();
    source.setValues = setter;
    grid.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Grace' }, { rowIndex: 0, columnKey: 'team', value: 'Ops' }]);
    source.setValues = () => { throw new Error('Rejected'); };
    try { grid.undo(); } catch {}
    const kept = source.getValue(0, 'name') === 'Grace';
    source.setValues = setter;
    const retried = grid.undo();
    for (let i = 0; i < 101; i++) grid.updateCells([{ rowIndex: 0, columnKey: 'name', value: String(i) }]);
    let count = 0;
    while (grid.undo()) count++;
    const oldest = source.getValue(0, 'name');
    grid.destroy();
    let destroyed = false;
    try { grid.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Lost' }]); } catch { destroyed = true; }
    const custom = { getRowCount: () => 1, getRowId: () => 1, getValue: () => 'original', setValue: () => { throw new Error('Should not write'); } };
    const second = createGrid({ container: document.querySelector('#grid'), columns: [{ key: 'name', title: 'Name' }, { key: 'team', title: 'Team' }], dataSource: custom });
    let atomic = false;
    try { second.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'x' }, { rowIndex: 0, columnKey: 'team', value: 'y' }]); } catch (error) { atomic = /atomic/.test(error.message); }
    second.destroy();
    return { failed, noHistory, kept, retried, count, oldest, destroyed, atomic };
  });
  expect(result).toEqual({ failed: true, noHistory: true, kept: true, retried: true, count: 100, oldest: '0', destroyed: true, atomic: true });
});

test('DOM editing commits, cancels, validates and follows scrolling', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid, LocalDataSource } = await import('/index.js');
    window.source = new LocalDataSource(Array.from({ length: 100 }, (_, id) => ({ id, name: 'Ada', amount: 12 })), row => row.id);
    window.grid = createGrid({ container: document.querySelector('#grid'), dataSource: window.source,
      columns: [{ key: 'id', title: 'ID' }, { key: 'name', title: 'Name', editable: true },
        { key: 'amount', title: 'Amount', editable: true, parse: text => {
          if (!text.trim() || !Number.isFinite(Number(text))) throw new Error('Enter a finite number');
          return Number(text);
        } }] });
  });
  const viewport = page.getByLabel(/^Data grid viewport/);
  const input = page.getByRole('textbox');
  await viewport.dblclick({ position: { x: 180, y: 16 } });
  await expect(input).toHaveValue('Ada');
  await input.fill('Grace');
  await input.press('Enter');
  await expect(input).toHaveCount(0);
  expect(await page.evaluate(() => window.source.getValue(0, 'name'))).toBe('Grace');
  await expect(viewport).toHaveAccessibleName(/Grace/);
  await viewport.press('F2');
  await input.fill('Discard');
  await input.press('Escape');
  expect(await page.evaluate(() => window.source.getValue(0, 'name'))).toBe('Grace');
  await viewport.press('ArrowRight');
  await viewport.press('Enter');
  await input.fill('invalid');
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(await page.evaluate(() => window.source.getValue(0, 'amount'))).toBe(12);
  await viewport.click({ position: { x: 180, y: 16 } });
  expect((await page.evaluate(() => window.grid.getSelection())).columnKey).toBe('amount');
  await input.fill('24');
  await input.press('Enter');
  expect(await page.evaluate(() => window.source.getValue(0, 'amount'))).toBe(24);
  await viewport.evaluate(el => { el.scrollTop = 640; });
  await viewport.dblclick({ position: { x: 180, y: 16 } });
  await expect(input).toHaveAccessibleName('Edit row 21, Name');
  const box = await input.boundingBox();
  const bounds = await viewport.boundingBox();
  expect(Math.abs(box.y - bounds.y)).toBeLessThan(2);
  await input.fill('Scrolled');
  await viewport.click({ position: { x: 20, y: 16 } });
  expect(await page.evaluate(() => window.source.getValue(20, 'name'))).toBe('Scrolled');
  await viewport.press('F2');
  await expect(input).toHaveCount(0);
  await viewport.click({ position: { x: 180, y: 16 } });
  await viewport.press('F2');
  await input.fill('Unsaved');
  await input.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
  await expect(input).toHaveCount(1);
  await input.press('Escape');
  await viewport.click({ position: { x: 180, y: 16 } });
  await viewport.press('F2');
  await input.fill('Tabbed');
  await input.press('Tab');
  await expect(input).toHaveCount(0);
  expect(await page.evaluate(() => window.source.getValue(20, 'name'))).toBe('Tabbed');
  await viewport.focus();
  await viewport.press('F2');
  await input.fill('Rejected');
  await page.evaluate(() => { window.source.setValue = () => { throw new Error('Write rejected'); }; });
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await input.press('Escape');
  expect(await page.evaluate(() => window.source.getValue(20, 'name'))).toBe('Tabbed');
  await viewport.press('F2');
  await input.fill('Destroy draft');
  await page.evaluate(() => window.grid.destroy());
  expect(await page.evaluate(() => window.source.getValue(20, 'name'))).toBe('Tabbed');
});

test('renders only the viewport, scrolls both axes, resizes and cleans up', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/index.js');
    window.reads = [];
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      columns: Array.from({ length: 100 }, (_, i) => ({ key: `col${i}`, title: `Column ${i}` })),
      dataSource: {
        getRowCount: () => 100_000,
        getRowId: i => i,
        getValue: (i, key) => { window.reads.push([i, key]); return `${i} / ${key}`; },
      },
    });
  });
  await expect.poll(() => page.evaluate(() => window.reads.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.reads.every(([row, key]) => row < 11 && Number(key.slice(3)) < 4))).toBe(true);
  const scroller = page.getByLabel('Read-only data grid viewport');
  await scroller.evaluate(element => { window.reads = []; element.scrollTop = 1_600_000; element.scrollLeft = 8000; });
  await expect.poll(() => page.evaluate(() => window.reads.some(([row, key]) => row === 50_000 && key === 'col50'))).toBe(true);
  expect(await page.evaluate(() => window.reads.length)).toBeLessThan(100);
  expect(await page.locator('canvas').evaluate(canvas => [...canvas.getContext('2d').getImageData(20, 10, 1, 1).data])).not.toEqual([0, 0, 0, 0]);
  await page.locator('#grid').evaluate(element => { element.style.width = '320px'; });
  await expect.poll(() => page.locator('canvas').evaluate(element => parseFloat(element.style.width))).toBeLessThanOrEqual(320);
  await page.evaluate(() => { window.grid.render(); window.grid.destroy(); window.grid.destroy(); window.grid.render(); });
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.locator('#existing')).toHaveText('Existing content');
  expect(errors).toEqual([]);
});

test('empty and invalid grids are safe', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createGrid, LocalDataSource } = await import('/index.js');
    const container = document.querySelector('#grid');
    const dataSource = new LocalDataSource([], () => 0);
    const empty = createGrid({ container, columns: [], dataSource });
    empty.destroy();
    try { createGrid({ container, columns: [], dataSource, rowHeight: 0 }); }
    catch (error) { return error instanceof RangeError && container.children.length === 1; }
    return false;
  });
  expect(result).toBe(true);
});

test('single cell selection, navigation, scrolling and cleanup', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/index.js');
    window.changes = [];
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      columns: Array.from({ length: 20 }, (_, i) => ({ key: `c${i}`, title: `Column ${i}` })),
      dataSource: { getRowCount: () => 100, getRowId: i => `row-${i}`, getValue: (i, key) => `${i}:${key}` },
      onSelectionChange: selection => { window.changes.push(selection); if (selection) selection.rowIndex = -1; },
    });
  });
  const viewport = page.getByLabel(/^Read-only data grid viewport/);
  const selection = () => page.evaluate(() => window.grid.getSelection());
  await viewport.click({ position: { x: 180, y: 48 } });
  expect(await selection()).toEqual({ rowIndex: 1, rowId: 'row-1', columnIndex: 1, columnKey: 'c1' });
  await viewport.click({ position: { x: 180, y: 48 } });
  expect(await page.evaluate(() => window.changes.length)).toBe(1);
  await expect(viewport).toBeFocused();
  await expect.poll(() => page.locator('canvas').evaluate(canvas => {
    const ratio = devicePixelRatio;
    return [...canvas.getContext('2d').getImageData(161 * ratio, 80 * ratio, 1, 1).data];
  })).toEqual([37, 99, 235, 255]);
  await page.keyboard.press('ArrowRight');
  expect((await selection()).columnIndex).toBe(2);
  await page.keyboard.press('Control+End');
  expect(await selection()).toEqual({ rowIndex: 99, rowId: 'row-99', columnIndex: 19, columnKey: 'c19' });
  expect(await viewport.evaluate(el => el.scrollTop > 0 && el.scrollLeft > 0)).toBe(true);
  await page.keyboard.press('ArrowDown');
  expect((await selection()).rowIndex).toBe(99);
  await viewport.evaluate(el => { el.scrollTop = 640; el.scrollLeft = 800; });
  await viewport.click({ position: { x: 20, y: 16 } });
  expect(await selection()).toEqual({ rowIndex: 20, rowId: 'row-20', columnIndex: 5, columnKey: 'c5' });
  await page.keyboard.press('Home');
  expect((await selection()).columnIndex).toBe(0);
  await page.keyboard.press('End');
  expect((await selection()).columnIndex).toBe(19);
  await page.keyboard.press('Control+Home');
  expect((await selection()).rowIndex).toBe(0);
  await page.keyboard.press('ArrowUp');
  expect((await selection()).rowIndex).toBe(0);
  await page.keyboard.press('Escape');
  expect(await selection()).toBeNull();
  await page.keyboard.press('ArrowDown');
  expect((await selection()).rowIndex).toBe(0);
  await page.evaluate(() => { const copy = window.grid.getSelection(); copy.columnIndex = 99; });
  expect((await selection()).columnIndex).toBe(0);
  await page.evaluate(() => {
    window.oldViewport = document.querySelector('[tabindex]');
    window.grid.destroy();
    window.oldViewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
  expect(await selection()).toBeNull();
});

test('ignores header, blank space, modified keys and empty data', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid, LocalDataSource } = await import('/index.js');
    window.grid = createGrid({ container: document.querySelector('#grid'), columns: [{ key: 'name', title: 'Name' }], dataSource: new LocalDataSource([{ id: 1, name: 'Ada' }], row => row.id) });
    const button = document.createElement('button'); button.textContent = 'After grid'; document.body.append(button);
  });
  const viewport = page.getByLabel(/^Read-only data grid viewport/);
  const bounds = await viewport.boundingBox();
  await page.mouse.click(bounds.x + 20, bounds.y - 15);
  await viewport.click({ position: { x: 300, y: 100 } });
  expect(await page.evaluate(() => window.grid.getSelection())).toBeNull();
  await viewport.focus();
  await page.keyboard.press('Shift+ArrowDown');
  expect(await page.evaluate(() => window.grid.getSelection())).toBeNull();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'After grid' })).toBeFocused();
  await page.evaluate(async () => {
    window.grid.destroy();
    const { createGrid, LocalDataSource } = await import('/index.js');
    window.grid = createGrid({ container: document.querySelector('#grid'), columns: [], dataSource: new LocalDataSource([], () => 0) });
  });
  await viewport.click({ position: { x: 20, y: 20 } });
  await viewport.focus();
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => window.grid.getSelection())).toBeNull();
});
