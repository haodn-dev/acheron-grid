import { test, expect } from '@playwright/test';

test('individual resize keeps hit tests, editor, scrolling and partial pixels aligned', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.source = new LocalDataSource(Array.from({ length: 100 }, (_, id) => ({ id, name: 'Ada', team: 'Design' })), row => row.id);
    window.grid = createGrid({ container: document.querySelector('#grid'), dataSource: window.source,
      columns: [{ key: 'id', title: 'ID' }, { key: 'name', title: 'Name', editable: true }, { key: 'team', title: 'Team', editable: true }] });
    window.grid.setColumnWidth(0, 240);
    window.grid.setColumnWidth(1, 200);
    window.grid.setRowHeight(0, 64);
    window.grid.setRowHeight(1, 48);
  });
  const viewport = page.getByLabel(/^Data grid viewport/);
  await viewport.click({ position: { x: 250, y: 70 } });
  expect(await page.evaluate(() => window.grid.getSelection())).toMatchObject({ rowIndex: 1, columnIndex: 1 });
  await viewport.press('F2');
  const input = page.getByRole('textbox');
  expect(await input.evaluate(el => ({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }))).toEqual({ left: 240, top: 64, width: 200, height: 48 });
  await input.fill('Resized');
  await input.press('Enter');
  const pixels = await page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    window.grid.updateCells([{ rowIndex: 1, columnKey: 'name', value: 'Partial' }]);
    await new Promise(resolve => requestAnimationFrame(resolve));
    const canvas = document.querySelector('canvas');
    const image = () => [...canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data];
    const partial = image();
    window.grid.render();
    await new Promise(resolve => requestAnimationFrame(resolve));
    return JSON.stringify(partial) === JSON.stringify(image());
  });
  expect(pixels).toBe(true);
  await viewport.evaluate(el => { el.scrollTop = 400; });
  await viewport.click({ position: { x: 250, y: 16 } });
  expect(await page.evaluate(() => window.grid.getSelection())).toMatchObject({ rowIndex: 11, columnIndex: 1 });
  await viewport.press('Control+Home');
  const bounds = await viewport.boundingBox();
  await page.mouse.move(bounds.x + 240, bounds.y - 18);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 280, bounds.y - 18, { steps: 3 });
  await page.mouse.up();
  await viewport.click({ position: { x: 290, y: 16 } });
  await viewport.press('F2');
  expect(await input.evaluate(el => el.offsetLeft)).toBe(280);
  await input.press('Escape');
  expect(await page.evaluate(() => {
    let failures = 0;
    for (const call of [() => window.grid.setRowHeight(-1, 40), () => window.grid.setColumnWidth(0, 0)]) {
      try { call(); } catch { failures++; }
    }
    return failures;
  })).toBe(2);
  const edgeY = await viewport.evaluate(el => el.clientHeight - 2);
  await viewport.click({ position: { x: 290, y: edgeY }, button: 'right' });
  await expect(page.getByRole('menu', { name: 'Cell actions' })).toBeVisible();
  expect(await viewport.evaluate(el => el.scrollTop)).toBe(0);
});

