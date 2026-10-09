import type { DataSource, GridEngine } from '@acheron-grid/core';
import type { MotionOptions } from '../grid.js';
import type { GridContext } from './grid-context.js';

interface MotionContext
  extends
    Pick<GridContext['env'], 'win' | 'doc'>,
    Pick<GridContext, 'engine'>,
    Readonly<Pick<GridContext['layout'], 'columns' | 'headerHeight' | 'indexWidth'>>,
    Readonly<Pick<GridContext['runtime'], 'destroyed'>>,
    Pick<GridContext['runtime'], 'frame'> {
  readonly settings: Required<MotionOptions>;
  readonly root: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly dataSource: DataSource;
  readonly draw: () => void;
  readonly viewport: () => ReturnType<GridEngine['getViewport']>;
}

export function resolveMotion(value: boolean | MotionOptions | undefined, doc: Document): Required<MotionOptions> {
  if (value !== undefined && typeof value !== 'boolean' && (!value || typeof value !== 'object'))
    throw new TypeError('Invalid motion settings.');
  const options = typeof value === 'object' ? value : {};
  const result = {
    duration: 220,
    easing: 'cubic-bezier(.22,1,.36,1)',
    selectionDuration: 120,
    surfaceDuration: 160,
    layout: value !== false,
    selection: value !== false,
    surfaces: value !== false,
    liveSort: false,
    valueIndicators: false,
    chartUpdates: value !== false,
    ...options,
  };
  for (const key of ['duration', 'selectionDuration', 'surfaceDuration'] as const)
    if (!Number.isFinite(result[key]) || result[key] < 0 || result[key] > 1000)
      throw new RangeError('Motion duration must be between 0 and 1000ms.');
  for (const key of ['layout', 'selection', 'surfaces', 'liveSort', 'valueIndicators', 'chartUpdates'] as const)
    if (typeof result[key] !== 'boolean') throw new TypeError('Motion switches must be boolean.');
  if (typeof result.easing !== 'string') throw new TypeError('Invalid motion easing.');
  try {
    doc.createElement('div').animate([], { duration: 0, easing: result.easing }).cancel();
  } catch {
    throw new TypeError('Invalid motion easing.');
  }
  return Object.freeze(result);
}

