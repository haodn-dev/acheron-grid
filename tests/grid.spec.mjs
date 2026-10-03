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
    return [...canvas.getContext('2d').getImageData(160 * ratio, 80 * ratio, 1, 1).data];
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

test('header selects a column while blank space, modified keys and empty data remain safe', async ({ page }) => {
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
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toEqual({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 });
  await viewport.press('Escape');
  await viewport.click({ position: { x: 300, y: 100 } });
  expect(await page.evaluate(() => window.grid.getSelection())).toBeNull();
  await viewport.focus();
  await page.keyboard.press('Alt+ArrowDown');
  expect(await page.evaluate(() => window.grid.getSelection())).toBeNull();
  await page.keyboard.press('Tab');
  const header = page.getByRole('button', { name: 'Select column Name', exact: true }); await expect(header).toBeFocused();
  await header.press('Shift+F10'); await expect(page.getByRole('menu', { name: 'Column actions' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).press('Escape');
  await viewport.press('Tab'); await header.press('Tab');
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
        ctx.fillStyle = '#ff0000'; ctx.fillRect(cell.x, cell.y, cell.width, cell.height); return true;
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
  expect(result.header).toEqual([181, 180, 210, 255]);
  expect(result.defaults).toEqual([237, 242, 247, 255]);
  expect(result.match).toBe(true);
  expect(result.roots).toBe(1);
  await viewport.click({ position: { x: 20, y: 16 }, button: 'right' });
  const menu = page.getByRole('menu', { name: 'Cell actions' });
  expect(await menu.evaluate(el => getComputedStyle(el).color)).toBe('rgb(17, 34, 51)');
  await page.getByRole('menuitem', { name: 'Resize column…' }).click();
  expect(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).color)).toBe('rgb(17, 34, 51)');
});

test('Ctrl/Meta adds ranges across panes, edits active cell, validates clipboard and preserves partial pixels', async ({ page }) => {
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
  await expect(page.getByRole('menuitem', { name: 'Copy', exact: true })).toBeEnabled();
  await expect(page.getByRole('menuitem', { name: 'Paste', exact: true })).toBeEnabled();
  await page.getByRole('menu').press('Escape');
  const result = await page.evaluate(async () => {
    let denied = 0;
    for (const action of [() => window.grid.copySelection(), () => window.grid.paste('Unexpected')]) { try { action(); } catch { denied++; } }
    window.grid.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Dirty' }, { rowIndex: 2, columnKey: 'team', value: 'Dirty' }, { rowIndex: 4, columnKey: 'name', value: 'Dirty' }]);
    const next = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await next(); const partial = document.querySelector('canvas').toDataURL(); window.grid.render(); await next();
    return { denied, match: partial === document.querySelector('canvas').toDataURL(), callback: window.ranges.at(-1), event: window.events.filter(event => event.type === 'selection:change').at(-1).ranges };
  });
  expect(result.denied).toBe(1); expect(result.match).toBe(true); expect(result.callback).toEqual(result.event);
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
  await editor.press('Escape'); await viewport.press('Control+z');
  expect(await page.evaluate(()=>[window.grid.frozenRows,window.grid.frozenColumns])).toEqual([0,0]);
  expect(await page.evaluate(()=>window.source.getValue(1,'name'))).toBe('Edited');
  await viewport.press('Control+z');expect(await page.evaluate(()=>window.source.getValue(1,'name'))).toBe('Name 1');
  await page.evaluate(()=>{window.grid.redo();window.grid.redo();});
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


test('image cells load once per visible URL, repaint on load, contain/clip and release late callbacks', async ({ page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  let pending; let later; let requests = 0;
  await page.route('**/slow.svg', route => { requests++; pending = route; });
  await page.route('**/later.svg', route => { later = route; });
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); const { LocalDataSource } = await import('/core/index.js');
    window.labels = []; const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { window.labels.push(text); return fillText.call(this, text, ...args); };
    window.blueImage = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20"><rect width="10" height="20" fill="blue"/></svg>');
    window.source = new LocalDataSource(Array.from({ length: 100 }, (_, id) => ({ id, avatar: id < 2 ? '/slow.svg' : id === 2 ? 'javascript:alert(1)' : window.blueImage, name: 'Ada' })), row => row.id);
    window.grid = createGrid({ container: document.querySelector('#grid'), frozenRows: 1, frozenColumns: 1, imageColumns: ['avatar'],
      columns: [{ key: 'id', title: 'ID' }, { key: 'avatar', title: 'Avatar' }, { key: 'name', title: 'Name', editable: true }], dataSource: window.source });
  });
  await expect.poll(() => !!pending).toBe(true); await expect.poll(() => page.evaluate(() => window.labels.includes('Loading…') && window.labels.includes('Image unavailable'))).toBe(true);
  expect(requests).toBe(1); expect(await page.locator('img').count()).toBe(0);
  const pixel = (x, y) => page.locator('canvas').evaluate((canvas, [x, y]) => Array.from(canvas.getContext('2d').getImageData(x, y, 1, 1).data), [x, y]);
  const red = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="20"><rect width="10" height="20" fill="red"/></svg>';
  const viewport = page.getByLabel(/^Data grid viewport/);
  await viewport.click({ position: { x: 340, y: 16 }, button: 'right' });
  await pending.fulfill({ contentType: 'image/svg+xml', body: red });
  await expect.poll(() => pixel(240, 52)).toEqual([255, 0, 0, 255]); expect(await pixel(220, 52)).toEqual([255, 255, 255, 255]);
  await expect(page.getByRole('menu', { name: 'Cell actions' })).toBeVisible(); await page.getByRole('menu').press('Escape');
  await page.evaluate(() => window.grid.setRowHeight(0, 64)); await expect.poll(() => pixel(240, 68)).toEqual([255, 0, 0, 255]);
  await viewport.evaluate(el => { el.scrollTop = 500; }); await expect.poll(() => pixel(240, 68)).toEqual([255, 0, 0, 255]);
  expect(await page.evaluate(async () => {
    window.grid.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Dirty' }]);
    const next = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await next(); const partial = document.querySelector('canvas').toDataURL(); window.grid.render(); await next(); return partial === document.querySelector('canvas').toDataURL();
  })).toBe(true);
  await page.evaluate(() => window.grid.updateCells([{ rowIndex: 0, columnKey: 'avatar', value: window.blueImage }]));
  await expect.poll(() => pixel(240, 68)).toEqual([0, 0, 255, 255]);
  await page.evaluate(() => window.grid.updateCells([{ rowIndex: 0, columnKey: 'avatar', value: '/later.svg' }]));
  await expect.poll(() => !!later).toBe(true); await page.evaluate(() => window.grid.destroy());
  await later.fulfill({ contentType: 'image/svg+xml', body: red });
  await expect(page.locator('canvas')).toHaveCount(0); expect(errors).toEqual([]);
});


test('format dialog colors multiple ranges, preserves value history and applies scopes with admin veto', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); const { LocalDataSource } = await import('/core/index.js');
    window.blockFormat = false;
    window.source = new LocalDataSource(Array.from({ length: 30 }, (_, id) => ({ id, name: 'Ada', team: 'Ops' })), row => row.id);
    window.grid = createGrid({ container: document.querySelector('#grid'), frozenRows: 1, frozenColumns: 1,
      columns: [{ key: 'id', title: 'ID' }, { key: 'name', title: 'Name', editable: true }, { key: 'team', title: 'Team' }], dataSource: window.source,
      resolveCellPermission: cell => window.blockFormat ? { formatting: false } : cell.rowIndex === 1 ? { writable: false } : undefined });
  });
  const viewport = page.getByLabel(/^Data grid viewport/);
  await viewport.click({ position: { x: 180, y: 16 } }); await viewport.click({ position: { x: 340, y: 48 }, modifiers: ['Shift'] });
  await viewport.click({ position: { x: 180, y: 112 }, modifiers: ['Control'] });
  await viewport.click({ position: { x: 180, y: 112 }, button: 'right' }); await page.getByRole('menuitem', { name: 'Format cells…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Format cells' });
  await dialog.getByLabel('Background color', { exact: true }).fill('#ffee00'); await dialog.getByLabel('Change text color', { exact: true }).check();
  await dialog.getByLabel('Text color', { exact: true }).fill('#123456'); await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await page.evaluate(() => window.grid.getSelectionRanges().length)).toBe(2);
  expect(await page.evaluate(() => [window.grid.getFormat(0, 1), window.grid.getFormat(1, 2), window.grid.getFormat(3, 1), window.grid.getFormat(2, 1)])).toEqual([
    { background: '#ffee00', textColor: '#123456' }, { background: '#ffee00', textColor: '#123456' }, { background: '#ffee00', textColor: '#123456' }, {}]);
  await viewport.press('F2'); const editor = page.getByRole('textbox'); await expect(editor).toHaveCSS('color', 'rgb(18, 52, 86)');
  expect(await page.evaluate(() => { try { window.grid.format([{ scope: 'table' }], { background: '#000000' }); } catch (e) { return e.message; } })).toMatch(/Finish editing/);
  await editor.fill('Edited'); await editor.press('Enter'); await viewport.press('Control+z');
  expect(await page.evaluate(() => window.source.getValue(3, 'name'))).toBe('Ada'); expect(await page.evaluate(() => window.grid.getFormat(3, 1).background)).toBe('#ffee00');
  await viewport.press('Control+z'); expect(await page.evaluate(() => window.grid.getFormat(3, 1))).toEqual({});
  await viewport.press('Control+y'); await viewport.press('Control+y'); expect(await page.evaluate(() => window.source.getValue(3, 'name'))).toBe('Edited');
  await viewport.click({ position: { x: 180, y: 16 }, button: 'right' }); await page.getByRole('menuitem', { name: 'Format cells…' }).click();
  await dialog.getByLabel('Apply to').selectOption('column'); await dialog.getByLabel('Background color', { exact: true }).fill('#ccffcc'); await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await page.evaluate(() => window.grid.getFormat(29, 1))).toEqual({ background: '#ccffcc' });
  expect(await page.evaluate(() => window.grid.getFormat(0, 1))).toEqual({ background: '#ccffcc', textColor: '#123456' });
  await viewport.click({ position: { x: 180, y: 16 }, button: 'right' }); await page.getByRole('menuitem', { name: 'Format cells…' }).click();
  await dialog.getByLabel('Apply to').selectOption('row'); await dialog.getByRole('button', { name: 'Clear formatting' }).click();
  expect(await page.evaluate(() => window.grid.getFormat(0, 1))).toEqual({}); expect(await page.evaluate(() => window.grid.getFormat(29, 1).background)).toBe('#ccffcc');
  expect(await page.evaluate(async () => {
    window.grid.format([{ scope: 'column', columnIndex: 2 }], { background: '#00ff0080' }); window.grid.updateCells([{ rowIndex: 0, columnKey: 'team', value: 'Dirty' }]);
    const next = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await next(); const partial = document.querySelector('canvas').toDataURL(); window.grid.render(); await next(); return partial === document.querySelector('canvas').toDataURL();
  })).toBe(true);
  await page.evaluate(() => { window.blockFormat = true; window.grid.render(); });
  await viewport.click({ position: { x: 180, y: 16 }, button: 'right' }); await expect(page.getByRole('menuitem', { name: 'Format cells…' })).toBeDisabled();
  expect(await page.evaluate(() => { try { window.grid.format([{ scope: 'table' }], { background: '#000000' }); } catch (e) { return e.message; } })).toMatch(/formatting/);
  await page.getByRole('menu').press('Escape'); await page.evaluate(() => window.grid.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Value write still allowed' }]));
  expect(await page.evaluate(() => window.source.getValue(0, 'name'))).toBe('Value write still allowed');
});


