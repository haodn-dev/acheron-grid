'use client';

import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { CSSProperties } from 'react';
import { createGrid } from '@acheron-grid/canvas';
import type { Grid, GridOptions, GridTheme } from '@acheron-grid/canvas';

export type AcheronGridOptions = Omit<GridOptions, 'container'>;
export interface AcheronGridHandle { getGrid(): Grid | null; }
export interface AcheronGridProps {
  options: AcheronGridOptions;
  theme?: Partial<GridTheme>;
  view?: GridOptions['view'];
  frozenRows?: number;
  frozenColumns?: number;
  onReady?: (grid: Grid | null) => void;
  onEvent?: GridOptions['onEvent'];
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
}

export const AcheronGrid = forwardRef<AcheronGridHandle, AcheronGridProps>(function AcheronGrid(props, ref) {
  const container = useRef<HTMLDivElement>(null);
  const grid = useRef<Grid | null>(null);
  const callbacks = useRef({ onReady: props.onReady, onEvent: props.onEvent });
  useEffect(() => { callbacks.current = { onReady: props.onReady, onEvent: props.onEvent }; }, [props.onReady, props.onEvent]);
  useImperativeHandle(ref, () => ({ getGrid: () => grid.current }), []);
  useEffect(() => {
    if (!container.current) return;
    const instance = createGrid({ ...props.options, container: container.current });
    instance.subscribe({onEvent:event=>callbacks.current.onEvent?.(event)});
    grid.current = instance;
    try { callbacks.current.onReady?.(instance); }
    catch (error) { grid.current = null; instance.destroy(); throw error; }
    return () => { grid.current = null; instance.destroy(); callbacks.current.onReady?.(null); };
  }, [props.options]);
  useEffect(() => { if (props.theme) grid.current?.setTheme(props.theme); }, [props.options, props.theme]);
  useEffect(() => { if (props.view) grid.current?.setView(props.view); }, [props.options, props.view]);
  useEffect(() => {
    const instance = grid.current;
    if (instance && (props.frozenRows !== undefined || props.frozenColumns !== undefined)) {
      instance.setFrozen(props.frozenRows ?? instance.frozenRows, props.frozenColumns ?? instance.frozenColumns);
    }
  }, [props.options, props.frozenRows, props.frozenColumns]);
  return createElement('div', { ref: container, className: props.className, style: props.style, 'aria-label': props.ariaLabel });
});

export type { Grid, GridOptions, GridTheme } from '@acheron-grid/canvas';