test('context menu preserves ranges, invokes shared actions, supports keyboard and closes safely', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.source = new LocalDataSource([{ id: 1, name: 'Ada', team: 'Design' }, { id: 2, name: 'Grace', team: 'Ops' }], row => row.id);
    window.grid = createGrid({ container: document.querySelector('#grid'), dataSource: window.source,
      columns: [{ key: 'id', title: 'ID' }, { key: 'name', title: 'Name', editable: true }, { key: 'team', title: 'Team', editable: true }] });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async text => { window.copied = text; }, readText: async () => 'Pasted\tTeam\r\nSecond\tOps',
    } });
  });
  const viewport = page.getByLabel(/^Data grid viewport/);
  const menu = page.getByRole('menu', { name: 'Cell actions' });
  await viewport.click({ position: { x: 180, y: 16 } });
  await viewport.click({ position: { x: 340, y: 48 }, modifiers: ['Shift'] });
  await viewport.click({ position: { x: 180, y: 16 }, button: 'right' });
  await expect(menu).toBeVisible();
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toEqual({ startRow: 0, endRow: 1, startColumn: 1, endColumn: 2 });
  await expect(page.getByRole('menuitem', { name: 'Undo', exact: true })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  expect(await page.evaluate(() => window.copied)).toBe('Ada\tDesign\r\nGrace\tOps');
  await expect(menu).toHaveCount(0);
  await viewport.press('Shift+F10');
  await expect(menu).toBeVisible();
  await page.getByRole('menuitem', { name: 'Paste', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.source.getValue(0, 'name'))).toBe('Pasted');
  await viewport.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Undo', exact: true }).click();
  expect(await page.evaluate(() => window.source.getValue(0, 'name'))).toBe('Ada');
  await viewport.click({ position: { x: 20, y: 16 }, button: 'right' });
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toEqual({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 });
  await expect(page.getByRole('menuitem', { name: 'Edit cell', exact: true })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).press('End');
  await expect(page.getByRole('menuitem', { name: 'Resize row…', exact: true })).toBeFocused();
  await page.getByRole('menuitem', { name: 'Resize row…', exact: true }).press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(viewport).toBeFocused();
  await viewport.click({ position: { x: 180, y: 16 }, button: 'right' });
  await page.getByRole('menuitem', { name: 'Resize column…', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Column width (px)' }).fill('200');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await viewport.click({ position: { x: 180, y: 16 }, button: 'right' });
  await page.getByRole('menuitem', { name: 'Resize row…', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Row height (px)' }).fill('48');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await viewport.click({ position: { x: 180, y: 16 }, button: 'right' });
  await page.getByRole('menuitem', { name: 'Edit cell', exact: true }).click();
  expect(await page.getByRole('textbox').evaluate(el => ({ width: el.offsetWidth, height: el.offsetHeight }))).toEqual({ width: 200, height: 48 });
  const native = await page.getByRole('textbox').evaluate(el => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    el.dispatchEvent(event); return !event.defaultPrevented;
  });
  expect(native).toBe(true);
  await page.getByRole('textbox').press('Escape');
  await page.evaluate(() => { navigator.clipboard.readText = async () => { throw new Error('Clipboard denied'); }; });
  await viewport.click({ position: { x: 180, y: 16 }, button: 'right' });
  await page.getByRole('menuitem', { name: 'Paste', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Clipboard denied');
  expect(await page.evaluate(() => window.source.getValue(0, 'name'))).toBe('Ada');
  await page.evaluate(() => { navigator.clipboard.readText = () => new Promise(resolve => { window.resolvePaste = resolve; }); });
  await viewport.click({ position: { x: 180, y: 16 }, button: 'right' });
  await page.getByRole('menuitem', { name: 'Paste', exact: true }).click();
  await viewport.click({ position: { x: 380, y: 16 } });
  await page.evaluate(() => window.resolvePaste('Lost'));
  await expect(page.getByRole('alert')).toContainText('Selection changed');
  expect(await page.evaluate(() => window.source.getValue(0, 'team'))).toBe('Design');
  await viewport.click({ position: { x: 180, y: 16 }, button: 'right' });
  await page.getByRole('menuitem', { name: 'Resize row…', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Row height (px)' }).fill('0');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Row height', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await viewport.click({ position: { x: 180, y: 16 }, button: 'right' });
  await page.locator('#existing').click();
  await expect(menu).not.toBeVisible();
  await viewport.click({ position: { x: 180, y: 16 }, button: 'right' });
  await page.evaluate(() => window.grid.destroy());
  await expect(menu).toHaveCount(0);
});

test('range selection supports drag, Shift navigation, normalized bounds and clipboard events', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.source = new LocalDataSource(Array.from({ length: 30 }, (_, id) => ({ id, name: `Name ${id}`, team: `Team ${id}` })), row => row.id);
    window.ranges = [];
    window.grid = createGrid({ container: document.querySelector('#grid'), dataSource: window.source,
      columns: [{ key: 'id', title: 'ID' }, { key: 'name', title: 'Name', editable: true }, { key: 'team', title: 'Team', editable: true }],
      onSelectionRangeChange: range => { window.ranges.push(range ? { ...range } : null); if (range) range.startRow = -1; } });
  });
  const viewport = page.getByLabel(/^Data grid viewport/);
  const bounds = await viewport.boundingBox();
  await page.mouse.move(bounds.x + 180, bounds.y + 16);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 340, bounds.y + 48, { steps: 4 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toEqual({ startRow: 0, endRow: 1, startColumn: 1, endColumn: 2 });
  expect(await page.evaluate(() => window.grid.copySelection())).toBe('Name 0\tTeam 0\r\nName 1\tTeam 1');
  await viewport.press('Shift+ArrowUp');
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toEqual({ startRow: 0, endRow: 0, startColumn: 1, endColumn: 2 });
  await viewport.press('Shift+ArrowLeft');
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toEqual({ startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 });
  await viewport.click({ position: { x: 340, y: 80 } });
  await viewport.click({ position: { x: 180, y: 16 }, modifiers: ['Shift'] });
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toEqual({ startRow: 0, endRow: 2, startColumn: 1, endColumn: 2 });
  await page.evaluate(() => { const range = window.grid.getSelectionRange(); range.endRow = 999; });
  expect((await page.evaluate(() => window.grid.getSelectionRange())).endRow).toBe(2);
  const events = await viewport.evaluate(el => {
    const copied = new DataTransfer();
    const copy = new ClipboardEvent('copy', { clipboardData: copied, bubbles: true, cancelable: true });
    el.dispatchEvent(copy);
    const pasted = new DataTransfer();
    pasted.setData('text/plain', 'Grace\tOps\r\nAda\tDesign\r\n');
    const paste = new ClipboardEvent('paste', { clipboardData: pasted, bubbles: true, cancelable: true });
    el.dispatchEvent(paste);
    return { copy: copy.defaultPrevented, text: copied.getData('text/plain'), paste: paste.defaultPrevented };
  });
  expect(events).toEqual({ copy: true, text: 'Name 0\tTeam 0\r\nName 1\tTeam 1\r\nName 2\tTeam 2', paste: true });
  expect(await page.evaluate(() => [window.source.getValue(0, 'name'), window.source.getValue(1, 'team')])).toEqual(['Grace', 'Design']);
  await viewport.press('Control+z');
  expect(await page.evaluate(() => [window.source.getValue(0, 'name'), window.source.getValue(1, 'team')])).toEqual(['Name 0', 'Team 1']);
  await viewport.press('ArrowRight');
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toEqual({ startRow: 0, endRow: 0, startColumn: 2, endColumn: 2 });
  await viewport.press('Escape');
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toBeNull();
  expect(await page.evaluate(() => window.ranges.at(-1))).toBeNull();
  await viewport.evaluate(el => { el.scrollTop = 320; });
  await viewport.click({ position: { x: 180, y: 16 } });
  await viewport.press('Shift+ArrowDown');
  expect(await page.evaluate(() => window.grid.copySelection())).toBe('Name 10\r\nName 11');
  await viewport.press('Control+Shift+End');
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toEqual({ startRow: 10, endRow: 29, startColumn: 1, endColumn: 2 });
  await viewport.press('Control+Shift+Home');
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toEqual({ startRow: 0, endRow: 10, startColumn: 0, endColumn: 1 });
  await viewport.press('Control+Home');
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toEqual({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 });
  await page.evaluate(() => window.grid.destroy());
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toBeNull();
});

test('paste validates the whole rectangle, preserves data on errors and leaves editor clipboard native', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.source = new LocalDataSource([{ id: 1, name: 'Ada', amount: 12 }, { id: 2, name: 'Grace', amount: 24 }], row => row.id);
    window.grid = createGrid({ container: document.querySelector('#grid'), dataSource: window.source,
      columns: [{ key: 'id', title: 'ID' }, { key: 'name', title: 'Name', editable: true },
        { key: 'amount', title: 'Amount', editable: true, parse: text => {
          if (!text.trim() || !Number.isFinite(Number(text))) throw new Error('Invalid amount');
          return Number(text);
        } }] });
  });
  const viewport = page.getByLabel(/^Data grid viewport/);
  await viewport.click({ position: { x: 180, y: 16 } });
  expect(await page.evaluate(() => {
    let failures = 0;
    for (const text of ['Changed\tinvalid', 'Changed\t1\textra', 'Changed\nSecond\nThird', 'a\tb\nc', '"unfinished']) {
      try { window.grid.paste(text); } catch { failures++; }
    }
    return { failures, value: window.source.getValue(0, 'name'), history: window.grid.undo() };
  })).toEqual({ failures: 5, value: 'Ada', history: false });
  await page.evaluate(() => window.grid.paste('"Ada\tLovelace"\t42\r\n"Grace\nHopper"\t0'));
  expect(await page.evaluate(() => [window.source.getValue(0, 'name'), window.source.getValue(0, 'amount'), window.source.getValue(1, 'name')])).toEqual(['Ada\tLovelace', 42, 'Grace\nHopper']);
  await viewport.press('Control+z');
  await viewport.click({ position: { x: 20, y: 16 } });
  expect(await page.evaluate(() => { try { window.grid.paste('3'); } catch (error) { return /read-only/.test(error.message); } return false; })).toBe(true);
  await viewport.click({ position: { x: 180, y: 16 } });
  await viewport.press('F2');
  expect(await page.getByRole('textbox').evaluate(el => {
    const data = new DataTransfer(); data.setData('text/plain', 'Native');
    const paste = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    const copy = new ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true });
    el.dispatchEvent(paste); el.dispatchEvent(copy);
    return { paste: paste.defaultPrevented, copy: copy.defaultPrevented };
  })).toEqual({ paste: false, copy: false });
  await page.getByRole('textbox').press('Escape');
  await viewport.evaluate(el => {
    const html = new DataTransfer(); html.setData('text/html', '<b>Ignored</b>');
    const event = new ClipboardEvent('paste', { clipboardData: html, bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    window.htmlIgnored = !event.defaultPrevented;
  });
  expect(await page.evaluate(() => window.htmlIgnored)).toBe(true);
  expect(await page.evaluate(async () => {
    window.grid.destroy();
    const { createGrid } = await import('/canvas/index.js');
    window.grid = createGrid({ container: document.querySelector('#grid'), dataSource: window.source,
      columns: [{ key: 'id', title: 'ID', editable: true }] });
    const viewport = document.querySelector('[tabindex]');
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    try { window.grid.paste('3'); } catch (error) { return /parser/.test(error.message) && window.source.getValue(0, 'id') === 1; }
    return false;
  })).toBe(true);
});

test('batch commands repaint only dirty cells and undo/redo atomically', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
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
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
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
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
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
    const { createGrid } = await import('/canvas/index.js');
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
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
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
    const { createGrid } = await import('/canvas/index.js');
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
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.grid = createGrid({ container: document.querySelector('#grid'), columns: [{ key: 'name', title: 'Name' }], dataSource: new LocalDataSource([{ id: 1, name: 'Ada' }], row => row.id) });
    const button = document.createElement('button'); button.textContent = 'After grid'; document.body.append(button);
  });
  const viewport = page.getByLabel(/^Read-only data grid viewport/);
  const bounds = await viewport.boundingBox();
  await page.mouse.click(bounds.x + 20, bounds.y - 15);
  await viewport.click({ position: { x: 300, y: 100 } });
  expect(await page.evaluate(() => window.grid.getSelection())).toBeNull();
  await viewport.focus();
  await page.keyboard.press('Alt+ArrowDown');
  expect(await page.evaluate(() => window.grid.getSelection())).toBeNull();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'After grid' })).toBeFocused();
  await page.evaluate(async () => {
    window.grid.destroy();
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.grid = createGrid({ container: document.querySelector('#grid'), columns: [], dataSource: new LocalDataSource([], () => 0) });
  });
  await viewport.click({ position: { x: 20, y: 20 } });
  await viewport.focus();
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => window.grid.getSelection())).toBeNull();
});