test('active-cell ARIA mirror follows selection, history, locks and focus with bounded DOM', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const values = new Map();
    window.grid = createGrid({ container: document.querySelector('#grid'), frozenRows: 1, frozenColumns: 1,
      columns: [{ key: 'id', title: 'ID' }, { key: 'name', title: 'Name', editable: true }],
      dataSource: { getRowCount: () => 1_000_000, getRowId: row => row,
        getValue: (row, key) => values.get(`${row}:${key}`) ?? (key === 'id' ? row : `Record ${row}`),
        setValue: (row, key, value) => values.set(`${row}:${key}`, value) } });
    const other = document.createElement('div'); other.id = 'other'; other.style.cssText = 'width:200px;height:100px'; document.body.append(other);
    window.otherGrid = createGrid({ container: other, columns: [{ key: 'x', title: 'Other' }],
      dataSource: { getRowCount: () => 0, getRowId: row => row, getValue: () => null } });
  });
  const viewport = page.locator('#grid [role="grid"]');
  const cell = viewport.getByRole('gridcell');
  await expect(viewport).toHaveAttribute('aria-rowcount', '1000000');
  await expect(viewport).toHaveAttribute('aria-colcount', '2');
  await expect(viewport).toHaveAttribute('aria-multiselectable', 'true');
  await expect(cell).toHaveCount(0);
  await viewport.press('ArrowRight');
  await expect(cell).toHaveText('ID: 0');
  await expect(cell).toHaveAttribute('aria-readonly', 'true');
  await expect(viewport).toHaveAttribute('aria-activedescendant', await cell.getAttribute('id'));
  await expect(viewport).toBeFocused();
  await viewport.press('ArrowRight');
  await expect(cell).toHaveText('Name: Record 0');
  await expect(cell).toHaveAttribute('aria-colindex', '2');
  await expect(cell).toHaveAttribute('aria-readonly', 'false');
  await viewport.press('F2');
  const editor = page.getByRole('textbox');
  await expect(editor).toBeFocused();
  await editor.fill('Accessible'); await editor.press('Enter');
  await expect(cell).toHaveText('Name: Accessible');
  await expect(viewport).toBeFocused();
  await viewport.press('Control+z'); await expect(cell).toHaveText('Name: Record 0');
  await viewport.press('Control+y'); await expect(cell).toHaveText('Name: Accessible');
  await page.evaluate(() => window.grid.setLocked({ scope: 'cell', rowIndex: 0, columnIndex: 1 }, true));
  await expect(cell).toHaveAttribute('aria-readonly', 'true');
  await page.evaluate(() => window.grid.setLocked({ scope: 'cell', rowIndex: 0, columnIndex: 1 }, false));
  await viewport.press('Shift+ArrowDown');
  await expect(viewport.getByRole('row')).toHaveAttribute('aria-rowindex', '2');
  await expect(cell).toHaveAttribute('aria-selected', 'true');
  await viewport.press('Control+End');
  await expect(viewport.getByRole('row')).toHaveAttribute('aria-rowindex', '1000000');
  await expect(cell).toHaveText('Name: Record 999999');
  await expect(page.locator('[role="gridcell"]')).toHaveCount(2); // one owned cell per mount, including the empty hidden mirror
  expect(await page.locator('[role="gridcell"]').evaluateAll(cells => new Set(cells.map(cell => cell.id)).size)).toBe(2);
  await viewport.press('Escape');
  await expect(viewport).not.toHaveAttribute('aria-activedescendant');
  await expect(cell).toHaveCount(0);
  await page.evaluate(() => { window.grid.destroy(); window.otherGrid.destroy(); });
  await expect(page.locator('[role="grid"]')).toHaveCount(0);
});


test('state icons and hover distinguish scoped locks, permissions and frozen boundaries', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.grid = createGrid({ container: document.querySelector('#grid'), frozenColumns: 1,
      columns: [{ key: 'id', title: 'ID' }, { key: 'name', title: 'Name', editable: true }],
      dataSource: new LocalDataSource([{ id: 0, name: 'Ada' }, { id: 1, name: 'Lin' }], row => row.id),
      resolveCellPermission: cell => cell.rowIndex === 1 ? { writable: false } : undefined });
  });
  const viewport = page.getByRole('grid'); const root = page.locator('#grid > div'); const bounds = await viewport.boundingBox();
  await page.mouse.move(bounds.x + 240, bounds.y + 48);
  await expect(root).toHaveAttribute('title', 'Cell disabled by permissions');
  await viewport.click({ position: { x: 240, y: 48 } });
  await expect(viewport.getByRole('gridcell')).toHaveAttribute('aria-description', 'Cell disabled by permissions');
  await page.evaluate(() => {
    window.grid.setLocked({ scope: 'row', rowIndex: 0 }, true);
    window.grid.setLocked({ scope: 'column', columnIndex: 1 }, true);
    window.grid.setFrozen(1, 2);
  });
  await page.mouse.move(bounds.x + 240, bounds.y - 18);
  await expect(root).toHaveAttribute('title', 'Column locked; Column frozen');
  const rowIndex = page.getByRole('button', { name: 'Select row 1', exact: true });
  await expect(rowIndex).toHaveAttribute('aria-description', 'Row locked; Row frozen');
  await expect(rowIndex.locator('svg')).toHaveCount(1);
  await rowIndex.click();
  expect(await page.evaluate(() => window.grid.copySelection())).toBe('0\tAda');
  await viewport.press('F2'); await expect(page.getByRole('textbox')).toHaveCount(0);

  await page.mouse.move(bounds.x + 80, bounds.y + 16);
  await expect(root).toHaveAttribute('title', 'Column frozen; Row locked; Row frozen');
  await viewport.click({ position: { x: 80, y: 16 } });
  await expect(viewport.getByRole('gridcell')).toHaveAttribute('aria-description', 'Column frozen; Row locked; Row frozen');
  expect(await page.evaluate(async () => {
    const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await frame(); const canvas = document.querySelector('canvas'); const ctx = canvas.getContext('2d');
    const snapshot = () => JSON.stringify([...ctx.getImageData(0, 0, canvas.width, canvas.height).data]);
    const before = snapshot();
    window.grid.setLocked({ scope: 'row', rowIndex: 0 }, false); window.grid.setLocked({ scope: 'column', columnIndex: 1 }, false); window.grid.setFrozen(0, 0);
    await frame(); return before !== snapshot();
  })).toBe(true);
  await expect(rowIndex.locator('svg')).toHaveCount(0);
  await page.mouse.move(bounds.x + 240, bounds.y - 18); await expect(root).toHaveAttribute('title', '');
  await page.mouse.move(bounds.x + 240, bounds.y + 48); await expect(root).toHaveAttribute('title', 'Cell disabled by permissions');
  await page.mouse.move(bounds.x + 160, bounds.y - 18); await expect(root).toHaveAttribute('title', 'Drag the column boundary to resize width');
});


