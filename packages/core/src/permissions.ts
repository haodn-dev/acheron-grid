import type { CellSelection } from './types.js';

export interface CellPermission {
  readonly editable: boolean;
  readonly selectable: boolean;
  readonly copyable: boolean;
  readonly pasteable: boolean;
  readonly writable: boolean;
  readonly formatting: boolean;
}
export type CellPermissionPolicy = Partial<CellPermission>;
export type CellPermissionResolver = (cell: Readonly<CellSelection>) => CellPermissionPolicy | undefined;

/** Explicit denials survive every later scope; defaults are not denials. */
export function resolvePermissions(
  editable: boolean,
  ...policies: readonly (CellPermissionPolicy | undefined)[]
): CellPermission {
  const result = { editable, pasteable: editable, selectable: true, copyable: true, writable: true, formatting: true };
  for (const key of Object.keys(result) as (keyof CellPermission)[]) {
    for (const policy of policies) {
      const value = policy?.[key];
      if (value !== undefined && typeof value !== 'boolean') throw new TypeError('Cell permissions must be boolean.');
      if (value === false) {
        result[key] = false;
        break;
      }
      if (value === true) result[key] = true;
    }
  }
  if (!result.writable) result.editable = result.pasteable = false;
  return Object.freeze(result);
}
