import { test, expect } from './browser-fixtures.mjs';

test('image paste rejects oversized batches before allocating URLs and owns accepted URLs through history', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    window.alerts = [];
    window.created = [];
    window.revoked = [];
    window.alert = (message) => window.alerts.push(message);
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (file) => {
      const url = create(file);
      window.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.revoked.push(url);
      revoke(url);
    };
    window.pasteImages = (count, size = 0) => {
      const data = new DataTransfer();
      for (let index = 0; index < count; index++)
        data.items.add(
          new File(
            [
              size
                ? new Uint8Array(size)
                : '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>',
            ],
            `image-${index}.svg`,
            { type: 'image/svg+xml' },
          ),
        );
      document.querySelector('[role=grid]').dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
  });
  const grid = page.getByRole('grid');
  await grid.press('Control+Home');
  for (const [count, size] of [
    [101, 0],
    [1, 20 * 1024 * 1024 + 1],
  ]) {
    await page.evaluate(([count, size]) => window.pasteImages(count, size), [count, size]);
    expect(await page.evaluate(() => window.source.getValue(0, 'photos'))).toEqual(
      await page.evaluate(() => window.photos),
    );
    expect(await page.evaluate(() => window.created.length)).toBe(0);
    expect(await page.evaluate(() => window.grid.undo())).toBe(false);
  }
  expect(await page.evaluate(() => window.alerts)).toEqual([
    'Paste at most 100 images, each no larger than 20 MiB.',
    'Paste at most 100 images, each no larger than 20 MiB.',
  ]);
  await page.evaluate(() => window.pasteImages(1, 20 * 1024 * 1024));
  await expect.poll(() => page.evaluate(() => window.source.getValue(0, 'photos').length)).toBe(1);
  expect(await page.evaluate(() => window.created.length)).toBe(1);
  await page.evaluate(() => window.grid.undo());
  await page.evaluate(() => window.pasteImages(100));
  await expect.poll(() => page.evaluate(() => window.source.getValue(0, 'photos').length)).toBe(100);
  expect(await page.evaluate(() => window.created.length)).toBe(101);
  await page.evaluate(() => window.grid.undo());
  expect(await page.evaluate(() => window.source.getValue(0, 'photos'))).toEqual(
    await page.evaluate(() => window.photos),
  );
  expect(await page.evaluate(() => window.revoked.length)).toBe(0);
  await page.evaluate(() => window.grid.redo());
  expect(await page.evaluate(() => window.source.getValue(0, 'photos').length)).toBe(100);
  await page.evaluate(() => window.grid.destroy());
  expect(await page.evaluate(() => window.created.every((url) => window.revoked.includes(url)))).toBe(true);
  expect(await page.evaluate(() => window.revoked.length)).toBe(101);
});

test('image paste rejects invalid concurrency and oversized selection without upload or allocation', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    window.alerts = [];
    window.uploadCalls = 0;
    window.allocations = 0;
    window.alert = (message) => window.alerts.push(message);
    URL.createObjectURL = () => {
      window.allocations++;
      throw new Error('Unexpected allocation');
    };
    window.pasteOne = () => {
      const data = new DataTransfer();
      data.items.add(new File(['image'], 'sample.png', { type: 'image/png' }));
      document
        .querySelector('[role=grid]')
        .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    };
  });
  for (let index = 0; index < 7; index++) {
    await page.evaluate(async (index) => {
      const { createGrid } = await import('/canvas/index.js');
      window.grid.destroy();
      window.grid = createGrid({
        ...window.options,
        mediaOptions: {
          maxConcurrentUploads: [0, -1, 1.5, 101, NaN, Infinity, '2'][index],
          upload: async () => {
            window.uploadCalls++;
            return { src: 'https://example.com/image.png' };
          },
        },
      });
    }, index);
    await page.getByRole('grid').press('Control+Home');
    await page.evaluate(() => window.pasteOne());
    expect(await page.evaluate(() => window.alerts.at(-1))).toBe('Invalid upload concurrency.');
    expect(await page.evaluate(() => window.grid.undo())).toBe(false);
    expect(await page.evaluate(() => window.source.getValue(0, 'photos'))).toEqual(
      await page.evaluate(() => window.photos),
    );
    await expect(page.getByRole('status', { name: 'Image upload' })).toHaveCount(0);
  }
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    window.grid.destroy();
    window.grid = createGrid({
      ...window.options,
      dataSource: {
        getRowCount: () => 50001,
        getRowId: (row) => row,
        getValue: () => [],
        setValue: () => {
          throw new Error('Unexpected write');
        },
      },
    });
  });
  await page.getByRole('grid').press('Control+Home');
  await page.getByRole('grid').press('Control+a');
  await page.evaluate(() => window.pasteOne());
  expect(await page.evaluate(() => window.alerts.at(-1))).toBe('Image paste selection is too large.');
  expect(await page.evaluate(() => [window.uploadCalls, window.allocations])).toEqual([0, 0]);
  expect(await page.evaluate(() => window.grid.undo())).toBe(false);
});