test('whole axes select through headers, row edge and keyboard with continuous freeze overlays', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); const { LocalDataSource } = await import('/core/index.js');
    window.grid = createGrid({ container: document.querySelector('#grid'), frozenRows: 1, frozenColumns: 1,
      columns: [{ key: 'id', title: 'ID' }, { key: 'name', title: 'Name', editable: true }],
      dataSource: new LocalDataSource(Array.from({ length: 100 }, (_, id) => ({ id, name: 'Ada' })), row => row.id) });
    window.prevented = false;
    document.querySelector('#grid canvas').parentElement.addEventListener('contextmenu', event => { window.prevented = event.defaultPrevented; });
  });
  const viewport = page.getByRole('grid'); const bounds = await viewport.boundingBox();
  await page.mouse.click(bounds.x + 240, bounds.y - 18);
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toEqual({ startRow: 0, endRow: 99, startColumn: 1, endColumn: 1 });
  await viewport.press('Shift+Space');
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toEqual({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 });
  await viewport.press('Control+Space');
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toEqual({ startRow: 0, endRow: 99, startColumn: 0, endColumn: 0 });
  await viewport.click({ position: { x: 5, y: 80 } });
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toEqual({ startRow: 2, endRow: 2, startColumn: 0, endColumn: 1 });
  await page.mouse.click(bounds.x + 240, bounds.y - 18, { button: 'right' });
  await expect(page.getByRole('menu', { name: 'Column actions' })).toBeVisible();
  expect(await page.evaluate(() => window.prevented)).toBe(true);
  await page.getByRole('menu').press('Escape');
  const vertical = page.locator('[data-grid-freeze-line="column"]'); const horizontal = page.locator('[data-grid-freeze-line="row"]');
  await expect(vertical).toBeVisible(); await expect(horizontal).toBeVisible();
  expect(await vertical.evaluate(el => [el.style.top, el.style.height])).toEqual(['0px', `${await viewport.evaluate(el => el.clientHeight) + 36}px`]);
  expect(await horizontal.evaluate(el => el.style.width)).toBe(`${await viewport.evaluate(el => el.clientWidth) + await page.locator("[data-grid-index]").evaluate(el => el.offsetWidth)}px`);
  await page.evaluate(() => window.grid.setFrozen(0, 0)); await expect(vertical).toBeHidden(); await expect(horizontal).toBeHidden();
});


test('default row index stays fixed, selects and resizes rows without changing data coordinates', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); const { LocalDataSource } = await import('/core/index.js');
    window.indexOptions = { container: document.querySelector('#grid'), frozenRows: 1,
      columns: [{ key: 'id', title: 'ID' }, { key: 'name', title: 'Name', editable: true }],
      dataSource: new LocalDataSource(Array.from({ length: 1000 }, (_, id) => ({ id, name: `Item ${id}` })), row => row.id) };
    window.grid = createGrid(window.indexOptions);
  });
  const gutter = page.locator('[data-grid-index]'); const viewport = page.getByRole('grid');
  await expect(gutter).toBeVisible(); await expect(viewport).toHaveAttribute('aria-colcount', '2');
  await page.getByRole('button', { name: 'Select row 3', exact: true }).click();
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toEqual({ startRow: 2, endRow: 2, startColumn: 0, endColumn: 1 });
  await expect(page.getByRole('button', { name: 'Select row 3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.grid.copySelection())).toBe('2\tItem 2');
  const bounds = await viewport.boundingBox(); const gutterBounds = await gutter.boundingBox();
  await page.mouse.move(gutterBounds.x + 20, bounds.y + 96); await page.mouse.down();
  await page.mouse.move(gutterBounds.x + 20, bounds.y + 116);
  await expect(page.locator('[data-grid-resize-guide]')).toBeVisible();
  expect(await page.getByRole('button', { name: 'Select row 3', exact: true }).evaluate(el => el.offsetHeight)).toBe(32);
  await page.mouse.up();
  await expect.poll(() => page.getByRole('button', { name: 'Select row 3', exact: true }).evaluate(el => el.offsetHeight)).toBe(52);
  await page.evaluate(() => { const el = document.querySelector('[role="grid"]'); el.scrollTop = 320; el.scrollLeft = 100; });
  await expect(page.getByRole('button', { name: 'Select row 1', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select row 3', exact: true })).toHaveCount(0);
  expect(await gutter.evaluate(el => el.getBoundingClientRect().x)).toBe(gutterBounds.x);
  expect(await gutter.getByRole('button').count()).toBeLessThan(30);
  const firstMoving = gutter.getByRole('button', { name: /^Select row / }).nth(1); const row = Number(await firstMoving.textContent()) - 1;
  await firstMoving.click({ button: 'right' }); await expect(page.getByRole('menu')).toBeVisible();
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toMatchObject({ startRow: row, endRow: row, startColumn: 0, endColumn: 1 });
  await page.getByRole('menu').press('Escape');
  await page.evaluate(() => { window.grid.destroy(); window.grid = null; });
  await expect(gutter).toHaveCount(0);
  await page.evaluate(async () => { const { createGrid } = await import('/canvas/index.js'); window.grid = createGrid({ ...window.indexOptions, indexColumn: false }); });
  await expect(gutter).toBeHidden();
});


test('axis Shift-click and drag select inclusive ranges, corner and Ctrl+A select all with permission veto', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); const { LocalDataSource } = await import('/core/index.js');
    window.grid = createGrid({ container: document.querySelector('#grid'), frozenRows: 1, frozenColumns: 1,
      columns: Array.from({ length: 4 }, (_, col) => ({ key: `c${col}`, title: `Column ${col}` })),
      dataSource: new LocalDataSource(Array.from({ length: 100 }, (_, id) => ({ id, c0: id, c1: 'a', c2: 'b', c3: 'c' })), row => row.id),
      resolveCellPermission: cell => cell.rowIndex === 7 && cell.columnIndex === 3 ? { selectable: false } : undefined });
  });
  const viewport = page.getByRole('grid'); const bounds = await viewport.boundingBox();
  const range = () => page.evaluate(() => window.grid.getSelectionRange());
  await page.mouse.click(bounds.x + 240, bounds.y - 18); await page.keyboard.down('Shift');
  await page.mouse.click(bounds.x + 400, bounds.y - 18); await page.keyboard.up('Shift');
  expect(await range()).toEqual({ startRow: 0, endRow: 99, startColumn: 1, endColumn: 2 });
  await page.keyboard.down('Shift'); await page.mouse.click(bounds.x + 80, bounds.y - 18); await page.keyboard.up('Shift');
  expect(await range()).toMatchObject({ startColumn: 0, endColumn: 1 });
  await page.mouse.move(bounds.x + 80, bounds.y - 18); await page.mouse.down(); await page.mouse.move(bounds.x + 400, bounds.y - 18); await page.mouse.up();
  expect(await range()).toMatchObject({ startColumn: 0, endColumn: 2 });
  await page.getByRole('button', { name: 'Select row 3', exact: true }).click();
  await page.getByRole('button', { name: 'Select row 5', exact: true }).click({ modifiers: ['Shift'] });
  expect(await range()).toEqual({ startRow: 2, endRow: 4, startColumn: 0, endColumn: 3 });
  const before = await range(); await page.getByRole('button', { name: 'Select row 8', exact: true }).click({ modifiers: ['Shift'] }); expect(await range()).toEqual(before);
  const start = await page.getByRole('button', { name: 'Select row 2', exact: true }).boundingBox();
  const end = await page.getByRole('button', { name: 'Select row 6', exact: true }).boundingBox();
  await page.mouse.move(start.x + 20, start.y + start.height / 2); await page.mouse.down(); await page.mouse.move(end.x + 20, end.y + end.height / 2); await page.mouse.up();
  expect(await range()).toEqual({ startRow: 1, endRow: 5, startColumn: 0, endColumn: 3 });
  await page.getByRole('button', { name: 'Select all cells', exact: true }).click();
  expect(await range()).toEqual({ startRow: 0, endRow: 99, startColumn: 0, endColumn: 3 });
  await expect(page.getByRole('button', { name: 'Select all cells', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await viewport.press('Escape'); await viewport.press('Control+a'); expect(await range()).toMatchObject({ endRow: 99, endColumn: 3 });
});

test('stationary edge dragging scrolls both axes and stops on Escape, pointer release and destroy', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    window.grid = createGrid({ container: document.querySelector('#grid'), frozenRows: 1, frozenColumns: 1,
      columns: Array.from({ length: 20 }, (_, col) => ({ key: `c${col}`, title: `Column ${col}` })),
      dataSource: { getRowCount: () => 1000, getRowId: row => row, getValue: (row, key) => `${row}:${key}` } });
  });
  const viewport = page.getByRole('grid'); const b = await viewport.boundingBox();
  const offsets = () => viewport.evaluate(el => [el.scrollLeft, el.scrollTop]);
  await page.mouse.move(b.x + 240, b.y + 80); await page.mouse.down(); await page.mouse.move(b.x + b.width + 20, b.y + b.height + 20);
  await expect.poll(async () => (await offsets()).every(value => value > 64)).toBe(true);
  expect(await page.evaluate(() => window.grid.getSelectionRange().endRow)).toBeGreaterThan(9);
  await viewport.press('Escape'); const stopped = await offsets(); await page.waitForTimeout(120); expect(await offsets()).toEqual(stopped); await page.mouse.up();
  await page.mouse.move(b.x + 240, b.y + 80); await page.mouse.down(); await page.mouse.move(b.x + b.width + 20, b.y + b.height + 20);
  await expect.poll(async () => (await offsets())[1]).toBeGreaterThan(stopped[1]);
  await page.mouse.up(); const released = await offsets(); await page.waitForTimeout(120); expect(await offsets()).toEqual(released);
  const rowStart = await page.getByRole('button', { name: 'Select row 1', exact: true }).boundingBox();
  await page.mouse.move(rowStart.x + 20, rowStart.y + rowStart.height / 2); await page.mouse.down(); await page.mouse.move(rowStart.x + 20, b.y + b.height + 20);
  await expect.poll(async () => (await offsets())[1]).toBeGreaterThan(released[1]);
  expect((await offsets())[0]).toBe(released[0]); await page.mouse.up();
  const columnStart = await offsets();
  await page.mouse.move(b.x + 80, b.y - 18); await page.mouse.down(); await page.mouse.move(b.x + b.width + 20, b.y - 18);
  await expect.poll(async () => (await offsets())[0]).toBeGreaterThan(columnStart[0]);
  expect((await offsets())[1]).toBe(columnStart[1]); await page.mouse.up();

  await page.mouse.move(b.x + 240, b.y + 80); await page.mouse.down(); await page.mouse.move(b.x + b.width + 20, b.y + b.height + 20);
  await page.evaluate(() => window.grid.destroy()); await page.mouse.up(); await page.waitForTimeout(120);
  expect(errors).toEqual([]); await expect(page.locator('#grid canvas')).toHaveCount(0);
});