test('capabilities govern browser focus, menu, editor commit and typed events', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.blockWrite = false;
    window.events = [];
    window.selections = [];
    window.ranges = [];
    window.source = new LocalDataSource([{ id: 1, name: 'Ada', team: 'Design' }, { id: 2, name: 'Grace', team: 'Research' }], row => row.id);
    window.grid = createGrid({ container: document.querySelector('#grid'), dataSource: window.source,
      columns: [{ key: 'name', title: 'Name', editable: true }, { key: 'team', title: 'Team', editable: true }],
      resolveCellPermission: cell => cell.rowIndex === 0 && cell.columnIndex === 1 ? { selectable: false } : (cell.rowIndex === 1 || window.blockWrite ? { writable: false } : undefined),
      onEvent: event => { window.events.push(event); },
      onSelectionChange: cell => window.selections.push(cell), onSelectionRangeChange: range => window.ranges.push(range),
    });
  });
  const viewport = page.getByLabel(/^Data grid viewport/);
  await viewport.click({ position: { x: 20, y: 16 } });
  await viewport.press('ArrowRight');
  expect(await page.evaluate(() => window.grid.getSelection())).toMatchObject({ rowIndex: 0, columnIndex: 0 });
  await viewport.dblclick({ position: { x: 180, y: 16 } });
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await viewport.click({ position: { x: 180, y: 16 }, button: 'right' });
  await expect(page.getByRole('menu')).toHaveCount(0);
  expect(await page.evaluate(() => window.selections.length)).toBe(1);
  expect(await page.evaluate(() => window.ranges.length)).toBe(1);
  await viewport.press('ArrowDown');
  expect(await page.evaluate(() => window.grid.copySelection())).toBe('Grace');
  await viewport.press('Enter');
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await viewport.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Edit cell', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).toBeDisabled();
  await page.getByRole('menu').press('Escape');
  await viewport.press('ArrowUp');
  await viewport.press('Enter');
  const input = page.getByRole('textbox');
  await input.fill('Draft');
  await page.evaluate(() => { window.blockWrite = true; });
  await input.press('Enter');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(await page.evaluate(() => window.source.getValue(0, 'name'))).toBe('Ada');
  await input.press('Escape');
  await page.evaluate(() => { window.blockWrite = false; });
  await viewport.press('Enter');
  await page.getByRole('textbox').fill('Updated');
  await page.getByRole('textbox').press('Enter');
  expect(await page.evaluate(() => window.events.filter(event => event.type === 'cell:change').map(event => event.source))).toEqual(['edit']);
  expect(await page.evaluate(() => window.grid.getCellPermission(1, 0))).toMatchObject({ writable: false, selectable: true, copyable: true });
  expect(await page.evaluate(() => window.selections.length)).toBe(3);
  await page.evaluate(() => window.grid.destroy());
  await expect(viewport).toHaveCount(0);
});

test('frozen panes keep hit tests, editor, dirty pixels, menu and header resize aligned', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.source = new LocalDataSource(Array.from({ length: 100 }, (_, id) => ({ id, ...Object.fromEntries(Array.from({ length: 20 }, (_, col) => [`c${col}`, `${id}:${col}`])) })), row => row.id);
    window.grid = createGrid({ container: document.querySelector('#grid'), dataSource: window.source, columnWidth: 100,
      frozenRows: 2, frozenColumns: 2, resolveCellPermission: cell => cell.rowIndex === 1 ? { writable: false } : undefined, columns: Array.from({ length: 20 }, (_, col) => ({ key: `c${col}`, title: `C${col}`, editable: true })) });
    const scroller = document.querySelector('[tabindex]');
    scroller.scrollLeft = 250; scroller.scrollTop = 320;
    window.grid.render();
  });
  const viewport = page.getByLabel(/^Data grid viewport/);
  for (const [x, y, row, col] of [[20, 16, 0, 0], [220, 16, 0, 4], [20, 100, 13, 0], [220, 100, 13, 4]]) {
    await viewport.click({ position: { x, y } });
    expect(await page.evaluate(() => window.grid.getSelection())).toMatchObject({ rowIndex: row, columnIndex: col });
  }
  await viewport.press('Enter');
  const bodyInput = page.getByRole('textbox');
  await bodyInput.fill('Clipped draft');
  const clipped = await page.evaluate(async () => {
    const scroller = document.querySelector('[tabindex]');
    scroller.scrollLeft = 300;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const bounds = scroller.getBoundingClientRect();
    return document.elementFromPoint(bounds.x + 150, bounds.y + 100)?.tagName;
  });
  expect(clipped).not.toBe('INPUT');
  await page.evaluate(async () => {
    document.querySelector('[tabindex]').scrollLeft = 900;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  expect(await page.evaluate(() => document.querySelector('input').value)).toBe('Clipped draft');
  expect(await page.evaluate(() => window.source.getValue(13, 'c4'))).toBe('13:4');
  await page.evaluate(() => { document.querySelector('[tabindex]').scrollLeft = 200; });
  await bodyInput.press('Escape');
  await viewport.click({ position: { x: 20, y: 48 } });
  await viewport.press('Enter');
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await viewport.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).toBeDisabled();
  await page.getByRole('menu').press('Escape');
  await viewport.click({ position: { x: 20, y: 16 } });
  await viewport.press('Enter');
  const input = page.getByRole('textbox');
  const original = await input.boundingBox();
  await input.fill('Frozen draft');
  await page.evaluate(() => { const scroller = document.querySelector('[tabindex]'); scroller.scrollLeft = 450; scroller.scrollTop = 640; });
  await expect.poll(async () => await input.boundingBox()).toEqual(original);
  await input.press('Enter');
  expect(await page.evaluate(() => window.source.getValue(0, 'c0'))).toBe('Frozen draft');
  await viewport.press('Control+z');
  expect(await page.evaluate(() => window.source.getValue(0, 'c0'))).toBe('0:0');
  await viewport.press('Control+Shift+z');
  await viewport.click({ position: { x: 20, y: 16 }, button: 'right' });
  await page.getByRole('menuitem', { name: 'Resize column…', exact: true }).click();
  await page.getByRole('spinbutton').fill('120');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await viewport.press('Enter');
  await expect.poll(async () => (await input.boundingBox()).width).toBe(120);
  await input.press('Escape');
  const bounds = await viewport.boundingBox();
  await page.mouse.move(bounds.x + 220, bounds.y - 18);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 240, bounds.y - 18);
  await page.mouse.up();
  await viewport.click({ position: { x: 140, y: 16 } });
  await viewport.press('Enter');
  await expect.poll(async () => (await input.boundingBox()).width).toBe(120);
  await input.press('Escape');
  await page.evaluate(() => { const scroller = document.querySelector('[tabindex]'); scroller.scrollLeft = 250; scroller.scrollTop = 320; window.grid.render(); });
  await viewport.click({ position: { x: 20, y: 16 } });
  await viewport.click({ position: { x: 280, y: 100 }, modifiers: ['Shift'] });
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toMatchObject({ startRow: 0, startColumn: 0, endRow: 13, endColumn: 4 });
  const equality = await page.evaluate(async () => {
    const next = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await next();
    window.grid.updateCells([{ rowIndex: 0, columnKey: 'c0', value: 'Corner' }, { rowIndex: 0, columnKey: 'c4', value: 'Top' }, { rowIndex: 13, columnKey: 'c0', value: 'Left' }, { rowIndex: 13, columnKey: 'c4', value: 'Body' }]);
    await next();
    const canvas = document.querySelector('canvas');
    const partial = canvas.toDataURL();
    window.grid.render();
    await next();
    return partial === canvas.toDataURL();
  });
  expect(equality).toBe(true);
  const beforeHome = await viewport.evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop }));
  await viewport.press('Control+Home');
  expect(await viewport.evaluate(el => ({ x: el.scrollLeft, y: el.scrollTop }))).toEqual(beforeHome);
  await viewport.press('ArrowRight');
  await viewport.press('ArrowRight');
  expect(await viewport.evaluate(el => el.scrollLeft)).toBe(0);
  await viewport.press('ArrowDown');
  await viewport.press('ArrowDown');
  expect(await viewport.evaluate(el => el.scrollTop)).toBe(0);
  await page.evaluate(() => window.grid.destroy());
  await expect(input).toHaveCount(0);
  await expect(viewport).toHaveCount(0);
});

