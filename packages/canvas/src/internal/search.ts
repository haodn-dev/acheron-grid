import type { createRichDisplay } from './display.js';
import type { GridContext } from './grid-context.js';
import type { createOverlay } from './overlay.js';

interface SearchContext
  extends
    Pick<GridContext['env'], 'win' | 't'>,
    Readonly<Pick<GridContext['runtime'], 'destroyed'>>,
    Pick<GridContext, 'engine'>,
    Readonly<Pick<GridContext['layout'], 'rowCount' | 'columns'>>,
    Readonly<Pick<GridContext['appearance'], 'theme'>> {
  readonly overlay: ReturnType<typeof createOverlay>;
  readonly searchBar: HTMLDivElement;
  readonly searchInput: HTMLInputElement;
  readonly searchStatus: HTMLSpanElement;
  readonly searchPrevious: HTMLButtonElement;
  readonly searchNext: HTMLButtonElement;
  readonly searchClose: HTMLButtonElement;
  readonly scroller: HTMLDivElement;
  readonly displayedText: ReturnType<typeof createRichDisplay>['displayedText'];
  readonly select: (row: number, col: number) => void;
  readonly render: () => void;
  readonly finishEdit: (commit: boolean) => boolean;
  readonly closeMenu: () => void;
  readonly endResize: () => void;
  readonly context: CanvasRenderingContext2D | null;
}

export function createSearch(grid: SearchContext) {
  const searchMatches = new Set<number>();
  let searchCurrent = -1;
  let searchTimer: number | undefined;

  function updateSearchStatus(): void {
    let ordinal = 0;
    for (const index of searchMatches) {
      ordinal++;
      if (index === searchCurrent) break;
    }
    grid.searchStatus.textContent = searchMatches.size
      ? grid.t('{0} of {1}', ordinal, searchMatches.size)
      : grid.searchInput.value
        ? grid.t('No matches')
        : grid.t('Find text');
    grid.searchPrevious.disabled = grid.searchNext.disabled = !searchMatches.size;
  }

  function refreshSearch(navigate = false): void {
    if (searchTimer !== undefined) grid.win.clearTimeout(searchTimer);
    searchTimer = undefined;
    if (grid.destroyed || grid.searchBar.hidden) return;
    searchMatches.clear();
    const query = grid.searchInput.value.toLocaleLowerCase();
    try {
      if (query)
        for (let row = 0; row < grid.rowCount; row++)
          for (let col = 0; col < grid.columns.length; col++) {
            const span = grid.engine.getMerge(row, col);
            if (span && (span.startRow !== row || span.startColumn !== col)) continue;
            const value = grid.engine.getValue(row, grid.columns[col]!.key);
            if (
              value != null &&
              !grid.engine.isRowHidden(row) &&
              !grid.engine.isColumnHidden(col) &&
              grid
                .displayedText(
                  value,
                  grid.columns[col]!.key,
                  grid.engine.getFormat(row, col).contentFormat,
                  grid.engine.getFormat(row, col).numberFormat,
                )
                .toLocaleLowerCase()
                .includes(query) &&
              grid.engine.getCellPermission(row, col).selectable
            )
              searchMatches.add(row * grid.columns.length + col);
          }
      if (!searchMatches.has(searchCurrent)) searchCurrent = searchMatches.values().next().value ?? -1;
      updateSearchStatus();
      if (navigate && searchCurrent >= 0)
        grid.select(Math.floor(searchCurrent / grid.columns.length), searchCurrent % grid.columns.length);
    } catch (error) {
      searchMatches.clear();
      searchCurrent = -1;
      grid.searchPrevious.disabled = grid.searchNext.disabled = true;
      grid.searchStatus.textContent = error instanceof Error ? grid.t(error.message) : grid.t('Search failed.');
    }
    grid.render();
  }

  function moveSearch(backward = false): void {
    if (!grid.finishEdit(true)) return;
    const pending = searchTimer !== undefined;
    refreshSearch(pending);
    if (!searchMatches.size || (pending && !backward)) return;
    let next = backward ? [...searchMatches].at(-1)! : searchMatches.values().next().value!;
    for (const index of searchMatches) {
      if (backward && index < searchCurrent) next = index;
      if (!backward && index > searchCurrent) {
        next = index;
        break;
      }
    }
    searchCurrent = next;
    grid.select(Math.floor(next / grid.columns.length), next % grid.columns.length);
    updateSearchStatus();
    grid.render();
  }

  function openSearch(): void {
    if (grid.destroyed || grid.overlay.activeDialog?.open || !grid.finishEdit(true)) return;
    grid.closeMenu();
    grid.endResize();
    grid.searchBar.hidden = false;
    refreshSearch();
    grid.searchInput.focus({ preventScroll: true });
    grid.searchInput.select();
  }

  function closeSearch(): void {
    if (searchTimer !== undefined) grid.win.clearTimeout(searchTimer);
    searchTimer = undefined;
    grid.searchBar.hidden = true;
    searchMatches.clear();
    searchCurrent = -1;
    grid.render();
    grid.scroller.focus({ preventScroll: true });
  }

  function searchShortcut(event: KeyboardEvent): void {
    if (!event.isComposing && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      event.stopPropagation();
      openSearch();
    }
  }
  grid.searchInput.addEventListener('input', () => {
    if (searchTimer !== undefined) grid.win.clearTimeout(searchTimer);
    searchCurrent = -1;
    searchTimer = grid.win.setTimeout(() => refreshSearch(true), 150);
  });
  grid.searchBar.addEventListener('keydown', (event) => {
    if (event.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      moveSearch(event.shiftKey);
    }
    event.stopPropagation();
  });
  grid.searchPrevious.addEventListener('click', () => moveSearch(true));
  grid.searchNext.addEventListener('click', () => moveSearch());
  grid.searchClose.addEventListener('click', closeSearch);

  function highlightSearch(x: number, y: number, width: number, height: number, row: number, col: number): void {
    if (!searchMatches.has(row * grid.columns.length + col)) return;
    const current = row * grid.columns.length + col === searchCurrent;
    grid.context!.save();
    grid.context!.fillStyle = grid.theme.searchHighlightColor;
    grid.context!.globalAlpha = current ? 0.22 : 0.09;
    grid.context!.fillRect(x, y, Math.max(0, width - 1), Math.max(0, height - 1));
    grid.context!.globalAlpha = 1;
    if (current) grid.context!.fillRect(x, y, 3, Math.max(0, height - 1));
    grid.context!.restore();
  }
  return {
    refreshSearch,
    openSearch,
    searchShortcut,
    highlightSearch,
    disposeSearch() {
      if (searchTimer !== undefined) grid.win.clearTimeout(searchTimer);
      searchMatches.clear();
    },
  };
}
