import { useMemo, useRef } from 'react';
import { LocalDataSource } from '@acheron-grid/core';
import { AcheronGrid } from '@acheron-grid/react';
import type { AcheronGridHandle } from '@acheron-grid/react';

export function Sheet() {
  const ref = useRef<AcheronGridHandle>(null);
  const options = useMemo(() => ({
    columns: [{ key: 'name', title: 'Name', editable: true }],
    dataSource: new LocalDataSource([{ id: 1, name: 'Alpha' }], row => row.id),
  }), []);
  return <AcheronGrid ref={ref} options={options}
    style={{ height: 400, width: '100%' }}
    onEvent={event => console.log(event.type)} />;
}