test('frozen viewport reads stay bounded even when the entire dataset is frozen', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    let reads = 0;
    const grid = createGrid({ container: document.querySelector('#grid'), frozenRows: 1_000_000, frozenColumns: 1000,
      columns: Array.from({ length: 1000 }, (_, col) => ({ key: `c${col}`, title: String(col) })),
      dataSource: { getRowCount: () => 1_000_000, getRowId: row => row, getValue: (row, col) => { reads++; return `${row}:${col}`; }, setValue() {} } });
    const next = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await next();
    reads = 0;
    const scroller = document.querySelector('[tabindex]');
    scroller.scrollLeft = 8000; scroller.scrollTop = 16000000;
    grid.render();
    await next();
    const full = reads;
    reads = 0;
    grid.updateCells([{ rowIndex: 500000, columnKey: 'c50', value: 'offscreen' }]);
    await next();
    const offscreen = reads;
    scroller.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: scroller.getBoundingClientRect().x + 10, clientY: scroller.getBoundingClientRect().y + 10 }));
    const selection = grid.getSelection();
    grid.destroy();
    return { full, offscreen, selection };
  });
  expect(result.full).toBeLessThan(100);
  // One source read in command normalization, none in the offscreen draw.
  expect(result.offscreen).toBe(1);
  expect(result.selection).toMatchObject({ rowIndex: 0, columnIndex: 0 });
});

test('custom renderer keeps raw metadata, clipping, fallback and partial pixels across frozen panes', async ({ page }) => {
  await page.goto('/');
  const errors = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const result = await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    const raw = { label: 'Raw object' };
    const source = new LocalDataSource(Array.from({ length: 1000 }, (_, id) => ({ id: `row-${id}`, custom: raw, plain: 'Default', broken: 'Fallback' })), row => row.id);
    const calls = [];
    const columns = [{ key: 'custom', title: 'Custom' }, { key: 'plain', title: 'Plain' }, { key: 'broken', title: 'Broken' }];
    const grid = createGrid({ container: document.querySelector('#grid'), columns, dataSource: source,
      frozenRows: 1, frozenColumns: 1, renderCell(ctx, cell) {
        calls.push({ ...cell, same: cell.value === raw, frozen: Object.isFrozen(cell) });
        if (cell.columnKey === 'custom') {
          ctx.fillStyle = cell.value === raw ? '#ff0000' : '#00ff00';
          ctx.fillRect(-10000, -10000, 20000, 20000);
          ctx.translate(9000, 9000);
          return true;
        }
        ctx.fillStyle = '#0000ff';
        ctx.fillRect(-10000, -10000, 20000, 20000);
        ctx.globalAlpha = 0;
        if (cell.columnKey === 'broken') throw new Error('Expected renderer failure');
        return false;
      } });
    const next = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await next();
    const canvas = document.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const pixel = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
    const first = calls.find(cell => cell.rowIndex === 0 && cell.columnIndex === 0);
    const initial = { red: pixel(20, 50), plain: pixel(200, 50), broken: pixel(360, 50), header: pixel(20, 10) };
    const baseline = canvas.toDataURL();
    const initialCount = calls.length;
    grid.destroy();
    const defaultGrid = createGrid({ container: document.querySelector('#grid'), columns, dataSource: source, frozenRows: 1, frozenColumns: 1,
      renderCell(ctx, cell) {
        if (cell.columnKey !== 'custom') return false;
        ctx.fillStyle = '#ff0000'; ctx.fillRect(cell.x + 1, cell.y + 1, cell.width - 2, cell.height - 2); return true;
      } });
    await next();
    const fallbackMatches = baseline === document.querySelector('canvas').toDataURL();
    defaultGrid.destroy();
    calls.length = 0;
    const updatedGrid = createGrid({ container: document.querySelector('#grid'), columns, dataSource: source, frozenRows: 1, frozenColumns: 1,
      renderCell(ctx, cell) {
        calls.push(cell);
        if (cell.columnKey !== 'custom') return false;
        ctx.fillStyle = cell.value === raw ? '#ff0000' : '#00ff00';
        ctx.fillRect(-10000, -10000, 20000, 20000); return true;
      } });
    await next();
    calls.length = 0;
    updatedGrid.updateCells([{ rowIndex: 0, columnKey: 'custom', value: 'Changed' }]);
    await next();
    const partialCount = calls.length;
    const partial = document.querySelector('canvas').toDataURL();
    updatedGrid.render(); await next();
    const partialMatches = partial === document.querySelector('canvas').toDataURL();
    calls.length = 0;
    updatedGrid.updateCells([{ rowIndex: 999, columnKey: 'custom', value: 'Offscreen' }]); await next();
    const offscreenCount = calls.length;
    const scroller = document.querySelector('[aria-label="Read-only data grid viewport"]');
    scroller.scrollTop = 320; scroller.scrollLeft = 80; await next();
    const afterScroll = calls.map(cell => ({ rowIndex: cell.rowIndex, columnIndex: cell.columnIndex, x: cell.x, y: cell.y }));
    updatedGrid.destroy();
    return { first, initial, initialCount, fallbackMatches, partialCount, partialMatches, offscreenCount, afterScroll };
  });
  expect(result.first).toMatchObject({ rowId: 'row-0', columnKey: 'custom', value: { label: 'Raw object' }, same: true, frozen: true, x: 0, y: 36, width: 160, height: 32 });
  expect(result.initial.red).toEqual([255, 0, 0, 255]);
  expect(result.initial.plain).not.toEqual([0, 0, 255, 255]);
  expect(result.initial.broken).not.toEqual([0, 0, 255, 255]);
  expect(result.initial.header).not.toEqual([255, 0, 0, 255]);
  expect(result.initialCount).toBeLessThan(100);
  expect(result.fallbackMatches).toBe(true);
  expect(result.partialCount).toBe(1);
  expect(result.partialMatches).toBe(true);
  expect(result.offscreenCount).toBe(0);
  expect(result.afterScroll.some(cell => cell.rowIndex === 0 && cell.y === 36)).toBe(true);
  expect(result.afterScroll.some(cell => cell.rowIndex > 0 && cell.columnIndex === 0 && cell.x === 0)).toBe(true);
  expect(errors.some(error => error.includes('Cell renderer failed.'))).toBe(true);
});

