import { defineComponent, h, onMounted, onBeforeUnmount, shallowRef, watch } from 'vue';
import type { PropType } from 'vue';
import { createGrid } from '@acheron-grid/canvas';
import type { Grid, GridOptions, GridTheme } from '@acheron-grid/canvas';

export type AcheronGridOptions = Omit<GridOptions, 'container'>;
export interface AcheronGridHandle { getGrid(): Grid | null; }

export const AcheronGrid = defineComponent({
  name: 'AcheronGrid',
  props: {
    options: { type: Object as PropType<AcheronGridOptions>, required: true },
    theme: Object as PropType<Partial<GridTheme>>,
    view: Object as PropType<NonNullable<GridOptions['view']>>,
    frozenRows: Number,
    frozenColumns: Number,
  },
  emits: {
    ready: (_grid: Grid | null) => true,
    event: (_event: Parameters<NonNullable<GridOptions['onEvent']>>[0]) => true,
  },
  setup(props, { emit, expose }) {
    const container = shallowRef<HTMLDivElement | null>(null);
    let grid: Grid | null = null;
    expose({ getGrid: () => grid } satisfies AcheronGridHandle);
    const dispose = () => { if (grid) { grid.destroy(); grid = null; emit('ready', null); } };
    const mount = () => {
      if (!container.value) return;
      grid = createGrid({ ...props.options, container: container.value });
      try {
        grid.subscribe({onEvent:event=>emit('event',event)});
        sync();
        emit('ready', grid);
      } catch (error) { dispose(); throw error; }
    };
    const sync = () => {
      if (!grid) return;
      if (props.theme) grid.setTheme(props.theme);
      if (props.view) grid.setView(props.view);
      if (props.frozenRows !== undefined || props.frozenColumns !== undefined) grid.setFrozen(props.frozenRows ?? grid.frozenRows, props.frozenColumns ?? grid.frozenColumns);
    };
    onMounted(mount);
    onBeforeUnmount(dispose);
    watch(() => props.options, () => { dispose(); mount(); }, { flush: 'post' });
    watch(() => props.theme, theme => { if (theme) grid?.setTheme(theme); }, { flush: 'post' });
    watch(() => props.view, view => { if (view) grid?.setView(view); }, { flush: 'post' });
    watch(() => [props.frozenRows, props.frozenColumns], () => {
      if (grid && (props.frozenRows !== undefined || props.frozenColumns !== undefined)) grid.setFrozen(props.frozenRows ?? grid.frozenRows, props.frozenColumns ?? grid.frozenColumns);
    }, { flush: 'post' });
    return () => h('div', { ref: container });
  },
});

export type { Grid, GridOptions, GridTheme } from '@acheron-grid/canvas';
