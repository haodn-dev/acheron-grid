import type { Column, GridEngine, LocalViewOptions } from '@acheron-grid/core';
import type { GridOptions, GridTheme } from '../grid.js';
import type { HeaderCell, headerLayout } from '../headers.js';
import type { CanvasTranslator } from '../locale.js';

export interface GridContext {
  readonly options: GridOptions;
  readonly engine: GridEngine;
  readonly env: {
    readonly doc: Document;
    readonly win: Window & typeof globalThis;
    readonly t: CanvasTranslator;
  };
  readonly layout: {
    columns: readonly Column[];
    rowCount: number;
    headers: ReturnType<typeof headerLayout>;
    leafHeaders: HeaderCell[];
    currentView: LocalViewOptions | undefined;
    headerHeight: number;
    indexWidth: number;
  };
  readonly appearance: {
    theme: GridTheme;
  };
  readonly runtime: {
    destroyed: boolean;
    frame: number | undefined;
  };
}