test('auto-fit measures visible content, handles multiline rows and shares resize menu and double-click paths', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); const { LocalDataSource } = await import('/core/index.js');
    window.readRows = []; window.sizes = [];
    const source = new LocalDataSource(Array.from({ length: 100 }, (_, id) => ({ id, name: id === 0 ? 'First line\nSecond line\nThird line' : id === 99 ? 'x'.repeat(800) : 'Short' })), row => row.id);
    const read = source.getValue.bind(source); source.getValue = (row, key) => { window.readRows.push(row); return read(row, key); };
    window.grid = createGrid({ container: document.querySelector('#grid'), wrapText: true,
      columns: [{ key: 'id', title: 'ID' }, { key: 'name', title: 'Name', editable: true }], dataSource: source,
      onEvent: event => { if (event.type.endsWith(':resize')) window.sizes.push(event); } });
    window.grid.setColumnWidth(1, 40);
  });
  await page.evaluate(() => { window.readRows = []; window.grid.autoFitColumn(1); window.grid.autoFitRow(0); });
  const result = await page.evaluate(() => ({ sizes: window.sizes, reads: window.readRows }));
  const column = result.sizes.filter(event => event.type === 'column:resize').at(-1);
  const row = result.sizes.filter(event => event.type === 'row:resize').at(-1);
  expect(column.size).toBeGreaterThan(40); expect(column.size).toBeLessThan(300); expect(row.size).toBeGreaterThan(32); expect(result.reads).not.toContain(99);
  const viewport = page.getByRole('grid'); const b = await viewport.boundingBox();
  await page.evaluate(() => window.grid.setColumnWidth(1, 40));
  await page.mouse.dblclick(b.x + 200, b.y - 18);
  expect(await page.evaluate(() => window.sizes.filter(event => event.type === 'column:resize').at(-1).size)).toBe(column.size);
  await viewport.click({ position: { x: 240, y: 16 }, button: 'right' });
  await page.getByRole('menuitem', { name: 'Auto-fit row', exact: true }).click();
  await viewport.press('F2'); await expect(page.getByRole('textbox')).toBeVisible(); await page.getByRole('textbox').press('Escape');
});

test('axis additive ranges preserve existing ranges and touch header drag keeps native body scrolling', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, baseURL: 'http://127.0.0.1:4179' }); const page = await context.newPage();
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    window.grid = createGrid({ container: document.querySelector('#grid'), columns: Array.from({ length: 4 }, (_, i) => ({ key: `c${i}`, title: `C${i}` })),
      dataSource: { getRowCount: () => 100, getRowId: row => row, getValue: (row, key) => `${row}:${key}` } });
  });
  const viewport = page.getByRole('grid'); const bounds = await viewport.boundingBox();
  await page.getByRole('button', { name: 'Select row 2', exact: true }).click();
  await page.getByRole('button', { name: 'Select row 4', exact: true }).click({ modifiers: ['Control'] });
  expect(await page.evaluate(() => window.grid.getSelectionRanges())).toEqual([
    { startRow: 1, endRow: 1, startColumn: 0, endColumn: 3 }, { startRow: 3, endRow: 3, startColumn: 0, endColumn: 3 }]);
  await page.getByRole('button', { name: 'Select row 6', exact: true }).click({ modifiers: ['Shift'] });
  expect(await page.evaluate(() => window.grid.getSelectionRanges())).toHaveLength(2);
  await expect(page.getByRole('button', { name: 'Select row 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await viewport.press('Shift+F8');
  await page.mouse.click(bounds.x + 180, bounds.y - 18);
  expect(await page.evaluate(() => window.grid.getSelectionRanges())).toHaveLength(3);
  const session = await context.newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: bounds.x + 40, y: bounds.y - 18 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bounds.x + 340, y: bounds.y - 18 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toEqual({ startRow: 0, endRow: 99, startColumn: 0, endColumn: 2 });
  expect(await viewport.evaluate(el => getComputedStyle(el).touchAction)).toBe('auto');
  await page.touchscreen.tap(bounds.x + 180, bounds.y + 16);
  const handle = page.getByRole('button', { name: 'Adjust selection end' }); await expect(handle).toBeVisible(); const hb = await handle.boundingBox();
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: bounds.x + 340, y: bounds.y + 80 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toEqual({ startRow: 0, endRow: 2, startColumn: 1, endColumn: 2 });
  await viewport.press('Escape'); await expect(handle).toBeHidden();
  await context.close();
});

test('link popover shares menu, Alt click and keyboard, keeps editing and respects admin options', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); const { LocalDataSource } = await import('/core/index.js');
    window.source = new LocalDataSource([{ id: 1, text: 'Visit https://example.com/a and www.example.org.' }], row => row.id);
    window.mountLinks = options => { window.grid?.destroy?.(); window.grid = createGrid({ container: document.querySelector('#grid'), columns: [{ key: 'text', title: 'Website', editable: true }], dataSource: window.source, columnWidth: 440, ...options }); };
    window.mountLinks({});
  });
  const viewport = page.getByRole('grid');
  await viewport.click({ position: { x: 60, y: 16 } });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await viewport.press('Alt+Enter');
  const links = page.getByRole('dialog', { name: 'Cell links' });
  await expect(links.getByRole('link')).toHaveCount(2);
  await expect(links.getByRole('link').first()).toHaveAttribute('href', 'https://example.com/a');
  await expect(links.getByRole('link').first()).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(links.getByRole('link').first()).toBeFocused();
  await page.context().route('https://example.com/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Link target</title>' }));
  const opened = page.waitForEvent('popup'); await links.getByRole('link').first().click(); const target = await opened; await target.waitForLoadState(); expect(await target.evaluate(() => window.opener)).toBeNull(); await target.close();
  await links.getByRole('link').first().press('Escape'); await expect(links).toHaveCount(0); await expect(viewport).toBeFocused();
  await viewport.click({ position: { x: 60, y: 16 }, modifiers: ['Alt'] }); await expect(links).toBeVisible();
  await links.getByRole('button', { name: 'Close' }).click();
  await viewport.click({ position: { x: 60, y: 16 }, button: 'right' }); await page.getByRole('menuitem', { name: 'Open links…' }).click(); await expect(links).toBeVisible();
  await links.getByRole('button', { name: 'Close' }).click(); await viewport.press('F2');
  await expect(page.getByRole('textbox')).toHaveValue('Visit https://example.com/a and www.example.org.'); await page.getByRole('textbox').press('Escape');
  await page.evaluate(() => window.mountLinks({ allowOpenLinks: false }));
  await viewport.click({ position: { x: 60, y: 16 }, button: 'right' }); await expect(page.getByRole('menuitem', { name: 'Open links…' })).toBeDisabled();
  await viewport.press('Escape'); await viewport.press('Alt+Enter'); await expect(links).toHaveCount(0);
  await page.evaluate(() => window.mountLinks({ detectLinks: false }));
  await viewport.click({ position: { x: 60, y: 16 }, button: 'right' }); await expect(page.getByRole('menuitem', { name: 'Open links…' })).toHaveCount(0);
});

test('viewport accessibility exposes bounded visible rows and headers without extra source reads', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); window.reads = 0;
    window.grid = createGrid({ accessibility: 'viewport', getCellLabel: (row, key) => row === 0 && key === 'c0' ? 'Homepage' : undefined, frozenRows: 1, frozenColumns: 1, container: document.querySelector('#grid'),
      columns: Array.from({ length: 1000 }, (_, i) => ({ key: `c${i}`, title: `C${i}`, editable: true })),
      dataSource: { getRowCount: () => 1000000, getRowId: row => row, getValue: (row, key) => { window.reads++; return row === 0 && key === 'c0' ? 'https://example.com' : `${row}:${key}`; }, setValue() {} } });
  });
  const viewport = page.getByRole('grid');
  await expect(page.getByRole('columnheader').first()).toHaveAttribute('aria-colindex', '1');
  await expect(viewport).toHaveAttribute('aria-rowcount', '1000001');
  await expect.poll(() => viewport.getByRole('gridcell').count()).toBeGreaterThan(0);
  expect(await viewport.getByRole('gridcell').count()).toBeLessThan(100);
  await page.evaluate(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); window.reads = 0; window.grid.render(); await new Promise(resolve => requestAnimationFrame(resolve)); });
  expect(await page.evaluate(() => window.reads)).toBeLessThan(100);
  await viewport.click({ position: { x: 40, y: 16 } });
  await expect.poll(() => viewport.getAttribute('aria-activedescendant')).toMatch(/^acheron-visible-/);
  const first = viewport.getByRole('gridcell').first(); await expect(first).toHaveText('Homepage'); await expect(first).toHaveAttribute('aria-description', /Contains links/);
  await page.evaluate(() => window.grid.setLocked({ scope: 'cell', rowIndex: 0, columnIndex: 0 }, true)); await expect(first).toHaveAttribute('aria-readonly', 'true');
  await viewport.evaluate(el => { window.reads = 0; el.scrollTop = 1600000; el.scrollLeft = 8000; });
  await expect.poll(() => viewport.getByRole('gridcell').allTextContents()).toContain('C51: 50001:c51');
  expect(await page.evaluate(() => window.reads)).toBeLessThan(120);
  await viewport.press('Control+End'); await expect.poll(() => viewport.getAttribute('aria-activedescendant')).toMatch(/^acheron-visible-/);
  expect(await viewport.getByRole('gridcell').count()).toBeLessThan(100);
  await viewport.press('Escape'); await expect(viewport).not.toHaveAttribute('aria-activedescendant');
  await page.evaluate(() => window.grid.destroy()); await expect(page.getByRole('columnheader')).toHaveCount(0);
});

