import type { CellRenderer } from '@acheron-grid/canvas';
export type ChartKind = 'line' | 'area' | 'column' | 'bar';
export interface ChartOptions {
  readonly kind: ChartKind;
  readonly curve?: 'linear' | 'smooth';
  readonly color?: string;
  readonly lineWidth?: number;
  readonly markerRadius?: number;
  readonly fillOpacity?: number;
  readonly showBaseline?: boolean;
  readonly domain?: readonly [number, number];
  readonly threshold?: number;
  readonly thresholdColor?: string;
  readonly highlight?: readonly ('min' | 'max' | 'last')[];
  readonly highlightColor?: string;
}
export interface ChartPoint {
  readonly x: number;
  readonly y: number;
}

/** Normalize bounded series; null and non-finite entries are gaps. */
export function chartGeometry(
  values: readonly unknown[],
  width: number,
  height: number,
  kind: ChartKind = 'line',
  domain?: readonly [number, number],
) {
  if (
    !Array.isArray(values) ||
    values.length > 512 ||
    ![width, height].every((n) => Number.isFinite(n) && n > 0) ||
    !['line', 'area', 'column', 'bar'].includes(kind) ||
    (domain !== undefined &&
      (!Array.isArray(domain) ||
        domain.length !== 2 ||
        !Number.isFinite(domain[0]) ||
        !Number.isFinite(domain[1]) ||
        domain[0] >= domain[1] ||
        (kind !== 'line' && (domain[0] > 0 || domain[1] < 0))))
  )
    throw new RangeError('Invalid inline chart dimensions or series.');
  const numeric = Array.from(values, (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null));
  const finite = numeric.filter((value): value is number => value !== null);
  const min = domain ? domain[0] : finite.length ? Math.min(...finite, ...(kind === 'line' ? [] : [0])) : 0,
    max = domain ? domain[1] : finite.length ? Math.max(...finite, ...(kind === 'line' ? [] : [0])) : 0;
  // Half scaling avoids overflow for domains spanning both finite extremes.
  const span = max - min;
  const normalize = (value: number) =>
    min === max
      ? 0.5
      : value <= min
        ? 0
        : value >= max
          ? 1
          : Number.isFinite(span)
            ? (value - min) / span
            : (value / 2 - min / 2) / (max / 2 - min / 2);
  const points = numeric.map((value, i) =>
    value === null
      ? null
      : Object.freeze({
          x: values.length === 1 ? width / 2 : (i * width) / Math.max(1, values.length - 1),
          y: (1 - normalize(value)) * height,
        }),
  );
  return Object.freeze({
    points: Object.freeze(points),
    baseline: (1 - (min === max ? (min > 0 ? 0 : min < 0 ? 1 : 0.5) : Math.max(0, Math.min(1, normalize(0))))) * height,
    min,
    max,
    count: finite.length,
  });
}

// Samples are evenly spaced. Harmonic tangents preserve monotonic runs and flatten only extrema.
function smoothTangent(
  previous: ChartPoint | null | undefined,
  point: ChartPoint,
  next: ChartPoint | null | undefined,
): number {
  if (!previous) return next ? next.y - point.y : 0;
  if (!next) return point.y - previous.y;
  const before = point.y - previous.y,
    after = next.y - point.y;
  if (before === 0 || after === 0 || Math.sign(before) !== Math.sign(after)) return 0;
  const small = Math.min(Math.abs(before), Math.abs(after)),
    large = Math.max(Math.abs(before), Math.abs(after));
  return Math.sign(before) * small * (2 / (1 + small / large));
}