test('native custom editors share validation, permissions, history, clipping and cleanup', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.source = new LocalDataSource(Array.from({ length: 100 }, (_, id) => ({ id, status: 'Review', name: 'Ada', count: 2 })), row => row.id);
    window.allowEdit = true;
    window.factoryMode = 'normal';
    window.editorCalls = [];
    window.grid = createGrid({ container: document.querySelector('#grid'), dataSource: window.source,
      frozenRows: 1, frozenColumns: 1,
      columns: [{ key: 'status', title: 'Status', editable: true }, { key: 'name', title: 'Name', editable: true },
        { key: 'count', title: 'Count', editable: true, parse: text => { const value = Number(text); if (value < 1) throw new Error('Positive count required'); return value; } }],
      resolveCellPermission: () => ({ editable: window.allowEdit }),
      createEditor(cell, doc) {
        window.editorCalls.push({ ...cell, frozen: Object.isFrozen(cell), ownDocument: doc === document });
        if (window.factoryMode === 'throw') throw new Error('Factory failure');
        if (window.factoryMode === 'attached') return document.querySelector('#grid');
        if (cell.columnKey === 'name') return null;
        if (cell.columnKey === 'count') {
          const input = doc.createElement('input'); input.type = 'number'; input.min = '1'; input.required = true; input.value = String(cell.value); return input;
        }
        const select = doc.createElement('select'); select.required = true;
        for (const value of ['', 'Review', 'Active']) { const option = doc.createElement('option'); option.value = option.textContent = value; select.append(option); }
        select.value = String(cell.value); return select;
      } });
  });
  const viewport = page.getByLabel(/^Data grid viewport/);
  await viewport.click({ position: { x: 20, y: 16 } });
  await viewport.press('F2');
  const select = page.getByRole('combobox', { name: 'Edit row 1, Status' });
  await expect(select).toHaveValue('Review');
  expect(await page.evaluate(() => window.editorCalls[0])).toMatchObject({ rowIndex: 0, rowId: 0, columnIndex: 0, columnKey: 'status', value: 'Review', frozen: true, ownDocument: true });
  await select.selectOption(''); await select.press('Enter');
  await expect(select).toHaveAttribute('aria-invalid', 'true');
  expect(await page.evaluate(() => window.source.getValue(0, 'status'))).toBe('Review');
  await select.selectOption('Active');
  await page.evaluate(() => { window.allowEdit = false; });
  await select.press('Enter'); await expect(select).toHaveAttribute('aria-invalid', 'true');
  await page.evaluate(() => { window.allowEdit = true; });
  await select.selectOption('Review'); await select.selectOption('Active');
  await select.press('Enter'); await expect(select).toHaveCount(0);
  expect(await page.evaluate(() => window.source.getValue(0, 'status'))).toBe('Active');
  await viewport.press('Control+z');
  expect(await page.evaluate(() => window.source.getValue(0, 'status'))).toBe('Review');
  await viewport.press('Control+y');
  expect(await page.evaluate(() => window.source.getValue(0, 'status'))).toBe('Active');
  await viewport.press('F2'); await select.selectOption('Review'); await select.press('Escape');
  expect(await page.evaluate(() => window.source.getValue(0, 'status'))).toBe('Active');
  await viewport.press('F2');
  await viewport.evaluate(el => { el.scrollTop = 300; el.scrollLeft = 70; });
  await expect(select).toBeVisible();
  expect(await select.evaluate(el => ({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth }))).toMatchObject({ left: 0, top: 0, width: 160 });
  await select.selectOption('Review'); await select.press('Tab');
  expect(await page.evaluate(() => window.source.getValue(0, 'status'))).toBe('Review');
  await viewport.press('Control+Home');
  await viewport.click({ position: { x: 180, y: 16 } }); await viewport.press('F2');
  const text = page.getByRole('textbox'); await expect(text).toHaveValue('Ada'); await text.fill('Default'); await text.press('Enter');
  await viewport.click({ position: { x: 340, y: 16 } }); await viewport.press('F2');
  const number = page.getByRole('spinbutton'); await number.fill('0'); await number.press('Enter');
  await expect(number).toHaveAttribute('aria-invalid', 'true');
  await number.fill('3'); await number.press('Enter');
  expect(await page.evaluate(() => window.source.getValue(0, 'count'))).toBe(3);
  await page.evaluate(() => { window.factoryMode = 'throw'; });
  await viewport.press('F2'); await expect(page.getByRole('alert')).toHaveText('Factory failure');
  await page.evaluate(() => { window.factoryMode = 'attached'; });
  await viewport.press('F2'); await expect(page.getByRole('alert')).toContainText('detached');
  await page.evaluate(() => { window.factoryMode = 'normal'; });
  await viewport.press('F2'); await expect(number).toBeVisible(); await expect(page.getByRole('alert')).toBeHidden();
  await number.fill('4');
  await page.evaluate(() => window.grid.destroy());
  await expect(number).toHaveCount(0);
  expect(await page.evaluate(() => window.source.getValue(0, 'count'))).toBe(3);
});

test('themes isolate mounts and keep editor/menu styles and translucent partial pixels consistent', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.theme = { background: 'rgba(255, 255, 255, 0.5)', textColor: '#112233', headerBackground: '#abcdef', headerTextColor: '#123456', gridLineColor: '#998877', selectionColor: '#ff0000', font: '16px monospace', headerFont: 'bold 18px monospace' };
    window.source = new LocalDataSource([{ id: 0, name: 'Ada' }, { id: 1, name: 'Grace' }], row => row.id);
    const options = { container: document.querySelector('#grid'), columns: [{ key: 'name', title: 'Name', editable: true }], dataSource: window.source, frozenRows: 1, frozenColumns: 1 };
    window.grid = createGrid({ ...options, theme: window.theme });
    window.theme.background = '#000000';
    window.failures = 0;
    for (const theme of [{ background: 'bad color' }, { font: 'bad font' }, { textColor: 'var(--color)' }]) {
      try { createGrid({ ...options, theme }); } catch { window.failures++; }
    }
    const other = document.createElement('div'); other.style.cssText = 'width:320px;height:160px'; document.body.append(other);
    window.other = createGrid({ ...options, container: other });
  });
  expect(await page.evaluate(() => window.failures)).toBe(3);
  const viewport = page.getByLabel(/^Data grid viewport/).first();
  await viewport.click({ position: { x: 20, y: 16 } }); await viewport.press('F2');
  const input = page.getByRole('textbox');
  expect(await input.evaluate(el => { const s = getComputedStyle(el); return { color: s.color, border: s.borderTopColor, background: s.backgroundColor, font: s.fontFamily }; })).toEqual({ color: 'rgb(17, 34, 51)', border: 'rgb(255, 0, 0)', background: 'rgba(255, 255, 255, 0.5)', font: 'monospace' });
  await input.fill('Changed'); await input.press('Enter');
  const result = await page.evaluate(async () => {
    const next = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await next();
    const canvas = document.querySelector('#grid canvas');
    const ctx = canvas.getContext('2d');
    const header = [...ctx.getImageData(100, 15, 1, 1).data];
    const partial = canvas.toDataURL(); window.grid.render(); await next();
    const match = partial === canvas.toDataURL();
    const defaults = [...document.querySelectorAll('canvas')][1].getContext('2d').getImageData(100, 15, 1, 1).data;
    return { header, match, defaults: [...defaults], roots: document.querySelectorAll('#grid > div').length };
  });
  expect(result.header).toEqual([171, 205, 239, 255]);
  expect(result.defaults).toEqual([237, 242, 247, 255]);
  expect(result.match).toBe(true);
  expect(result.roots).toBe(1);
  await viewport.click({ position: { x: 20, y: 16 }, button: 'right' });
  const menu = page.getByRole('menu', { name: 'Cell actions' });
  expect(await menu.evaluate(el => getComputedStyle(el).color)).toBe('rgb(17, 34, 51)');
  await page.getByRole('menuitem', { name: 'Resize column…' }).click();
  expect(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).color)).toBe('rgb(17, 34, 51)');
});