test('runtime themes repaint Canvas and controls without resetting sizes, locks, selection or history', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); const { LocalDataSource } = await import('/core/index.js');
    window.source = new LocalDataSource([{ id: 1, name: 'Ada' }], row => row.id);
    window.grid = createGrid({ container: document.querySelector('#grid'), columns: [{ key: 'name', title: 'Name', editable: true }], dataSource: window.source });
    window.grid.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Grace' }]); window.grid.setColumnWidth(0, 240); window.grid.selectRow(0); window.grid.setLocked({ scope: 'row', rowIndex: 0 }, true);
    window.grid.setTheme({ background: '#111827', textColor: '#e5e7eb', headerBackground: '#1f2937', headerTextColor: '#d1d5db', gridLineColor: '#374151', selectionColor: '#22d3ee', linkColor: '#67e8f9' });
  });
  await expect(page.getByRole('button', { name: 'Select row 1', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const result = await page.evaluate(() => {
    let rejected = false; try { window.grid.setTheme({ background: 'var(--host-color)' }); } catch { rejected = true; }
    const locked = window.grid.isLocked({ scope: 'row', rowIndex: 0 }); window.grid.setLocked({ scope: 'row', rowIndex: 0 }, false); window.grid.undo(); window.grid.undo(); window.grid.redo(); window.grid.redo();
    return { rejected, locked, value: window.source.getValue(0, 'name'), theme: document.querySelector('[role=grid]').parentElement.style.getPropertyValue('--acheron-background') };
  });
  expect(result).toEqual({ rejected: true, locked: true, value: 'Grace', theme: '#111827' });
  await page.getByRole('grid').press('F2'); await expect(page.getByRole('textbox')).toHaveCSS('width', '240px'); await expect(page.getByRole('textbox')).toHaveCSS('color', 'rgb(229, 231, 235)');
});


test('narrow grids keep search, link popovers and dialogs inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 }); await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); document.querySelector('#grid').style.width = '100%';
    window.grid = createGrid({ container: document.querySelector('#grid'), columns: [{ key: 'url', title: 'Website' }],
      dataSource: { getRowCount: () => 1, getRowId: () => 1, getValue: () => 'https://example.com/' + 'long'.repeat(40) } }); window.grid.openSearch();
  });
  const search = page.getByRole('search'); const sb = await search.boundingBox(); expect(sb.x).toBeGreaterThanOrEqual(0); expect(sb.x + sb.width).toBeLessThanOrEqual(360);
  await page.getByRole('button', { name: 'Close search' }).click(); const viewport = page.getByRole('grid');
  await viewport.click({ position: { x: 40, y: 16 } }); await viewport.press('Alt+Enter'); const popup = page.getByRole('dialog', { name: 'Cell links' });
  await expect(popup).toBeVisible(); const pb = await popup.boundingBox(); expect(pb.x).toBeGreaterThanOrEqual(0); expect(pb.x + pb.width).toBeLessThanOrEqual(360);
  await popup.getByRole('button', { name: 'Close' }).click(); await viewport.press('Shift+F10'); await page.getByRole('menuitem', { name: 'Resize column…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Column width' }); await expect(dialog).toBeVisible(); const db = await dialog.boundingBox(); expect(db.x).toBeGreaterThanOrEqual(0); expect(db.x + db.width).toBeLessThanOrEqual(360);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await expect(viewport).toBeFocused();
});


test('grouped headers share frozen geometry, leaf actions and accessible row spans; automatic heights retain manual resize', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message)); await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); const { LocalDataSource } = await import('/core/index.js');
    window.events = []; window.source = new LocalDataSource(Array.from({ length: 1000 }, (_, id) => ({ id, steps: 'First line\nSecond line\nThird line', ios: 'OK', android: '', chrome: 'OK' })), row => row.id);
    window.grid = createGrid({ container: document.querySelector('#grid'), dataSource: window.source, accessibility: 'viewport', frozenColumns: 2, frozenRows: 1,
      columns: [{ key: 'steps', title: 'Steps', editable: true }, ...['ios', 'android', 'chrome'].map(key => ({ key, title: key, editable: true }))],
      headerHeight: 24, headerGroups: [{ title: 'Result', children: [{ title: 'Mobile', children: ['ios', 'android'] }, { title: 'Desktop', children: ['chrome'] }] }],
      wrapText: true, autoRowHeight: true, rowHeight: 28, columnWidth: 100,
      columnEditors: { android: { type: 'select', values: ['', 'OK'] } }, onEvent: event => window.events.push(event),
    });
  });
  const grid = page.getByRole('grid'); await expect(grid).toHaveAttribute('aria-rowcount', '1003');
  await expect(page.getByRole('columnheader', { name: 'Steps', exact: true })).toHaveAttribute('aria-rowspan', '3');
  await expect(page.getByRole('columnheader', { name: 'ios', exact: true })).toHaveAttribute('aria-colindex', '2');
  const row = page.getByRole('button', { name: 'Select row 1', exact: true });
  await expect.poll(() => row.evaluate(el => el.offsetHeight)).toBeGreaterThan(50);
  await page.getByRole('columnheader', { name: 'Mobile', exact: true }).first().click(); expect(await page.evaluate(() => window.grid.getSelectionRange())).toMatchObject({ startRow: 0, endRow: 999, startColumn: 1, endColumn: 2 });
  await page.evaluate(() => window.grid.selectRow(900));
  await page.getByRole('columnheader', { name: 'Mobile', exact: true }).first().press('Shift+Enter');
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toMatchObject({startRow:0,endRow:999,endColumn:2});
  const leaf = page.getByRole('columnheader', { name: 'ios', exact: true }); await leaf.press('Enter');
  expect(await page.evaluate(() => window.grid.getSelection().columnIndex)).toBe(1);
  await leaf.press('Shift+F10'); await expect(page.getByRole('menuitem', { name: 'Sort ascending' })).toBeVisible(); await page.keyboard.press('Escape');
  await page.evaluate(() => window.grid.setRowHeight(0, 120));
  await page.evaluate(() => window.grid.updateCells([{ rowIndex: 0, columnKey: 'steps', value: 'Short' }]));
  await expect(row).toHaveCSS('height', '120px');
  await page.evaluate(() => window.grid.updateCells([{ rowIndex: 1, columnKey: 'steps', value: 'A\nB\nC\nD\nE' }]));
  await expect.poll(() => page.getByRole('button', { name: 'Select row 2', exact: true }).evaluate(el => el.offsetHeight)).toBeGreaterThan(80);
  await page.getByRole('columnheader', { name: 'android', exact: true }).press('Enter'); await grid.press('F2');
  const select = page.getByRole('combobox', { name: 'Edit row 1, android' }); await expect(select).toHaveValue(''); await select.selectOption('OK'); await select.press('Enter');
  expect(await page.evaluate(() => window.source.getValue(0, 'android'))).toBe('OK');
  const b = await leaf.evaluate(el => { const { x, y, width, height } = el.getBoundingClientRect(); return { x, y, width, height }; }); await page.mouse.move(b.x + b.width - 1, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width + 39, b.y + b.height / 2); await page.mouse.up();
  expect(await page.evaluate(() => window.events.some(event => event.type === 'column:resize'))).toBe(true);
  await grid.press('Control+Home'); await grid.press('ArrowRight');
  const handle = page.getByRole('button', { name: 'Adjust selection end', exact: true }); await expect(handle).toBeVisible(); const h = await handle.boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down(); await page.mouse.move(h.x + 65, h.y - 10); await page.mouse.up();
  expect(await page.evaluate(() => window.grid.getSelectionRange().endColumn)).toBeGreaterThanOrEqual(2);
  await page.evaluate(() => window.grid.setFrozen(0, 1)); await grid.evaluate(el => { el.scrollLeft = 150; });
  await expect(page.getByRole('columnheader', { name: 'Steps', exact: true })).toBeVisible(); expect(errors).toEqual([]);
});


test('automatic wrapped frozen code retains its pixels after horizontal scrolling through groups', async ({ page }) => {
  await page.goto('/'); await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); const { LocalDataSource } = await import('/core/index.js');
    window.grid = createGrid({ container: document.querySelector('#grid'), dataSource: new LocalDataSource([{ id: 'DEMO-00001', notes: 'Lorem ipsum\nDolor sit amet\nConsectetur', online: 'Available', onsite: 'Pending', shipping: 'Available' }], row => row.id),
      columns: ['id','notes','online','onsite','shipping'].map(key => ({ key, title: key })), autoRowHeight: true, wrapText: true, frozenColumns: 1, columnWidth: 120, headerHeight: 28,
      headerGroups: [{ title: 'Availability', children: [{ title: 'Channels', children: ['online','onsite'] }, { title: 'Delivery', children: ['shipping'] }] }],
    }); window.grid.setColumnWidth(1, 300);
  });
  const read = () => page.evaluate(async () => { await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); const canvas = document.querySelector('canvas'); return [...canvas.getContext('2d').getImageData(2, 86, 116, 20).data]; });
  const before = await read(); await page.getByRole('grid').press('Control+Home'); await page.getByRole('grid').press('End'); const after = await read(); expect(after).toEqual(before);
});