export function createMotion(context: MotionContext) {
  function syncSettings() {
    context.root.style.setProperty(
      '--acheron-feedback-duration',
      context.settings.surfaces && context.settings.duration > 0
        ? Math.min(context.settings.surfaceDuration, context.settings.duration) + 'ms'
        : '0ms',
    );
  }
  syncSettings();
  const layoutMotion = new Set<HTMLElement>();
  const motionPreference = context.win.matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = () => context.win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const motionEnabled = (kind: 'layout' | 'selection' | 'surfaces' = 'layout') =>
    context.settings[kind] && context.settings.duration > 0 && !reducedMotion();
  const cancelMotion = () => {
    if (reducedMotion()) {
      clearLayoutMotion();
      context.root.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    }
  };
  motionPreference.addEventListener('change', cancelMotion);

  function enterSurface(node: HTMLElement): void {
    if (!motionEnabled('surfaces')) return;
    node.style.transformOrigin = 'top left';
    node.animate(
      [
        { opacity: 0, transform: 'translateY(-2px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      {
        duration: Math.min(context.settings.surfaceDuration, context.settings.duration),
        easing: context.settings.easing,
      },
    );
  }

  function exitSurface(node: HTMLElement): void {
    node.style.pointerEvents = 'none';
    node.inert = true;
    node.setAttribute('aria-hidden', 'true');
    node.removeAttribute('data-grid-choices');
    if (!motionEnabled('surfaces') || context.destroyed) {
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
        {
          duration: Math.min(100, context.settings.surfaceDuration, context.settings.duration),
          easing: context.settings.easing,
        },
      )
      .finished.then(
        () => node.remove(),
        () => node.remove(),
      );
  }

  function clearLayoutMotion(): void {
    for (const node of layoutMotion) {
      node.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
      node.remove();
    }
    layoutMotion.clear();
  }

  function animateLayout<T>(run: () => T, axis: 'row' | 'column' | 'auto'): T {
    clearLayoutMotion();
    if (!motionEnabled() || !context.canvas.clientWidth || !context.canvas.clientHeight) return run();
    if (context.frame !== undefined) {
      context.win.cancelAnimationFrame(context.frame);
      context.frame = undefined;
      context.draw();
    }
    const oldView = context.viewport();
    const capture = (axis: 'row' | 'column') => {
      const indices = [
        ...new Set(
          oldView.regions.flatMap((region) => {
            const range = axis === 'row' ? region.rows : region.columns;
            return Array.from({ length: range.end - range.start }, (_, i) => range.start + i);
          }),
        ),
      ].slice(0, 64);
      return indices.map((index) => {
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
    };
    const rows = capture('row'),
      columns = capture('column');
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
    if (axis === 'auto') {
      const changedColumns = columns.some((strip) => {
        const index = context.columns.findIndex((column) => column.key === strip.key);
        return (
          index < 0 ||
          nextView.cellRect(0, index).x !== strip.position ||
          nextView.cellRect(0, index).width !== strip.size
        );
      });
      axis = changedColumns ? 'column' : 'row';
    }
    const old = axis === 'row' ? rows : columns;
    const positions = new Map<string | number, number>();
    const sizes = new Map<string | number, number>();
    for (const region of nextView.regions) {
      const range = axis === 'row' ? region.rows : region.columns;
      for (let i = range.start; i < range.end; i++) {
        const rect = nextView.cellRect(axis === 'row' ? i : 0, axis === 'column' ? i : 0);
        if ((axis === 'row' ? rect.height : rect.width) <= 0) continue;
        sizes.set(
          axis === 'row' ? context.dataSource.getRowId(context.engine.getRowSourceIndex(i)) : context.columns[i]!.key,
          axis === 'row' ? rect.height : rect.width,
        );
        positions.set(
          axis === 'row' ? context.dataSource.getRowId(context.engine.getRowSourceIndex(i)) : context.columns[i]!.key,
          axis === 'row' ? context.headerHeight + rect.y : rect.x,
        );
      }
    }
    const ratio = snapshot.width / context.canvas.clientWidth;
    if (!old.some((strip) => positions.get(strip.key) !== strip.position || sizes.get(strip.key) !== strip.size))
      return result;
    const layer = context.doc.createElement('div');
    const top = axis === 'row' ? context.headerHeight : 0;
    const extent = Math.min(
      axis === 'row' ? context.canvas.clientHeight : context.canvas.clientWidth,
      Math.max(...old.map((strip) => strip.position + strip.size)),
    );
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = `position:absolute;pointer-events:none;overflow:hidden;z-index:8;left:${context.indexWidth}px;top:${top}px;width:${axis === 'column' ? extent : context.canvas.clientWidth}px;height:${axis === 'row' ? Math.max(0, extent - top) : context.canvas.clientHeight}px;background:var(--acheron-background)`;
    context.root.append(layer);
    layoutMotion.add(layer);
    const transition = layer.animate([{ opacity: 1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }], {
      duration: context.settings.duration,
      easing: 'linear',
    });
    const removeLayer = () => {
      layer.remove();
      layoutMotion.delete(layer);
    };
    transition.finished.then(removeLayer, removeLayer);
    for (const strip of old) {
      const next = positions.get(strip.key);
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
      tile.style.cssText = `position:absolute;pointer-events:none;left:${axis === 'column' ? destination : 0}px;top:${axis === 'row' ? destination - top : 0}px;width:${width}px;height:${height}px`;
      layer.append(tile);
      const delta = start - destination;
      const animation = tile.animate(
        [
          { transform: axis === 'row' ? `translateY(${delta}px)` : `translateX(${delta}px)`, opacity: 1 },
          { transform: 'translate(0,0)', opacity: next === undefined ? 0 : 1 },
        ],
        { duration: context.settings.duration, easing: context.settings.easing },
      );
      const remove = () => {
        tile.remove();
      };
      animation.finished.then(remove, remove);
    }
    return result;
  }
  function animateFeedback(node: HTMLElement, frames: Keyframe[]) {
    if (motionEnabled('surfaces'))
      node.animate(frames, {
        duration: Math.min(context.settings.surfaceDuration, context.settings.duration),
        easing: context.settings.easing,
      });
  }
  function fadeSelection(
    rects: readonly {
      x: number;
      y: number;
      width: number;
      height: number;
      color: string;
      opacity: number;
      border: number;
    }[],
  ) {
    if (!motionEnabled('selection') || !context.settings.selectionDuration) return;
    for (const node of layoutMotion)
      if (node.hasAttribute('data-grid-selection-exit')) {
        node.getAnimations().forEach((animation) => animation.cancel());
        node.remove();
        layoutMotion.delete(node);
      }
    const visible = rects.slice(0, 64);
    if (!visible.length) return;
    const left = Math.min(...visible.map((rect) => rect.x));
    const top = Math.min(...visible.map((rect) => rect.y));
    const width = Math.max(...visible.map((rect) => rect.x + rect.width)) - left;
    const height = Math.max(...visible.map((rect) => rect.y + rect.height)) - top;
    const node = context.doc.createElement('canvas');
    node.dataset.gridSelectionExit = '';
    node.setAttribute('aria-hidden', 'true');
    node.style.cssText = 'position:absolute;pointer-events:none;z-index:7;border:none;';
    Object.assign(node.style, {
      left: left + context.indexWidth + 'px',
      top: top + 'px',
      width: width + 'px',
      height: height + 'px',
    });
    const ratio = context.win.devicePixelRatio || 1;
    node.width = Math.ceil(width * ratio);
    node.height = Math.ceil(height * ratio);
    const ctx = node.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = visible[0]!.color;
    ctx.globalAlpha = visible[0]!.opacity;
    ctx.beginPath();
    for (const rect of visible) ctx.rect(rect.x - left, rect.y - top, rect.width, rect.height);
    // One fill composites intersecting rectangles once, including exit feedback.
    ctx.fill();
    context.root.append(node);
    layoutMotion.add(node);
    const remove = () => {
      node.remove();
      layoutMotion.delete(node);
    };
    node
      .animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: context.settings.selectionDuration,
        easing: context.settings.easing,
      })
      .finished.then(remove, remove);
  }
  return {
    syncSettings,
    fadeSelection,
    animateFeedback,
    enterSurface,
    exitSurface,
    clearLayoutMotion,
    animateLayout,
    motionEnabled,
    removeMotionListener: () => motionPreference.removeEventListener('change', cancelMotion),
  };
}