test('Ctrl/Meta adds ranges across panes, edits active cell, guards clipboard and preserves partial pixels', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.ranges = []; window.events = [];
    window.source = new LocalDataSource(Array.from({ length: 100 }, (_, id) => ({ id, name: 'Ada', team: 'Ops' })), row => row.id);
    window.grid = createGrid({ container: document.querySelector('#grid'), columns: [{ key: 'id', title: 'ID' }, { key: 'name', title: 'Name', editable: true }, { key: 'team', title: 'Team', editable: true }], dataSource: window.source,
      frozenRows: 1, frozenColumns: 1, theme: { selectionColor: 'rgba(0, 128, 128, .5)' },
      onSelectionRangesChange: ranges => window.ranges.push(ranges), onEvent: event => window.events.push(event) });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {}, readText: async () => 'Changed' } });
  });
  const viewport = page.getByLabel(/^Data grid viewport/);
  await viewport.click({ position: { x: 20, y: 16 } });
  await viewport.click({ position: { x: 180, y: 80 }, modifiers: ['Control'] });
  await viewport.press('Shift+ArrowRight');
  expect(await page.evaluate(() => window.grid.getSelectionRanges())).toEqual([
    { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
    { startRow: 2, endRow: 2, startColumn: 1, endColumn: 2 },
  ]);
  await viewport.click({ position: { x: 180, y: 144 }, modifiers: ['Meta'] });
  expect(await page.evaluate(() => window.grid.getSelectionRanges().length)).toBe(3);
  await viewport.press('F2'); const input = page.getByRole('textbox'); await input.fill('Edited'); await input.press('Enter');
  expect(await page.evaluate(() => window.grid.getSelectionRanges().length)).toBe(3);
  expect(await page.evaluate(() => window.source.getValue(4, 'name'))).toBe('Edited');
  await viewport.click({ position: { x: 180, y: 144 }, button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Copy', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).toBeDisabled();
  await page.getByRole('menu').press('Escape');
  const result = await page.evaluate(async () => {
    let denied = 0;
    for (const action of [() => window.grid.copySelection(), () => window.grid.paste('Unexpected')]) { try { action(); } catch { denied++; } }
    window.grid.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Dirty' }, { rowIndex: 2, columnKey: 'team', value: 'Dirty' }, { rowIndex: 4, columnKey: 'name', value: 'Dirty' }]);
    const next = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await next(); const partial = document.querySelector('canvas').toDataURL(); window.grid.render(); await next();
    return { denied, match: partial === document.querySelector('canvas').toDataURL(), callback: window.ranges.at(-1), event: window.events.filter(event => event.type === 'selection:change').at(-1).ranges };
  });
  expect(result.denied).toBe(2); expect(result.match).toBe(true); expect(result.callback).toEqual(result.event);
  await viewport.press('ArrowDown'); expect(await page.evaluate(() => window.grid.getSelectionRanges().length)).toBe(1);
  await viewport.press('Escape'); expect(await page.evaluate(() => window.grid.getSelectionRanges())).toEqual([]);
  await viewport.press('Control+Home'); await viewport.press('Shift+F8');
  await expect(page.getByRole('status')).toContainText('Next click or navigation adds a range.');
  await viewport.press('Control+End'); await viewport.press('Shift+ArrowLeft');
  expect(await page.evaluate(() => window.grid.getSelectionRanges())).toEqual([
    { startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 },
    { startRow: 99, endRow: 99, startColumn: 1, endColumn: 2 },
  ]);
  await expect(page.getByRole('status')).toContainText('2 selected range(s).');
  await expect(page.getByRole('status')).not.toContainText('Next click');
  await viewport.press('Escape'); await expect(page.getByRole('status')).toHaveText('Selection cleared.');
});

test('resize guides defer row/column geometry until release and Escape/cancel preserve selection', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); const { LocalDataSource } = await import('/core/index.js');
    window.events = [];
    window.grid = createGrid({ container: document.querySelector('#grid'), frozenColumns: 1, columns: [{ key: 'name', title: 'Name', editable: true }, { key: 'team', title: 'Team' }],
      dataSource: new LocalDataSource(Array.from({ length: 30 }, (_, id) => ({ id, name: 'Ada', team: 'Ops' })), row => row.id),
      onEvent: event => window.events.push(event) });
  });
  const viewport = page.getByLabel(/^Data grid viewport/); await viewport.click({ position: { x: 20, y: 16 } });
  const bounds = await viewport.boundingBox(); const guide = page.locator('[data-grid-resize-guide]');
  await page.mouse.move(bounds.x + 166, bounds.y - 18); await page.mouse.down(); await page.mouse.move(bounds.x + 226, bounds.y - 18);
  await expect(guide).toBeVisible(); await expect(guide).toHaveAttribute('data-axis', 'column');
  expect(await page.evaluate(() => window.events.filter(event => event.type === 'column:resize').length)).toBe(0);
  expect(await viewport.evaluate(el => el.firstChild.style.width)).toBe('320px');
  await page.mouse.up(); await expect(guide).toBeHidden();
  expect(await viewport.evaluate(el => el.firstChild.style.width)).toBe('380px');
  expect(await page.evaluate(() => window.events.filter(event => event.type === 'column:resize').length)).toBe(1);
  await page.mouse.move(bounds.x + 226, bounds.y - 18); await page.mouse.down(); await page.mouse.move(bounds.x + 270, bounds.y - 18); await page.keyboard.press('Escape'); await page.mouse.up();
  expect(await viewport.evaluate(el => el.firstChild.style.width)).toBe('380px'); await expect(guide).toBeHidden();
  const selection = await page.evaluate(() => window.grid.getSelection());
  await page.mouse.move(bounds.x + 80, bounds.y + 32); await page.mouse.down(); await page.mouse.move(bounds.x + 80, bounds.y + 64);
  await expect(guide).toBeVisible(); await expect(guide).toHaveAttribute('data-axis', 'row');
  expect(await viewport.evaluate(el => el.firstChild.style.height)).toBe('960px');
  await page.mouse.up(); expect(await viewport.evaluate(el => el.firstChild.style.height)).toBe('992px');
  expect(await page.evaluate(() => window.grid.getSelection())).toEqual(selection);
  expect(await page.evaluate(() => window.events.filter(event => event.type === 'row:resize').length)).toBe(1);
  await viewport.press('F2'); const input = page.getByRole('textbox'); expect(await input.evaluate(el => el.offsetHeight)).toBe(64); await input.press('Escape');
  await page.mouse.move(bounds.x + 80, bounds.y + 64); await page.mouse.down(); await page.mouse.move(bounds.x + 80, bounds.y + 90);
  await page.evaluate(() => document.querySelector('[data-grid-resize-guide]').parentElement.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true })));
  await page.mouse.up(); expect(await viewport.evaluate(el => el.firstChild.style.height)).toBe('992px'); await expect(guide).toBeHidden();
});