test('choice panel searches, applies multiple values and cancels without mutation', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); const { LocalDataSource } = await import('/core/index.js');
    window.source = new LocalDataSource([{ id: 1, tags: 'Idea' }], row => row.id);
    window.grid = createGrid({ container: document.querySelector('#grid'), dataSource: window.source, columns: [{key:'tags', title:'Tags', editable:true}], columnEditors: {tags: {type:'multiselect', values:['Idea','Design','Public']}}, choiceEditor: {} });
  });
  const grid = page.getByRole('grid'); await grid.press('Control+Home'); await grid.press('F2');
  const panel = page.locator('[data-grid-choices]'); await expect(panel).toBeVisible();
  await panel.getByRole('searchbox').fill('Des'); await expect(panel.getByRole('checkbox')).toHaveCount(1);
  await panel.getByRole('checkbox', { name:'Design', exact:true }).check(); await panel.getByRole('button',{name:'Apply',exact:true}).click();
  expect(await page.evaluate(() => window.source.getValue(0,'tags'))).toBe('Idea, Design');
  await grid.press('F2'); await panel.getByRole('checkbox',{name:'Public',exact:true}).check(); await panel.getByRole('button',{name:'Cancel',exact:true}).click();
  expect(await page.evaluate(() => window.source.getValue(0,'tags'))).toBe('Idea, Design');
});

test('dragging selected rows/columns emits host requests and admin veto works', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); const { LocalDataSource } = await import('/core/index.js');
    window.requests=[]; window.allowed=true;
    window.grid=createGrid({container:document.querySelector('#grid'), accessibility:'viewport', dataSource:new LocalDataSource(Array.from({length:5},(_,id)=>({id,a:'A',b:'B',c:'C'})),row=>row.id),columns:['a','b','c'].map(key=>({key,title:key})), onReorder: request=>window.requests.push(request), canReorder:()=>window.allowed });
    window.grid.selectRow(0);
  });
  await page.getByRole('button',{name:'Select row 2',exact:true}).click({modifiers:['Shift']});
  await page.getByRole('button',{name:'Select row 1',exact:true}).dragTo(page.getByRole('button',{name:'Select row 4',exact:true}));
  expect(await page.evaluate(()=>window.requests[0])).toMatchObject({axis:'row',indices:[0,1]});
  await page.evaluate(()=>window.grid.selectColumn(0));
  await page.getByRole('columnheader',{name:'b',exact:true}).click({modifiers:['Shift']});
  await page.getByRole('columnheader',{name:'a',exact:true}).dragTo(page.getByRole('columnheader',{name:'c',exact:true}));
  expect(await page.evaluate(()=>window.requests[1])).toMatchObject({axis:'column',indices:[0,1]});
  await page.evaluate(()=>window.allowed=false);
  await page.getByRole('columnheader',{name:'a',exact:true}).press('Alt+ArrowRight');
  expect(await page.evaluate(()=>window.requests.length)).toBe(2);
});


test('active cell tints all ancestor headers and leaves unrelated headers unchanged', async ({ page }) => {
  await page.goto('/'); await page.evaluate(async () => {
    const {createGrid}=await import('/canvas/index.js'); const {LocalDataSource}=await import('/core/index.js');
    window.grid=createGrid({container:document.querySelector('#grid'),dataSource:new LocalDataSource([{id:1,a:'A',b:'B',c:'C'}],row=>row.id),columns:['a','b','c'].map(key=>({key,title:key})),headerHeight:24,columnWidth:100,headerGroups:[{title:'Parent',children:[{title:'Child',children:['a','b']}]}]});
  });
  const pixels=async()=>page.evaluate(()=>{const canvas=document.querySelector('canvas'), ctx=canvas.getContext('2d'), scale=canvas.width/parseFloat(canvas.style.width); return [[10,5],[10,29],[10,53],[210,5]].map(([x,y])=>[...ctx.getImageData(x*scale,y*scale,1,1).data]);});
  const before=await pixels(); await page.getByRole('grid').press('Control+Home'); await expect.poll(pixels).not.toEqual(before);
  const after=await pixels(); for(let i=0;i<3;i++) expect(after[i]).not.toEqual(before[i]); expect(after[3]).toEqual(before[3]);
});


test('pinned editor keeps screen position, labels identity and guards navigation only while editing', async ({ page }) => {
  await page.goto('/'); await page.evaluate(async () => {
    const {createGrid}=await import('/canvas/index.js'); const {LocalDataSource}=await import('/core/index.js');
    document.body.style.minHeight='2000px';
    window.grid=createGrid({container:document.querySelector('#grid'),dataSource:new LocalDataSource(Array.from({length:100},(_,id)=>({id,name:'Draft'})),row=>row.id),columns:[{key:'name',title:'Name',editable:true}],editorOptions:{pinned:true},multilineEditor:true});
  });
  const grid=page.getByRole('grid'); await grid.press('Control+Home'); await grid.press('F2');
  const editor=page.getByRole('textbox',{name:'Edit row 1, Name',exact:true}); await editor.fill('Unsaved');
  await expect(page.locator('[data-grid-editor-label]')).toHaveText('Name · Row 1 · 0');
  const before=await editor.boundingBox();
  await grid.evaluate(el=>{el.scrollTop=800;}); await page.evaluate(()=>window.scrollTo(0,100));
  await expect.poll(async()=>{const b=await editor.boundingBox();return {x:b.x,y:b.y};}).toEqual({x:before.x,y:before.y});
  expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})).toBe(true);
  await editor.press('Escape');
  expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})).toBe(false);
  expect(await page.evaluate(()=>window.grid.getSelection() && document.querySelector('[data-grid-editor-label]').hidden)).toBe(true);
});

test('custom backgrounds reach cell edges with only one grid boundary pixel', async ({page})=>{
  await page.goto('/'); await page.evaluate(async()=>{
    const {createGrid}=await import('/canvas/index.js'); const {LocalDataSource}=await import('/core/index.js');
    window.grid=createGrid({container:document.querySelector('#grid'),indexColumn:false,rowHeight:40,headerHeight:24,columnWidth:100,dataSource:new LocalDataSource([{id:1,a:'A',b:'B'}],row=>row.id),columns:[{key:'a',title:'A'},{key:'b',title:'B'}],theme:{gridLineColor:'#888888'},renderCell:(ctx,cell)=>{ctx.fillStyle='#ff0000';ctx.fillRect(cell.x,cell.y,cell.width,cell.height);return true;}});
  });
  await expect.poll(()=>page.evaluate(()=>{const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),scale=canvas.width/parseFloat(canvas.style.width);return [0,1,98,100,101].map(x=>[...ctx.getImageData(x*scale,30*scale,1,1).data].slice(0,3));})).toEqual(Array.from({length:5},()=>[255,0,0]));
});


test('row actions keep additive selection, dispatch immutable requests and move to final position', async ({page})=>{
  await page.goto('/'); await page.evaluate(async()=>{
    const {createGrid}=await import('/canvas/index.js'); const {LocalDataSource}=await import('/core/index.js');
    window.requests=[];window.allowed=true;
    window.grid=createGrid({container:document.querySelector('#grid'),dataSource:new LocalDataSource(Array.from({length:6},(_,id)=>({id,a:'A',b:'B'})),row=>row.id),columns:[{key:'a',title:'A'},{key:'b',title:'B'}],onRowChange:request=>window.requests.push(request),canRowChange:()=>window.allowed,onReorder:request=>window.requests.push(request)});
    window.grid.selectRow(1);
  });
  await page.getByRole('button',{name:'Select row 3',exact:true}).click({modifiers:['Control']});
  await page.getByRole('button',{name:'Select row 2',exact:true}).click({button:'right'});
  await page.getByRole('menuitem',{name:'Delete 2 selected rows',exact:true}).click();
  expect(await page.evaluate(()=>window.requests[0])).toEqual({kind:'delete',indices:[1,2]});
  await page.getByRole('button',{name:'Select row 2',exact:true}).click({button:'right'});
  await page.getByRole('menuitem',{name:'Insert row above',exact:true}).click();
  expect(await page.evaluate(()=>window.requests[1])).toEqual({kind:'insert',beforeIndex:1,count:1});
  await page.getByRole('button',{name:'Select row 2',exact:true}).click({button:'right'});
  await page.getByRole('menuitem',{name:'Move rows to…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Destination row'});await dialog.getByRole('spinbutton').fill('4');await dialog.getByRole('button',{name:'Apply',exact:true}).click();
  expect(await page.evaluate(()=>window.requests[2])).toEqual({axis:'row',indices:[1,2],beforeIndex:5});
  await page.evaluate(()=>window.allowed=false);
  await page.getByRole('button',{name:'Select row 2',exact:true}).click({button:'right'});
  await expect(page.getByRole('menuitem',{name:'Delete 2 selected rows',exact:true})).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.evaluate(async()=>{window.grid.destroy();const {createGrid}=await import('/canvas/index.js');const {LocalDataSource}=await import('/core/index.js');window.grid=createGrid({container:document.querySelector('#grid'),dataSource:new LocalDataSource([],row=>row.id),columns:[{key:'a',title:'A'}],onRowChange:request=>window.requests.push(request)});});
  await page.getByRole('grid').click({button:'right',position:{x:20,y:40}});
  await expect(page.getByRole('menuitem',{name:'Delete row',exact:true})).toBeDisabled();
  await page.getByRole('menuitem',{name:'Insert row below',exact:true}).click();
  expect(await page.evaluate(()=>window.requests[3])).toEqual({kind:'insert',beforeIndex:0,count:1});
});

