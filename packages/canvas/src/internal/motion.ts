import type { DataSource, GridEngine } from '@acheron-grid/core';
import type { GridOptions } from '../grid.js';
import type { GridContext } from './grid-context.js';

interface MotionContext
  extends
    Pick<GridContext['env'], 'win' | 'doc'>,
    Pick<GridContext, 'engine'>,
    Readonly<Pick<GridContext['layout'], 'columns' | 'headerHeight' | 'indexWidth'>>,
    Readonly<Pick<GridContext['runtime'], 'destroyed'>>,
    Pick<GridContext['runtime'], 'frame'> {
  readonly options: Pick<GridOptions, 'motion'>;
  readonly motionDuration: number;
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly dataSource: DataSource;
  readonly draw: () => void;
  readonly viewport: () => ReturnType<GridEngine['getViewport']>;
}

export function createMotion(context: MotionContext) {
  const layoutMotion = new Set<HTMLElement>();
  const motionPreference = context.win.matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = () => context.win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionEnabled = () => context.options.motion !== false && context.motionDuration > 0 && !reducedMotion();
  const cancelMotion = () => {
    if (reducedMotion()) {
      clearLayoutMotion();
      context.root.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    }
  };
  motionPreference.addEventListener('change', cancelMotion);

  function enterSurface(node: HTMLElement): void {
    if (!motionEnabled()) return;
    node.style.transformOrigin = 'top left';
    node.animate(
      [
        { opacity: 0, transform: 'translateY(-2px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: Math.min(160, context.motionDuration), easing: 'cubic-bezier(.22,1,.36,1)' },
    );
  }

  function exitSurface(node: HTMLElement): void {
    node.style.pointerEvents = 'none';
    node.inert = true;
    node.setAttribute('aria-hidden', 'true');
    node.removeAttribute('data-grid-choices');
    if (!motionEnabled() || context.destroyed) {
      node.remove();
      return;
    }
    const opacity = context.win.getComputedStyle(node).opacity;
    const transform = context.win.getComputedStyle(node).transform;
    node.getAnimations().forEach((animation) => animation.cancel());
    node
      .animate(
        [
          { opacity, transform },
          { opacity: 0, transform: 'translateY(-1px)' },
        ],
        { duration: Math.min(100, context.motionDuration), easing: 'ease-out' },
      )
      .finished.then(
        () => node.remove(),
        () => node.remove(),
      );
  }

  function clearLayoutMotion(): void {
    for (const node of layoutMotion) {
      node.getAnimations().forEach((animation) => animation.cancel());
      node.remove();
    }
    layoutMotion.clear();
  }

  function animateLayout<T>(run: () => T, axis: 'row' | 'column'): T {
    clearLayoutMotion();
    if (!motionEnabled() || !context.canvas.clientWidth || !context.canvas.clientHeight) return run();
    if (context.frame !== undefined) {
      context.win.cancelAnimationFrame(context.frame);
      context.frame = undefined;
      context.draw();
    }
    const oldView = context.viewport();
    const indices = [
      ...new Set(
        oldView.regions.flatMap((region) => {
          const range = axis === 'row' ? region.rows : region.columns;
          return Array.from({ length: range.end - range.start }, (_, i) => range.start + i);
        }),
      ),
    ].slice(0, 64);
    const old = indices.map((index) => {
      const rect = oldView.cellRect(axis === 'row' ? index : 0, axis === 'column' ? index : 0);
      return {
        key:
          axis === 'row'
            ? context.dataSource.getRowId(context.engine.getRowSourceIndex(index))
            : context.columns[index]!.key,
        position: axis === 'row' ? context.headerHeight + rect.y : rect.x,
        size: axis === 'row' ? rect.height : rect.width,
      };
    });
    const snapshot = context.doc.createElement('canvas');
    snapshot.width = context.canvas.width;
    snapshot.height = context.canvas.height;
    snapshot.getContext('2d')!.drawImage(context.canvas, 0, 0);
    const result = run();
    if (context.frame !== undefined) {
      context.win.cancelAnimationFrame(context.frame);
      context.frame = undefined;
    }
    context.draw();
    const nextView = context.viewport();
    const positions = new Map<string | number, number>();
    for (const region of nextView.regions) {
      const range = axis === 'row' ? region.rows : region.columns;
      for (let i = range.start; i < range.end; i++) {
        const rect = nextView.cellRect(axis === 'row' ? i : 0, axis === 'column' ? i : 0);
        positions.set(
          axis === 'row' ? context.dataSource.getRowId(context.engine.getRowSourceIndex(i)) : context.columns[i]!.key,
          axis === 'row' ? context.headerHeight + rect.y : rect.x,
        );
      }
    }
    const ratio = snapshot.width / context.canvas.clientWidth;
    for (const strip of old) {
      const next = positions.get(strip.key);
      if (next === strip.position) continue;
      const start = Math.max(axis === 'row' ? context.headerHeight : 0, strip.position),
        end = Math.min(
          axis === 'row' ? context.canvas.clientHeight : context.canvas.clientWidth,
          strip.position + strip.size,
        );
      if (end <= start) continue;
      const tile = context.doc.createElement('canvas');
      tile.dataset.gridMotion = axis;
      tile.setAttribute('aria-hidden', 'true');
      const width = axis === 'row' ? context.canvas.clientWidth : end - start,
        height = axis === 'row' ? end - start : context.canvas.clientHeight;
      tile.width = Math.ceil(width * ratio);
      tile.height = Math.ceil(height * ratio);
      tile
        .getContext('2d')!
        .drawImage(
          snapshot,
          (axis === 'row' ? 0 : start) * ratio,
          (axis === 'row' ? start : 0) * ratio,
          width * ratio,
          height * ratio,
          0,
          0,
          tile.width,
          tile.height,
        );
      const destination = next ?? start;
      tile.style.cssText = `position:absolute;pointer-events:none;z-index:8;left:${context.indexWidth + (axis === 'column' ? destination : 0)}px;top:${axis === 'row' ? destination : 0}px;width:${width}px;height:${height}px`;
      context.root.append(tile);
      layoutMotion.add(tile);
      const delta = start - destination;
      const animation = tile.animate(
        [
          { transform: axis === 'row' ? `translateY(${delta}px)` : `translateX(${delta}px)`, opacity: 1 },
          { transform: 'translate(0,0)', opacity: 1, offset: 0.8 },
          { transform: 'translate(0,0)', opacity: 0 },
        ],
        { duration: context.motionDuration, easing: 'cubic-bezier(.22,1,.36,1)' },
      );
      const remove = () => {
        tile.remove();
        layoutMotion.delete(tile);
      };
      animation.finished.then(remove, remove);
    }
    return result;
  }
  return {
    enterSurface,
    exitSurface,
    clearLayoutMotion,
    animateLayout,
    motionEnabled,
    removeMotionListener: () => motionPreference.removeEventListener('change', cancelMotion),
  };
}