test('multiline overlay grows, preserves invalid drafts, inserts newlines and saves before Tab navigation', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); const { LocalDataSource } = await import('/core/index.js');
    window.source = new LocalDataSource(Array.from({ length: 50 }, (_, id) => ({ id, name: 'Ada', team: 'Ops' })), row => row.id);
    window.grid = createGrid({ container: document.querySelector('#grid'), frozenColumns: 1, multilineEditor: true, wrapText: true,
      columns: [{ key: 'id', title: 'ID' }, { key: 'name', title: 'Name', editable: true, parse: text => { if (!text.trim()) throw new Error('Name is required.'); return text; } }, { key: 'team', title: 'Team', editable: true }], dataSource: window.source });
  });
  const viewport = page.getByLabel(/^Data grid viewport/);
  await viewport.click({ position: { x: 180, y: 16 } }); await viewport.press('F2');
  const editor = page.getByRole('textbox');
  await editor.fill('A long description that expands beyond the original cell width.');
  expect(await editor.evaluate(el => el.offsetWidth)).toBeGreaterThan(160);
  await editor.press('End'); await editor.press('Alt+Enter'); await editor.press('Control+Enter');
  expect(await editor.inputValue()).toContain('\n\n'); expect(await editor.evaluate(el => el.offsetHeight)).toBeGreaterThan(32);
  await editor.fill(''); await editor.press('Enter');
  await expect(page.getByRole('alert')).toHaveText('Name is required.'); await expect(editor).toHaveAttribute('aria-invalid', 'true');
  expect(await page.evaluate(() => window.source.getValue(0, 'name'))).toBe('Ada');
  await editor.fill('First line\nSecond line'); await expect(page.getByRole('alert')).toHaveCount(0);
  await editor.press('Tab'); await expect(editor).toHaveCount(0);
  expect(await page.evaluate(() => window.source.getValue(0, 'name'))).toBe('First line\nSecond line');
  expect(await page.evaluate(() => window.grid.getSelection().columnIndex)).toBe(2);
  await viewport.press('F2'); await editor.fill('Discard'); await editor.press('Escape');
  expect(await page.evaluate(() => window.source.getValue(0, 'team'))).toBe('Ops');
  await viewport.press('Control+z'); expect(await page.evaluate(() => window.source.getValue(0, 'name'))).toBe('Ada');
  await viewport.press('Control+y'); expect(await page.evaluate(() => window.source.getValue(0, 'name'))).toBe('First line\nSecond line');
  await viewport.click({ position: { x: 180, y: 16 } }); await viewport.press('F2'); await editor.fill('Preserved draft');
  await viewport.evaluate(el => { el.scrollTop = 700; });
  await expect(editor).toHaveValue('Preserved draft'); await expect.poll(() => editor.evaluate(el => el.parentElement.style.clipPath)).toBe('inset(100%)');
  await viewport.evaluate(el => { el.scrollTop = 0; }); await expect(editor).toBeVisible(); await editor.press('Escape');
  expect(await page.evaluate(async () => {
    window.grid.setRowHeight(0, 96); window.grid.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Wrapped text\nSecond line' }]);
    const next = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await next(); const partial = document.querySelector('canvas').toDataURL(); window.grid.render(); await next();
    return partial === document.querySelector('canvas').toDataURL();
  })).toBe(true);
});


test('grid search counts selectable local matches, reveals panes, wraps navigation and refreshes after edits', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); const { LocalDataSource } = await import('/core/index.js');
    window.source = new LocalDataSource(Array.from({ length: 100 }, (_, id) => ({ id, name: id === 0 || id === 99 || id === 5 ? 'Needle' : 'Other', team: id === 99 ? 'NEEDLE' : 'Ops' })), row => row.id);
    window.grid = createGrid({ container: document.querySelector('#grid'), frozenRows: 1, frozenColumns: 1,
      resolveCellPermission: cell => cell.rowIndex === 5 ? { selectable: false } : undefined,
      columns: [{ key: 'id', title: 'ID' }, { key: 'name', title: 'Name', editable: true, parse: text => { if (!text) throw new Error('Required'); return text; } }, { key: 'team', title: 'Team' }], dataSource: window.source });
  });
  const viewport = page.getByLabel(/^Data grid viewport/); await viewport.focus(); await viewport.press('Control+f');
  const search = page.getByRole('search', { name: 'Find in grid' }); const input = search.getByRole('searchbox');
  await input.fill('needle'); await expect(search.getByRole('status')).toHaveText('1 of 3');
  expect(await page.evaluate(() => window.grid.getSelection())).toMatchObject({ rowIndex: 0, columnIndex: 1 });
  await input.press('Enter'); await expect(search.getByRole('status')).toHaveText('2 of 3');
  expect(await page.evaluate(() => window.grid.getSelection())).toMatchObject({ rowIndex: 99, columnIndex: 1 });
  expect(await viewport.evaluate(el => el.scrollTop)).toBeGreaterThan(2000);
  await search.getByRole('button', { name: 'Next match' }).click(); await expect(search.getByRole('status')).toHaveText('3 of 3');
  await input.press('Enter'); await expect(search.getByRole('status')).toHaveText('1 of 3');
  await input.press('Shift+Enter'); await expect(search.getByRole('status')).toHaveText('3 of 3');
  await page.evaluate(() => window.grid.updateCells([{ rowIndex: 99, columnKey: 'team', value: 'Ops' }]));
  await expect(search.getByRole('status')).toHaveText('1 of 2');
  const pixels = await page.evaluate(async () => {
    const next = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await next(); const partial = document.querySelector('canvas').toDataURL(); window.grid.render(); await next();
    return partial === document.querySelector('canvas').toDataURL();
  }); expect(pixels).toBe(true);
  await input.fill('missing'); await expect(search.getByRole('status')).toHaveText('No matches'); await expect(search.getByRole('button', { name: 'Next match' })).toBeDisabled();
  await input.press('Escape'); await expect(search).toBeHidden(); await expect(viewport).toBeFocused();
  await viewport.press('Control+Home'); await viewport.press('ArrowRight'); await viewport.press('F2');
  const editor = page.getByRole('textbox'); await editor.fill(''); await editor.press('Control+f');
  await expect(editor).toBeVisible(); await expect(page.getByRole('alert')).toHaveText('Required'); await expect(search).toBeHidden();
  await editor.press('Escape'); await viewport.press('Meta+f'); await expect(search).toBeVisible();
  await input.fill('Needle'); await expect(search.getByRole('status')).toHaveText('1 of 2');
  await page.evaluate(() => window.grid.destroy()); await expect(search).toHaveCount(0);
});


test('right-click freeze/unfreeze changes pane geometry without remounting or clearing data history', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); const { LocalDataSource } = await import('/core/index.js');
    window.events = [];
    window.source = new LocalDataSource(Array.from({ length: 100 }, (_, id) => ({ id, name: `Name ${id}`, team: 'Ops' })), row => row.id);
    window.grid = createGrid({ container: document.querySelector('#grid'), columns: [{ key: 'id', title: 'ID' }, { key: 'name', title: 'Name', editable: true }, { key: 'team', title: 'Team' }], dataSource: window.source, onEvent: event => window.events.push(event) });
    window.grid.updateCells([{ rowIndex: 1, columnKey: 'name', value: 'Edited' }]);
  });
  const viewport = page.getByLabel(/^Data grid viewport/);
  await viewport.click({ position: { x: 180, y: 48 }, button: 'right' });
  await page.getByRole('menuitem', { name: 'Freeze through this cell', exact: true }).click();
  expect(await page.evaluate(() => [window.grid.frozenRows, window.grid.frozenColumns])).toEqual([2, 2]);
  expect(await page.evaluate(() => window.events.filter(e => e.type === 'freeze:change').length)).toBe(1);
  await viewport.evaluate(el => { el.scrollTop = 1000; }); await viewport.click({ position: { x: 180, y: 48 } });
  expect(await page.evaluate(() => window.grid.getSelection())).toMatchObject({ rowIndex: 1, columnIndex: 1 });
  await viewport.press('F2'); const editor = page.getByRole('textbox'); await expect(editor).toHaveValue('Edited');
  expect(await page.evaluate(() => { try { window.grid.setFrozen(0, 0); } catch (e) { return e.message; } })).toMatch(/Finish editing/);
  await editor.press('Escape'); await viewport.press('Control+z'); expect(await page.evaluate(() => window.source.getValue(1, 'name'))).toBe('Name 1');
  await viewport.click({ position: { x: 180, y: 48 }, button: 'right' }); await page.getByRole('menuitem', { name: 'Unfreeze rows', exact: true }).click();
  expect(await page.evaluate(() => [window.grid.frozenRows, window.grid.frozenColumns])).toEqual([0, 2]);
  await viewport.click({ position: { x: 180, y: 48 }, button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Freeze rows through this row', exact: true })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Unfreeze table', exact: true }).click();
  expect(await page.evaluate(() => [window.grid.frozenRows, window.grid.frozenColumns])).toEqual([0, 0]);
  await viewport.press('Control+Home'); await viewport.click({ position: { x: 180, y: 48 }, button: 'right' });
  await page.getByRole('menuitem', { name: 'Freeze columns through this column', exact: true }).click();
  expect(await page.evaluate(() => [window.grid.frozenRows, window.grid.frozenColumns])).toEqual([0, 2]);
  expect(await page.locator('canvas').count()).toBe(1);
  expect(await page.evaluate(async () => {
    window.grid.updateCells([{ rowIndex: 1, columnKey: 'name', value: 'Dirty' }]);
    const next = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await next(); const partial = document.querySelector('canvas').toDataURL(); window.grid.render(); await next();
    return partial === document.querySelector('canvas').toDataURL();
  })).toBe(true);
});