test('adjacent whole-row ranges have a single outer outline and no green interior seams', async({page})=>{
  await page.goto('/');await page.evaluate(async()=>{
    const {createGrid}=await import('/canvas/index.js');const {LocalDataSource}=await import('/core/index.js');
    window.grid=createGrid({container:document.querySelector('#grid'),columnWidth:100,rowHeight:40,headerHeight:24,dataSource:new LocalDataSource(Array.from({length:5},(_,id)=>({id,a:'',b:''})),row=>row.id),columns:[{key:'a',title:'A'},{key:'b',title:'B'}],theme:{selectionColor:'#00ff00'}});window.grid.selectRow(1);
  });
  await page.getByRole('button',{name:'Select row 3',exact:true}).click({modifiers:['Control']});
  await expect.poll(()=>page.evaluate(()=>{const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d'),scale=canvas.width/parseFloat(canvas.style.width);return [...ctx.getImageData(20*scale,104*scale,1,1).data].slice(0,3);})).not.toEqual([0,255,0]);
  expect(await page.evaluate(()=>window.grid.getSelectionRanges().length)).toBe(2);
});


test('reorder preview shows insertion edge and clears after cancellation or denied drop', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const {createGrid}=await import('/canvas/index.js'); const {LocalDataSource}=await import('/core/index.js');
    window.allowed=true; window.requests=[];
    window.grid=createGrid({container:document.querySelector('#grid'),accessibility:'viewport',dataSource:new LocalDataSource(Array.from({length:5},(_,id)=>({id,a:'A',b:'B'})),row=>row.id),columns:['a','b'].map(key=>({key,title:key})),onReorder:r=>window.requests.push(r),canReorder:()=>window.allowed});
    window.grid.selectRow(0);
  });
  const source=page.getByRole('button',{name:'Select row 1',exact:true}), target=page.getByRole('button',{name:'Select row 4',exact:true});
  const transfer=await page.evaluateHandle(()=>new DataTransfer());
  await source.dispatchEvent('dragstart',{dataTransfer:transfer});
  const bounds=await target.boundingBox();
  await target.dispatchEvent('dragover',{dataTransfer:transfer,clientX:bounds.x+5,clientY:bounds.y+bounds.height-2});
  await expect(page.locator('[data-grid-reorder-guide]')).toBeVisible();
  await expect(page.locator('[data-grid-reorder-badge]')).toHaveText('Move 1 row · after 4');
  expect(await page.locator('[data-grid-reorder-guide]').evaluate(el=>el.offsetWidth)).toBeGreaterThan(100);
  await source.dispatchEvent('dragend');
  await expect(page.locator('[data-grid-reorder-guide]')).toBeHidden();
  await expect(page.locator('[data-grid-reorder-badge]')).toBeHidden();
  await source.dispatchEvent('dragstart',{dataTransfer:transfer});
  await page.evaluate(()=>window.allowed=false);
  await target.dispatchEvent('dragover',{dataTransfer:transfer,clientX:bounds.x+5,clientY:bounds.y+2});
  await expect(page.locator('[data-grid-reorder-guide]')).toBeHidden();
  await expect(page.locator('[data-grid-reorder-badge]')).toHaveText('Moving here is disabled');
  await target.dispatchEvent('drop',{dataTransfer:transfer,clientX:bounds.x+5,clientY:bounds.y+2});
  expect(await page.evaluate(()=>window.requests.length)).toBe(0);
  await expect(page.locator('[data-grid-reorder-badge]')).toBeHidden();
});


test('structural core APIs update one Canvas mount, grouped headers, editor and history',async({page})=>{
  await page.goto('/');
  await page.evaluate(async()=>{
    const {createGrid}=await import('/canvas/index.js'),{LocalDataSource}=await import('/core/index.js');
    window.source=new LocalDataSource([{id:1,a:'One',b:'B',c:'C'},{id:2,a:'Two',b:'B',c:'C'}],r=>r.id);
    window.grid=createGrid({container:document.querySelector('#grid'),dataSource:window.source,columns:['a','b','c'].map(key=>({key,title:key,editable:true})),headerGroups:[{title:'Group',children:['b','c']}],accessibility:'viewport'});
    window.originalCanvas=document.querySelector('canvas');
    window.grid.selectRow(1);window.grid.setRowHeight(1,64);window.grid.format([{scope:'cell',rowIndex:1,columnIndex:0}],{background:'#abc'});
    window.grid.insertRows(0,[{id:3,values:{a:'New',b:'B',c:'C'}}]);
  });
  await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount','5');
  await expect(page.getByRole('gridcell',{name:'a: Two',exact:true}).locator('..')).toHaveAttribute('aria-rowindex','5');
  expect(await page.evaluate(()=>document.querySelector('canvas')===window.originalCanvas)).toBe(true);
  await page.evaluate(()=>{window.grid.moveRows([2],0);window.grid.moveColumns([2],1);});
  await expect(page.getByRole('columnheader',{name:'Group',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.grid.columns.map(c=>c.key))).toEqual(['a','c','b']);
  expect(await page.evaluate(()=>window.grid.getSelection().rowId)).toBe(2);
  await page.evaluate(()=>{window.grid.deleteColumns([1,2]);});
  await expect(page.getByRole('grid')).toHaveAttribute('aria-colcount','1');
  await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount','4');
  await page.evaluate(()=>window.grid.undo());
  await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount','5');
  await page.evaluate(()=>{window.grid.undo();window.grid.undo();window.grid.undo();});
  await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount','4');
  expect(await page.evaluate(()=>window.grid.getFormat(1,0).background)).toBe('#abc');
  await page.evaluate(()=>{window.grid.insertColumns(1,[{key:'new',title:'New',editable:true}]);window.grid.updateCells([{rowIndex:0,columnKey:'new',value:'Added'}]);});
  await expect(page.getByRole('columnheader',{name:'New',exact:true})).toBeVisible();
});


test('column creation dialog, managed row views and structured browser clipboard retain state', async ({page})=>{
  await page.goto('/');
  await page.evaluate(async()=>{
    const {createGrid}=await import('/canvas/index.js'); const {LocalDataSource}=await import('/core/index.js');
    window.source=new LocalDataSource([{id:'a',name:'C',other:'keep'},{id:'b',name:'A',other:'keep'},{id:'c',name:'B',other:'keep'}],row=>row.id);
    window.grid=createGrid({container:document.querySelector('#grid'),dataSource:window.source,allowColumnChanges:true,accessibility:'viewport',columns:[{key:'name',title:'Name',editable:true},{key:'other',title:'Other',editable:true}]});
  });
  const viewport=page.locator('[data-grid-viewport]');
  await viewport.click({position:{x:20,y:16}});
  await page.evaluate(()=>{window.grid.setRowHeight(0,60);window.grid.format([{scope:'row',rowIndex:0}],{background:'#abcdef'});window.grid.setLocked({scope:'cell',rowIndex:0,columnIndex:1},true);window.originalViewport=document.querySelector('[data-grid-viewport]');window.grid.setView({sort:{columnKey:'name',direction:'asc'}});});
  expect(await page.evaluate(()=>({same:window.originalViewport===document.querySelector('[data-grid-viewport]'),selection:window.grid.getSelection(),format:window.grid.getFormat(2,0),locked:window.grid.isLocked({scope:'cell',rowIndex:2,columnIndex:1})}))).toMatchObject({same:true,selection:{rowIndex:2,rowId:'a'},format:{background:'#abcdef'},locked:true});
  await viewport.press('F2');const editor=page.getByRole('textbox');await editor.fill('0');await editor.press('Enter');
  expect(await page.evaluate(()=>window.grid.getSelection())).toMatchObject({rowIndex:0,rowId:'a'});await page.evaluate(()=>window.grid.undo());
  await page.evaluate(()=>window.grid.setView({}));
  await page.getByRole('columnheader',{name:'Name',exact:true}).click({button:'right'});
  await page.getByRole('menuitem',{name:'Insert column right…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Insert column',exact:true});await dialog.getByLabel('Column title').fill('Count');await dialog.getByLabel('Column type').selectOption('number');await dialog.getByLabel('Default value').fill('invalid');await dialog.getByRole('button',{name:'Insert column',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('finite number');
  await dialog.getByLabel('Default value').fill('7');await dialog.getByRole('button',{name:'Insert column',exact:true}).click();await expect(dialog).not.toBeVisible();
  expect(await page.evaluate(()=>window.source.getValue(0,window.grid.columns[1].key))).toBe(7);await page.evaluate(()=>{window.grid.undo();window.grid.redo();});await expect(page.getByRole('columnheader',{name:'Count',exact:true})).toBeVisible();
  await viewport.click({position:{x:20,y:20}});await viewport.click({position:{x:350,y:20},modifiers:['Control']});
  const copied=await viewport.evaluate(el=>{const data=new DataTransfer();el.dispatchEvent(new ClipboardEvent('copy',{clipboardData:data,bubbles:true,cancelable:true}));window.copied=data;return {types:[...data.types],text:data.getData('text/plain')};});
  expect(copied.types).toContain('application/x-acheron-grid+json');expect(copied.text).toBe('C\tkeep');
  await viewport.click({position:{x:20,y:80}});
  await viewport.evaluate(el=>el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:window.copied,bubbles:true,cancelable:true})));
  expect(await page.evaluate(()=>({name:window.source.getValue(1,'name'),number:window.source.getValue(1,window.grid.columns[1].key),other:window.source.getValue(1,'other')}))).toEqual({name:'C',number:7,other:'keep'});
  await page.getByRole('columnheader',{name:'Name',exact:true}).click();
  await page.getByRole('columnheader',{name:'Count',exact:true}).click({modifiers:['Control']});
  await page.getByRole('columnheader',{name:'Name',exact:true}).click({button:'right'});
  await page.getByRole('menuitem',{name:'Delete 2 selected columns',exact:true}).click();
  expect(await page.evaluate(()=>window.grid.columns.map(column=>column.key))).toEqual(['other']);
  await page.evaluate(()=>window.grid.undo());await expect(page.getByRole('columnheader',{name:'Count',exact:true})).toBeVisible();

});


