import type { GridConfiguration } from './configuration.js';
import type { RowId } from './data-source.js';
import type { CellFormatPatch, CellFormatTarget, CellLockTarget, CellSelection, RowGroup, SelectionRange } from './types.js';

/** UI/domain state only. Data, policies, parsers and undo history remain host-owned. */
export interface GridState {
  readonly version: 1;
  readonly configuration: GridConfiguration;
  readonly rowIds: readonly RowId[];
  readonly rowHeights: readonly (readonly [number,number])[];
  readonly manualRows: readonly number[];
  readonly hiddenRows?: readonly number[];
  readonly hiddenColumns?: readonly number[];
  readonly ranges: readonly SelectionRange[];
  readonly selection: Readonly<CellSelection> | null;
  readonly anchor: Readonly<CellSelection> | null;
  readonly activeParts?: number;
  readonly displayAnchor?: Readonly<{row:number;col:number}> | null;
  readonly merges: readonly SelectionRange[];
  readonly groups: readonly RowGroup[];
  readonly locks: readonly CellLockTarget[];
  readonly formats: readonly { readonly target: CellFormatTarget; readonly patch: CellFormatPatch }[];
}

/** Detailed coordinates and policies are checked by a staging engine before committing. */
export function readGridState(input: unknown): GridState {
  if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Invalid grid state.');
  const state=input as Record<string,unknown>;
  if(state.version!==1)throw new TypeError('Unsupported grid state version.');
  for(const key of ['rowIds','rowHeights','manualRows','ranges','merges','groups','locks','formats'])if(!Array.isArray(state[key]))throw new TypeError('Invalid state '+key+'.');
  // Limits mirror the live selection and outline limits; sparse metadata stays bounded by input size.
  if((state.ranges as unknown[]).length>128||(state.merges as unknown[]).length>1024||(state.groups as unknown[]).length>1024)throw new RangeError('State exceeds grid limits.');
  return state as unknown as GridState;
}