test('lock menus guard edits and APIs, retain copy, show scope unlock and honor disabled admin management', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); const { LocalDataSource } = await import('/core/index.js');
    window.source = new LocalDataSource([{ id: 0, name: 'Ada' }, { id: 1, name: 'Grace' }], row => row.id);
    window.columns = [{ key: 'id', title: 'ID' }, { key: 'name', title: 'Name', editable: true }];
    window.grid = createGrid({ container: document.querySelector('#grid'), dataSource: window.source, columns: window.columns,
      resolveCellPermission: cell => cell.rowIndex === 1 ? { writable: false } : undefined });
  });
  const viewport = page.getByLabel(/^Data grid viewport/);
  await viewport.click({ position: { x: 180, y: 16 }, button: 'right' }); await page.getByRole('menuitem', { name: 'Lock cell', exact: true }).click();
  await viewport.press('F2'); await expect(page.getByRole('textbox')).toHaveCount(0);
  expect(await page.evaluate(() => window.grid.copySelection())).toBe('Ada');
  expect(await page.evaluate(() => { try { window.grid.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Denied' }]); } catch (e) { return e.message; } })).toMatch(/writable/);
  await viewport.click({ position: { x: 180, y: 16 }, button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Edit cell', exact: true })).toBeDisabled(); await expect(page.getByRole('menuitem', { name: 'Cell is read-only', exact: true })).toBeDisabled();
  await page.getByRole('menuitem', { name: 'Unlock cell', exact: true }).click(); await viewport.press('F2');
  const editor = page.getByRole('textbox'); await editor.fill('Changed'); await editor.press('Enter');
  await viewport.click({ position: { x: 180, y: 16 }, button: 'right' }); await page.getByRole('menuitem', { name: 'Lock table', exact: true }).click();
  await viewport.click({ position: { x: 180, y: 16 }, button: 'right' }); await page.getByRole('menuitem', { name: 'Unlock table', exact: true }).click();
  await viewport.press('Control+z'); expect(await page.evaluate(() => window.source.getValue(0, 'name'))).toBe('Ada');
  await viewport.click({ position: { x: 180, y: 48 }, button: 'right' }); await page.getByRole('menuitem', { name: 'Lock row', exact: true }).click();
  await viewport.click({ position: { x: 180, y: 48 }, button: 'right' }); await page.getByRole('menuitem', { name: 'Unlock row', exact: true }).click();
  await viewport.press('F2'); await expect(editor).toHaveCount(0); // Host permission still denies this row.
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); window.grid.destroy();
    window.grid = createGrid({ container: document.querySelector('#grid'), dataSource: window.source, columns: window.columns, allowLockChanges: false });
  });
  await viewport.click({ position: { x: 180, y: 16 }, button: 'right' }); await expect(page.getByRole('menuitem', { name: 'Lock table', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => { try { window.grid.setLocked({ scope: 'table' }, true); } catch (e) { return e.message; } })).toMatch(/disabled/);
});


test('configured select and boolean checkbox share parser validation, locks, history and partial paint', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); const { LocalDataSource } = await import('/core/index.js');
    window.source = new LocalDataSource([{ id: 0, status: 'Active', approved: true }, { id: 1, status: 'Review', approved: false }, { id: 2, status: 'Active', approved: true }], row => row.id);
    const values = ['Active', 'Review'];
    window.grid = createGrid({ container: document.querySelector('#grid'), dataSource: window.source,
      columns: [{ key: 'id', title: 'ID' }, { key: 'status', title: 'Status', editable: true, parse: text => { if (!['Active', 'Review'].includes(text)) throw new Error('Invalid status'); return text; } },
        { key: 'approved', title: 'Approved', editable: true, parse: text => { if (!['true', 'false'].includes(text)) throw new Error('Invalid boolean'); return text === 'true'; } }],
      columnEditors: { status: { type: 'select', values }, approved: { type: 'checkbox' } }, resolveCellPermission: c => c.rowIndex === 1 ? { writable: false } : undefined });
    values.push('Unexpected');
  });
  const viewport = page.getByLabel(/^Data grid viewport/); await viewport.click({ position: { x: 180, y: 16 } }); await viewport.press('F2');
  const select = page.getByRole('combobox'); expect(await select.locator('option').allTextContents()).toEqual(['Active', 'Review']);
  await select.selectOption('Review'); await select.press('Enter'); expect(await page.evaluate(() => window.source.getValue(0, 'status'))).toBe('Review');
  await viewport.click({ position: { x: 334, y: 16 } }); expect(await page.evaluate(() => window.source.getValue(0, 'approved'))).toBe(false);
  await viewport.press('Control+z'); expect(await page.evaluate(() => window.source.getValue(0, 'approved'))).toBe(true);
  await viewport.press('Control+y'); expect(await page.evaluate(() => window.source.getValue(0, 'approved'))).toBe(false);
  await viewport.press('F2'); const checkbox = page.getByRole('checkbox'); await expect(checkbox).not.toBeChecked(); await checkbox.check(); await checkbox.press('Enter');
  expect(await page.evaluate(() => window.source.getValue(0, 'approved'))).toBe(true);
  await viewport.click({ position: { x: 334, y: 48 } }); await viewport.press('F2'); await expect(checkbox).toHaveCount(0);
  expect(await page.evaluate(() => window.source.getValue(1, 'approved'))).toBe(false);
  await page.evaluate(() => window.grid.setLocked({ scope: 'column', columnIndex: 2 }, true));
  await viewport.click({ position: { x: 334, y: 80 } }); expect(await page.evaluate(() => window.source.getValue(2, 'approved'))).toBe(true);
  expect(await page.evaluate(() => window.grid.copySelection())).toBe('true');
  expect(await page.evaluate(async () => {
    window.grid.setLocked({ scope: 'column', columnIndex: 2 }, false); window.grid.updateCells([{ rowIndex: 2, columnKey: 'approved', value: false }]);
    const next = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await next(); const partial = document.querySelector('canvas').toDataURL(); window.grid.render(); await next(); return partial === document.querySelector('canvas').toDataURL();
  })).toBe(true);
  await viewport.click({ position: { x: 180, y: 16 } });
  expect(await page.evaluate(() => { try { window.grid.paste('Bogus'); } catch (e) { return e.message; } })).toBe('Invalid status');
  expect(await page.evaluate(() => window.source.getValue(0, 'status'))).toBe('Review');
  expect(await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); window.grid.destroy();
    try { createGrid({ container: document.querySelector('#grid'), dataSource: window.source, columns: [{ key: 'approved', title: 'Approved', editable: true }], columnEditors: { approved: { type: 'checkbox' } } }); } catch (e) { return { message: e.message, roots: document.querySelectorAll('#grid > div').length }; }
  })).toEqual({ message: 'Checkbox columns require a boolean parser.', roots: 0 });
});