test('menu icons and groups, quiet search focus, match tint and dropdown hover share themed UI',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');
  await page.addStyleTag({content:'input:focus-visible{outline:2px solid green;outline-offset:3px}'});
  await page.evaluate(async()=>{const {createGrid}=await import('/canvas/index.js');const {LocalDataSource}=await import('/core/index.js');window.source=new LocalDataSource([{id:1,name:'Match',status:'Active'},{id:2,name:'Match',status:'Pending'}],row=>row.id);window.grid=createGrid({container:document.querySelector('#grid'),dataSource:window.source,theme:{iconColor:'#172554'},columns:[{key:'name',title:'Name',editable:true},{key:'status',title:'Status',editable:true}],columnEditors:{status:{type:'select',values:['Active','Pending']}}});});
  const viewport=page.locator('[data-grid-viewport]');await viewport.click({position:{x:20,y:16},button:'right'});
  const menu=page.getByRole('menu');await expect(menu.getByRole('separator')).toHaveCount(5);
  expect(await menu.getByRole('menuitem').evaluateAll(items=>items.every(item=>item.querySelector('svg[aria-hidden=true]')))).toBe(true);
  await expect(menu.getByRole('menuitem',{name:'Copy',exact:true}).locator('svg')).toHaveCSS('color','rgb(23, 37, 84)');await menu.press('Escape');
  await viewport.press('Control+f');const search=page.getByRole('searchbox',{name:'Find in grid',exact:true});await expect(search).toHaveCSS('outline-style','none');await expect(search).toHaveCSS('box-shadow','none');await search.fill('Match');await expect(page.getByRole('status').filter({hasText:'1 of 2'})).toBeVisible();
  const pixels=await page.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const ctx=document.querySelector('canvas').getContext('2d');const pixel=(x,y)=>[...ctx.getImageData(x,y,1,1).data];return {current:pixel(120,40),other:pixel(120,72),marker:pixel(1,40)};});
  expect(pixels.current).not.toEqual(pixels.other);expect(pixels.marker[0]).toBeGreaterThan(pixels.marker[2]);await page.getByRole('button',{name:'Close search',exact:true}).click();
  const b=await viewport.boundingBox();await page.mouse.move(b.x+305,b.y+16);expect(await page.evaluate(()=>document.querySelector('[data-grid-root]')?.style.cursor??document.querySelector('[data-grid-viewport]').parentElement.style.cursor)).toBe('pointer');
  await viewport.click({position:{x:305,y:16}});await expect(page.getByRole('combobox',{name:'Edit row 1, Status',exact:true})).toBeVisible();await page.keyboard.press('Escape');
  await page.evaluate(()=>window.grid.setLocked({scope:'cell',rowIndex:0,columnIndex:1},true));await page.mouse.move(b.x+40,b.y+16);await page.mouse.move(b.x+305,b.y+16);expect(await viewport.evaluate(el=>el.parentElement.style.cursor)).not.toBe('pointer');
  expect(errors).toEqual([]);
});


test('dropdown arrows change single-choice drafts, skip disabled options and retain multi-choice toggles',async({page})=>{
  await page.goto('/');await page.evaluate(async()=>{const {createGrid}=await import('/canvas/index.js');const {LocalDataSource}=await import('/core/index.js');window.source=new LocalDataSource([{id:1,status:'Active',tags:'Idea'}],row=>row.id);window.grid=createGrid({container:document.querySelector('#grid'),dataSource:window.source,columns:[{key:'status',title:'Status',editable:true},{key:'tags',title:'Tags',editable:true}],columnEditors:{status:{type:'select',values:['Active','Pending','Done']},tags:{type:'multiselect',values:['Idea','Design','Public']}},choiceEditor:{}});});
  const grid=page.getByRole('grid');await grid.press('Control+Home');await grid.press('F2');const panel=page.locator('[data-grid-choices]');await panel.getByRole('searchbox').press('ArrowDown');await expect(panel.getByRole('radio',{name:'Pending',exact:true})).toBeFocused();await expect(panel.getByRole('radio',{name:'Pending',exact:true})).toBeChecked();expect(await page.evaluate(()=>window.source.getValue(0,'status'))).toBe('Active');
  await page.keyboard.press('ArrowDown');await expect(panel.getByRole('radio',{name:'Done',exact:true})).toBeFocused();await page.keyboard.press('ArrowUp');await page.keyboard.press('Enter');expect(await page.evaluate(()=>window.source.getValue(0,'status'))).toBe('Pending');await page.evaluate(()=>window.grid.undo());
  await grid.press('F2');await page.evaluate(()=>{document.querySelector('select[aria-label="Edit row 1, Status"]').options[1].disabled=true;document.querySelector('[data-grid-choices] input[type=search]').dispatchEvent(new Event('input',{bubbles:true}));});await panel.getByRole('searchbox').press('ArrowDown');await expect(panel.getByRole('radio',{name:'Done',exact:true})).toBeFocused();await page.keyboard.press('Escape');
  await grid.press('F2');await panel.getByRole('searchbox').fill('Done');await panel.getByRole('searchbox').press('ArrowDown');await expect(panel.getByRole('radio',{name:'Done',exact:true})).toBeChecked();await page.keyboard.press('Escape');expect(await page.evaluate(()=>window.source.getValue(0,'status'))).toBe('Active');
  await grid.press('F2');await panel.getByRole('button',{name:'Cancel',exact:true}).focus();await page.keyboard.press('Enter');await expect(panel).not.toBeVisible();
  await grid.press('ArrowRight');await grid.press('F2');await panel.getByRole('searchbox').press('ArrowDown');await expect(panel.getByRole('checkbox',{name:'Design',exact:true})).toBeFocused();await expect(panel.getByRole('checkbox',{name:'Design',exact:true})).not.toBeChecked();await page.keyboard.press('Space');await page.keyboard.press('End');await expect(panel.getByRole('checkbox',{name:'Public',exact:true})).toBeFocused();await page.keyboard.press('Space');await page.keyboard.press('Enter');expect(await page.evaluate(()=>window.source.getValue(0,'tags'))).toBe('Idea, Design, Public');
});


test('touch moves selected rows and columns through shared preview, history and veto',async({page})=>{
  await page.goto('/');await page.evaluate(async()=>{const {createGrid}=await import('/canvas/index.js');const {LocalDataSource}=await import('/core/index.js');window.requests=[];window.allowMove=true;window.source=new LocalDataSource(Array.from({length:100},(_,id)=>({id,a:'A'+id,b:'B'+id,c:'C'+id})),row=>row.id);window.grid=createGrid({container:document.querySelector('#grid'),dataSource:window.source,accessibility:'viewport',columns:['a','b','c'].map(key=>({key,title:key,editable:true})),onReorder:request=>{window.requests.push(request);request.axis==='row'?window.grid.moveRows(request.indices,request.beforeIndex):window.grid.moveColumns(request.indices,request.beforeIndex);},canReorder:()=>window.allowMove});window.grid.selectRow(1);});
  const session=await page.context().newCDPSession(page);
  const point=async locator=>{const box=await locator.boundingBox();return {x:box.x+box.width/2,y:box.y+box.height/2};};
  const send=async(type,p)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:p?[{...p,id:1}]:[]});
  const from=await point(page.getByRole('button',{name:'Select row 2',exact:true})),to=await point(page.getByRole('button',{name:'Select row 5',exact:true}));to.y+=8;
  await send('touchStart',from);await send('touchMove',to);await expect(page.locator('[data-grid-reorder-guide]')).toBeVisible();expect(await page.evaluate(()=>window.requests.length)).toBe(0);await send('touchEnd');
  expect(await page.evaluate(()=>window.requests[0])).toMatchObject({axis:'row',indices:[1],beforeIndex:5});expect(await page.evaluate(()=>window.source.getRowId(4))).toBe(1);await page.evaluate(()=>window.grid.undo());expect(await page.evaluate(()=>window.source.getRowId(1))).toBe(1);
  await page.evaluate(()=>window.grid.selectColumn(0));const left=await point(page.getByRole('columnheader',{name:'a',exact:true})),right=await point(page.getByRole('columnheader',{name:'c',exact:true}));right.x+=20;
  await send('touchStart',left);await send('touchMove',right);await send('touchEnd');expect(await page.evaluate(()=>window.grid.columns.map(column=>column.key))).toEqual(['b','c','a']);await page.evaluate(()=>window.grid.undo());
  await page.evaluate(()=>{window.grid.selectRow(1);window.allowMove=false;});await send('touchStart',from);await send('touchMove',to);await expect(page.locator('[data-grid-reorder-badge]')).toHaveText('Moving here is disabled');await send('touchEnd');expect(await page.evaluate(()=>window.requests.length)).toBe(2);
  await page.evaluate(()=>window.allowMove=true);await send('touchStart',from);await send('touchMove',to);await send('touchCancel');await expect(page.locator('[data-grid-reorder-guide]')).not.toBeVisible();expect(await page.evaluate(()=>window.requests.length)).toBe(2);
  await send('touchStart',from);await send('touchEnd');expect(await page.evaluate(()=>window.requests.length)).toBe(2);
  await page.evaluate(()=>window.grid.selectRow(1));await page.getByRole('button',{name:'Select row 3',exact:true}).click({modifiers:['Shift']});await send('touchStart',from);await send('touchMove',to);await send('touchEnd');expect(await page.evaluate(()=>window.requests.at(-1))).toMatchObject({axis:'row',indices:[1,2],beforeIndex:5});await page.evaluate(()=>window.grid.undo());
  await page.evaluate(()=>window.grid.selectRow(1));const viewport=await page.locator('[data-grid-viewport]').boundingBox();await send('touchStart',from);await send('touchMove',{x:from.x,y:viewport.y+viewport.height-5});await expect.poll(()=>page.locator('[data-grid-viewport]').evaluate(el=>el.scrollTop)).toBeGreaterThan(0);await send('touchCancel');await expect(page.locator('[data-grid-reorder-guide]')).not.toBeVisible();expect(await page.evaluate(()=>window.requests.length)).toBe(3);

});