/** Stateless Canvas renderer; clipping/DPR are owned by the grid. */
export function createChartRenderer(
  columns: Readonly<Record<string, ChartKind | ChartOptions>>,
  color = '#d44b21',
): CellRenderer {
  const bindings = Object.fromEntries(
    Object.entries(columns).map(([key, value]) => {
      const options = {
        curve: 'linear',
        color,
        lineWidth: 1.5,
        markerRadius: 1.5,
        fillOpacity: 0.18,
        showBaseline: false,
        thresholdColor: '#64748b',
        highlightColor: color,
        highlight: [] as readonly ('min' | 'max' | 'last')[],
        ...(typeof value === 'string' ? { kind: value } : value),
      };
      if (
        !['line', 'area', 'column', 'bar'].includes(options.kind) ||
        !['linear', 'smooth'].includes(options.curve) ||
        typeof options.color !== 'string' ||
        !options.color.trim() ||
        ![options.lineWidth, options.markerRadius, options.fillOpacity].every(Number.isFinite) ||
        options.lineWidth <= 0 ||
        options.markerRadius < 0 ||
        options.fillOpacity < 0 ||
        options.fillOpacity > 1 ||
        typeof options.showBaseline !== 'boolean' ||
        (options.threshold !== undefined && !Number.isFinite(options.threshold)) ||
        ![options.thresholdColor, options.highlightColor].every((value) => typeof value === 'string' && value.trim()) ||
        !Array.isArray(options.highlight) ||
        Array.from(options.highlight).some((value) => !['min', 'max', 'last'].includes(value))
      )
        throw new TypeError('Invalid chart options.');
      if (options.domain !== undefined) {
        chartGeometry([], 1, 1, options.kind, options.domain);
        options.domain = Object.freeze([...options.domain]) as readonly [number, number];
      }
      options.highlight = Object.freeze([...options.highlight]);
      return [key, Object.freeze(options)];
    }),
  );
  return (context, cell) => {
    const options = Object.hasOwn(bindings, cell.columnKey) ? bindings[cell.columnKey] : undefined;
    if (!options || !Array.isArray(cell.value)) return false;
    const values = cell.value;
    const { kind } = options;
    const width = cell.width - 16,
      height = cell.height - 12;
    if (width <= 0 || height <= 0) return true;
    const target = chartGeometry(cell.value, width, height, kind, options.domain);
    const progress =
      typeof cell.animationProgress === 'number' && Number.isFinite(cell.animationProgress)
        ? Math.max(0, Math.min(1, cell.animationProgress))
        : 1;
    const previous =
      progress < 1 && Array.isArray(cell.previousValue) && cell.previousValue.length <= 512
        ? chartGeometry(cell.previousValue, width, height, kind, options.domain)
        : undefined;
    const geometry = previous
      ? {
          ...target,
          baseline: previous.baseline * (1 - progress) + target.baseline * progress,
          points: target.points.map((point, index) => {
            const old = previous.points[Math.min(index, previous.points.length - 1)];
            return point && old
              ? { x: old.x * (1 - progress) + point.x * progress, y: old.y * (1 - progress) + point.y * progress }
              : point;
          }),
        }
      : target;
    context.save();
    try {
      context.beginPath();
      context.rect(cell.x, cell.y, cell.width, cell.height);
      context.clip();
      context.translate(cell.x + 8, cell.y + 6);
      context.strokeStyle = options.color;
      context.fillStyle = options.color;
      context.lineWidth = options.lineWidth;
      context.lineJoin = 'round';
      context.lineCap = 'round';
      if (options.showBaseline && geometry.count) {
        context.beginPath();
        if (kind === 'bar') {
          const x = width * (1 - geometry.baseline / height);
          context.moveTo(x, 0);
          context.lineTo(x, height);
        } else {
          context.moveTo(0, geometry.baseline);
          context.lineTo(width, geometry.baseline);
        }
        context.stroke();
      }
      if (kind === 'line' || kind === 'area') {
        let start: ChartPoint | undefined, previous: ChartPoint | undefined;
        const finish = () => {
          if (!start || !previous) return;
          context.stroke();
          if (kind === 'area') {
            context.lineTo(previous.x, geometry.baseline);
            context.lineTo(start.x, geometry.baseline);
            context.closePath();
            const alpha = context.globalAlpha;
            context.globalAlpha = alpha * options.fillOpacity;
            context.fill();
            context.globalAlpha = alpha;
          }
          start = previous = undefined;
        };
        for (const [index, point] of geometry.points.entries()) {
          if (!point) {
            finish();
            continue;
          }
          if (!previous) {
            context.beginPath();
            context.moveTo(point.x, point.y);
            start = point;
          } else if (options.curve === 'smooth') {
            // Matching tangents join samples without the repeated easing of flat control handles.
            const dx = (point.x - previous.x) / 3;
            const from = smoothTangent(geometry.points[index - 2], previous, point);
            const to = smoothTangent(previous, point, geometry.points[index + 1]);
            context.bezierCurveTo(
              previous.x + dx,
              previous.y + from / 3,
              point.x - dx,
              point.y - to / 3,
              point.x,
              point.y,
            );
          } else context.lineTo(point.x, point.y);
          previous = point;
        }
        finish();
        for (const point of geometry.points)
          if (point && options.markerRadius > 0) {
            context.beginPath();
            context.arc(point.x, point.y, options.markerRadius, 0, Math.PI * 2);
            context.fill();
          }
      } else {
        const step = (kind === 'bar' ? height : width) / Math.max(1, geometry.points.length);
        geometry.points.forEach((point, i) => {
          if (!point) return;
          if (kind === 'column')
            context.fillRect(
              i * step + step * 0.1,
              Math.min(point.y, geometry.baseline),
              step * 0.8,
              Math.abs(point.y - geometry.baseline),
            );
          else {
            const valueX = width * (1 - point.y / height),
              baselineX = width * (1 - geometry.baseline / height);
            context.fillRect(
              Math.min(valueX, baselineX),
              i * step + step * 0.1,
              Math.abs(valueX - baselineX),
              step * 0.8,
            );
          }
        });
      }
      if (
        geometry.count &&
        options.threshold !== undefined &&
        options.threshold >= geometry.min &&
        options.threshold <= geometry.max
      ) {
        const y = chartGeometry(
          [options.threshold],
          width,
          height,
          'line',
          geometry.min === geometry.max ? undefined : [geometry.min, geometry.max],
        ).points[0]!.y;
        context.strokeStyle = options.thresholdColor;
        context.lineWidth = 1;
        context.setLineDash([3, 3]);
        context.beginPath();
        if (kind === 'bar') {
          const x = width * (1 - y / height);
          context.moveTo(x, 0);
          context.lineTo(x, height);
        } else {
          context.moveTo(0, y);
          context.lineTo(width, y);
        }
        context.stroke();
        context.setLineDash([]);
      }
      if ((kind === 'line' || kind === 'area') && options.highlight.length && geometry.count) {
        const indices = geometry.points.flatMap((point, i) => (point ? [i] : []));
        const minimum = indices.reduce((a, b) => (values[a] <= values[b] ? a : b));
        const maximum = indices.reduce((a, b) => (values[a] >= values[b] ? a : b));
        const selected = new Set(
          options.highlight.map((mark) => (mark === 'min' ? minimum : mark === 'max' ? maximum : indices.at(-1)!)),
        );
        context.fillStyle = options.highlightColor;
        for (const i of selected) {
          const point = geometry.points[i]!;
          context.beginPath();
          context.arc(point.x, point.y, Math.max(3, options.markerRadius + 1), 0, Math.PI * 2);
          context.fill();
        }
      }
      return true;
    } finally {
      context.restore();
    }
  };
}