test('one failed concurrent image upload aborts the batch without writing any broadcast destination', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    window.grid.destroy();
    window.uploads = [];
    window.alerts = [];
    window.alert = (message) => window.alerts.push(message);
    window.grid = createGrid({
      ...window.options,
      mediaOptions: {
        maxConcurrentUploads: 2,
        upload: (_file, context) => new Promise((resolve, reject) => window.uploads.push({ context, resolve, reject })),
      },
    });
  });
  const grid = page.getByRole('grid');
  await grid.press('Control+Home');
  await grid.press('Shift+ArrowDown');
  await page.evaluate(() => {
    const data = new DataTransfer();
    for (let index = 0; index < 2; index++) data.items.add(new File(['image'], `${index}.png`, { type: 'image/png' }));
    document
      .querySelector('[role=grid]')
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => page.evaluate(() => window.uploads.length)).toBe(2);
  await page.evaluate(() => {
    window.uploads[0].resolve(window.photos[0]);
    window.uploads[1].reject(new Error('Host upload failed'));
  });
  await expect.poll(() => page.evaluate(() => window.alerts)).toEqual(['Host upload failed']);
  expect(await page.evaluate(() => window.uploads.every((upload) => upload.context.signal.aborted))).toBe(true);
  expect(await page.evaluate(() => window.source.getValue(0, 'photos'))).toEqual(
    await page.evaluate(() => window.photos),
  );
  expect(await page.evaluate(() => window.source.getValue(1, 'photos'))).toEqual([]);
  expect(await page.evaluate(() => window.grid.undo())).toBe(false);
  await expect(page.getByRole('status', { name: 'Image upload' })).toHaveCount(0);
});

test('unchanged media Apply creates no history and an empty people draft can cancel or commit', async ({ page }) => {
  await setup(page);
  const grid = page.getByRole('grid');
  await grid.press('Control+Home');
  await grid.press('F2');
  await page.getByRole('dialog', { name: 'Edit images' }).getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await page.evaluate(() => window.grid.undo())).toBe(false);
  await grid.press('Control+Home');
  await grid.press('ArrowDown');
  await grid.press('ArrowRight');
  await grid.press('F2');
  const dialog = page.getByRole('dialog', { name: 'Edit people' });
  await expect(dialog.getByText('No people yet. Add the first person.', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Add person', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Name 1', exact: true }).fill('Cancelled person');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => window.source.getValue(1, 'people'))).toEqual([]);
  expect(await page.evaluate(() => window.grid.undo())).toBe(false);
  await grid.press('F2');
  await dialog.getByRole('button', { name: 'Add person', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Name 1', exact: true }).fill('Ada');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await page.evaluate(() => window.source.getValue(1, 'people')[0].name)).toBe('Ada');
  await page.evaluate(() => window.grid.undo());
  expect(await page.evaluate(() => window.source.getValue(1, 'people'))).toEqual([]);
});

test('media editor enforces 100 items and boundary reorder actions preserve undo', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.grid.destroy();
    window.originalPeople = Array.from({ length: 100 }, (_, index) => ({
      id: `person-${index}`,
      name: `Person ${index}`,
    }));
    window.source = new LocalDataSource([{ id: 1, photos: [], people: window.originalPeople }], (row) => row.id);
    window.grid = createGrid({ ...window.options, dataSource: window.source });
  });
  const grid = page.getByRole('grid');
  await grid.press('Control+Home');
  await grid.press('ArrowRight');
  await grid.press('F2');
  const dialog = page.getByRole('dialog', { name: 'Edit people' });
  await expect(dialog.getByRole('button', { name: 'Move item 1 up', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Move item 100 down', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Add person', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Use at most 100 items.');
  await expect(dialog.getByRole('textbox', { name: /^Name / })).toHaveCount(100);
  await dialog.getByRole('button', { name: 'Remove item 100', exact: true }).click();
  await dialog.getByRole('button', { name: 'Add person', exact: true }).click();
  await dialog.getByRole('button', { name: 'Move item 100 up', exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await page.evaluate(() => window.source.getValue(0, 'people').length)).toBe(100);
  expect(await page.evaluate(() => window.source.getValue(0, 'people')[98].name)).toBe('New person');
  await page.evaluate(() => window.grid.undo());
  expect(await page.evaluate(() => window.source.getValue(0, 'people'))).toEqual(
    await page.evaluate(() => window.originalPeople),
  );
  await page.evaluate(() => window.grid.redo());
  expect(await page.evaluate(() => window.source.getValue(0, 'people')[98].name)).toBe('New person');
});
test('upload progress is bounded and any broadcast destination change cancels atomic paste', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    window.grid.destroy();
    const { createGrid } = await import('/canvas/index.js');
    window.uploads = [];
    window.alerts = [];
    window.alert = (text) => window.alerts.push(text);
    window.grid = createGrid({
      ...window.options,
      mediaOptions: {
        maxConcurrentUploads: 1,
        upload: (file, context) => new Promise((resolve) => window.uploads.push({ file, context, resolve })),
      },
    });
    window.selectCell(0, 0);
    window.pasteFiles = (count) => {
      const data = new DataTransfer();
      for (let i = 0; i < count; i++) data.items.add(new File(['image'], `image${i}.png`, { type: 'image/png' }));
      document
        .querySelector('[role=grid]')
        .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    };
  });
  await page.getByRole('grid').press('Shift+ArrowDown');
  await page.evaluate(() => window.pasteFiles(2));
  await expect.poll(() => page.evaluate(() => window.uploads.length)).toBe(1);
  await page.evaluate(() => {
    window.uploads[0].context.onProgress(2, 5);
    window.uploads[0].resolve(window.photos[0]);
  });
  await expect.poll(() => page.evaluate(() => window.uploads.length)).toBe(2);
  await expect(page.getByRole('status', { name: 'Image upload' })).toContainText('1/2 completed');
  await page.evaluate(() => {
    window.source.setValue(0, 'photos', [window.photos[1]]);
    window.uploads[1].resolve(window.photos[0]);
  });
  await expect.poll(() => page.evaluate(() => window.alerts.length)).toBe(1);
  expect(await page.evaluate(() => window.source.getValue(0, 'photos'))).toEqual(
    await page.evaluate(() => [window.photos[1]]),
  );
  expect(await page.evaluate(() => window.source.getValue(1, 'photos'))).toEqual([]);
  await page.evaluate(() => {
    window.uploads = [];
    window.pasteFiles(2);
  });
  await page.getByRole('button', { name: 'Cancel upload', exact: true }).click();
  expect(await page.evaluate(() => window.uploads[0].context.signal.aborted)).toBe(true);
  await page.evaluate(() => window.uploads[0].resolve(window.photos[0]));
  await expect(page.getByRole('status', { name: 'Image upload' })).toHaveCount(0);
  expect(await page.evaluate(() => window.uploads.length)).toBe(1);
  expect(await page.evaluate(() => window.source.getValue(1, 'photos'))).toEqual([]);
});
async function setup(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'),
      { LocalDataSource } = await import('/core/index.js');
    const image = (color) =>
      'data:image/svg+xml,' +
      encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="${color}"/></svg>`,
      );
    window.photos = [
      { src: image('#ff0000'), alt: 'Front' },
      { src: image('#0000ff'), alt: 'Back' },
      { src: image('#00aa00'), alt: 'Detail' },
      { src: image('#ffaa00'), alt: 'Extra' },
      { src: image('#9933aa'), alt: 'Last' },
    ];
    window.people = [
      { id: 'ada', name: 'Ada Lovelace', src: image('#ff0000') },
      { id: 'lin', name: 'Lin Chen' },
      { id: 'grace', name: 'Grace Hopper', src: image('#0000ff') },
    ];
    window.source = new LocalDataSource(
      [
        { id: 1, photos: window.photos, people: window.people },
        { id: 2, photos: [], people: [] },
      ],
      (row) => row.id,
    );
    window.options = {
      container: document.querySelector('#grid'),
      dataSource: window.source,
      columns: [
        { key: 'photos', title: 'Photos', editable: true },
        { key: 'people', title: 'People', editable: true },
      ],
      imageColumns: ['photos'],
      avatarColumns: ['people'],
      accessibility: 'viewport',
      rowHeight: 52,
      columnWidth: 180,
    };
    window.grid = createGrid(window.options);
    window.selectCell = (row, col) => {
      const viewport = document.querySelector('[role=grid]');
      for (const key of ['Home', ...Array(row).fill('ArrowDown'), ...Array(col).fill('ArrowRight')])
        viewport.dispatchEvent(
          new KeyboardEvent('keydown', { key, ctrlKey: key === 'Home', bubbles: true, cancelable: true }),
        );
    };
  });
}
test('gallery thumbnails and avatar stacks describe values, open details and preserve structured clipboard/history', async ({
  page,
}) => {
  await setup(page);
  const viewport = page.getByRole('grid');
  await viewport.press('Control+Home');
  await expect(page.getByRole('gridcell', { name: /Photos: 5 images/ })).toBeAttached();
  await viewport.press('Alt+Enter');
  const gallery = page.getByRole('dialog', { name: 'Cell images' });
  await expect(gallery.getByRole('img')).toHaveCount(5);
  expect(
    await gallery
      .getByRole('img')
      .evaluateAll((images) =>
        images.every((image) => image.crossOrigin === 'anonymous' && image.referrerPolicy === 'no-referrer'),
      ),
  ).toBe(true);
  await expect(gallery.getByRole('img', { name: 'Front' })).toBeVisible();
  await gallery.getByRole('button', { name: 'Close', exact: true }).click();
  const result = await page.evaluate(() => {
    window.copy = window.grid.copySelectionBlocks();
    window.selectCell(1, 0);
    window.grid.pasteSelectionBlocks(window.copy);
    return window.source.getValue(1, 'photos');
  });
  expect(result).toEqual(await page.evaluate(() => window.photos));
  await page.evaluate(() => window.grid.undo());
  expect(await page.evaluate(() => window.source.getValue(1, 'photos'))).toEqual([]);
  await page.evaluate(() => window.grid.redo());
  await viewport.press('Control+Home');
  await viewport.press('ArrowRight');
  await viewport.press('Alt+Enter');
  const people = page.getByRole('dialog', { name: 'Cell people' });
  await expect(people.getByText('Lin Chen', { exact: true })).toBeVisible();
  await expect(people.getByRole('img')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    window.peopleCopy = window.grid.copySelectionBlocks();
    window.selectCell(1, 1);
    window.grid.pasteSelectionBlocks(window.peopleCopy);
  });
  expect(await page.evaluate(() => window.source.getValue(1, 'people'))).toEqual(
    await page.evaluate(() => window.people),
  );
  await page.evaluate(() =>
    window.grid.setTheme({
      background: '#171915',
      textColor: '#eeefe5',
      headerBackground: '#292d25',
      headerTextColor: '#aaaea1',
    }),
  );
  await page.screenshot({ path: test.info().outputPath('media-dark.png') });
});
test('pasted image files create owned temporary URLs and upload callbacks cancel when destination changes', async ({
  page,
}) => {
  await setup(page);
  await page.getByRole('grid').press('Control+Home');
  await page.evaluate(() => {
    window.revoked = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (url) => {
      window.revoked.push(url);
      revoke(url);
    };
    const data = new DataTransfer();
    data.items.add(new File([new Uint8Array([1, 2, 3])], 'capture.png', { type: 'image/png' }));
    document
      .querySelector('[role=grid]')
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => page.evaluate(() => window.source.getValue(0, 'photos')[0]?.src)).toMatch(/^blob:/);
  const blob = await page.evaluate(() => window.source.getValue(0, 'photos')[0].src);
  await page.evaluate(() => window.grid.undo());
  expect(await page.evaluate(() => window.source.getValue(0, 'photos'))).toEqual(
    await page.evaluate(() => window.photos),
  );
  await page.evaluate(() => window.grid.redo());
  expect(await page.evaluate(() => window.source.getValue(0, 'photos')[0].src)).toBe(blob);
  await page.evaluate(async () => {
    window.grid.destroy();
    const { createGrid } = await import('/canvas/index.js');
    window.alerts = [];
    window.alert = (text) => window.alerts.push(text);
    window.grid = createGrid({
      ...window.options,
      mediaOptions: {
        upload: (file, { signal }) =>
          new Promise((resolve) => {
            window.resolveUpload = resolve;
            window.uploadSignal = signal;
          }),
      },
    });
    window.selectCell(0, 0);
    const data = new DataTransfer();
    data.items.add(new File(['image'], 'avatar.png', { type: 'image/png' }));
    document
      .querySelector('[role=grid]')
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  expect(await page.evaluate(() => window.revoked)).toContain(blob);
  await page.evaluate(() => {
    window.selectCell(1, 0);
    window.resolveUpload({ src: 'https://example.com/avatar.png', alt: 'Avatar' });
  });
  await expect.poll(() => page.evaluate(() => window.alerts.length)).toBe(1);
  expect(await page.evaluate(() => window.source.getValue(1, 'photos'))).toEqual([]);
});

test('native clipboard cut moves structured media and a locked destination never clears the source', async ({
  page,
}) => {
  await setup(page);
  const viewport = page.getByRole('grid');
  await viewport.press('Control+Home');
  await viewport.evaluate((el) => {
    window.clipboard = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent('cut', { clipboardData: window.clipboard, bubbles: true, cancelable: true }));
  });
  await viewport.press('ArrowDown');
  await page.evaluate(() => {
    window.alerts = [];
    window.alert = (text) => window.alerts.push(text);
    window.grid.setLocked({ scope: 'row', rowIndex: 1 }, true);
    document
      .querySelector('[role=grid]')
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: window.clipboard, bubbles: true, cancelable: true }));
  });
  expect(await page.evaluate(() => window.alerts.length)).toBe(1);
  expect(await page.evaluate(() => window.source.getValue(0, 'photos'))).toEqual(
    await page.evaluate(() => window.photos),
  );
  await page.evaluate(() => {
    window.grid.setLocked({ scope: 'row', rowIndex: 1 }, false);
    document
      .querySelector('[role=grid]')
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: window.clipboard, bubbles: true, cancelable: true }));
  });
  expect(await page.evaluate(() => window.source.getValue(1, 'photos'))).toEqual(
    await page.evaluate(() => window.photos),
  );
  expect(await page.evaluate(() => window.source.getValue(0, 'photos'))).toBeNull();
  await page.evaluate(() => window.grid.undo());
  expect(await page.evaluate(() => window.source.getValue(0, 'photos'))).toEqual(
    await page.evaluate(() => window.photos),
  );
  expect(await page.evaluate(() => window.source.getValue(1, 'photos'))).toEqual([]);
});

test('media edit uses a visual draft, preserves cancel and commits through history and permissions', async ({
  page,
}) => {
  await setup(page);
  const grid = page.getByRole('grid');
  await grid.press('Control+Home');
  await grid.press('Shift+F10');
  await page.getByRole('menuitem', { name: 'Edit cell', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'Edit images' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('textarea')).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: 'Image URL 1', exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: 'Remove item 1', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(() => window.source.getValue(0, 'photos').length)).toBe(5);
  await grid.press('F2');
  dialog = page.getByRole('dialog', { name: 'Edit images' });
  await dialog.getByRole('textbox', { name: 'Description 1', exact: true }).fill('Updated front');
  await dialog.getByRole('button', { name: 'Move item 1 down', exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await page.evaluate(() => window.source.getValue(0, 'photos')[1].alt)).toBe('Updated front');
  await page.evaluate(() => window.grid.undo());
  expect(await page.evaluate(() => window.source.getValue(0, 'photos')[0].alt)).toBe('Front');
  await grid.press('F2');
  dialog = page.getByRole('dialog', { name: 'Edit images' });
  await dialog.getByRole('button', { name: 'Add image', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Image URL 6', exact: true }).fill('https://example.com/new.png');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await page.evaluate(() => window.source.getValue(0, 'photos').length)).toBe(6);
  await page.evaluate(() => window.grid.undo());
  await grid.press('F2');
  dialog = page.getByRole('dialog', { name: 'Edit images' });
  await dialog.getByRole('textbox', { name: 'Image URL 1', exact: true }).fill('javascript:alert(1)');
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('HTTP');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await grid.press('F2');
  dialog = page.getByRole('dialog', { name: 'Edit images' });
  await dialog.getByRole('button', { name: 'Remove item 1', exact: true }).click();
  await page.evaluate(() => window.grid.setLocked({ scope: 'cell', rowIndex: 0, columnIndex: 0 }, true));
  await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => window.source.getValue(0, 'photos').length)).toBe(5);
});
