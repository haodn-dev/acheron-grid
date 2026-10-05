import type { CellRenderer } from '@acheron-grid/canvas';
export type ChartKind = 'line' | 'column' | 'bar';
export interface ChartPoint { readonly x:number; readonly y:number; }

/** Normalize bounded series; null and non-finite entries are gaps. */
export function chartGeometry(values:readonly unknown[], width:number, height:number, kind:ChartKind='line') {
  if(!Array.isArray(values)||values.length>512||![width,height].every(n=>Number.isFinite(n)&&n>0)||!['line','column','bar'].includes(kind))throw new RangeError('Invalid inline chart dimensions or series.');
  const numeric=Array.from(values,value=>typeof value==='number'&&Number.isFinite(value)?value:null);
  const finite=numeric.filter((value):value is number=>value!==null);
  const min=finite.length?Math.min(...finite, ...(kind==='line'?[]:[0])):0, max=finite.length?Math.max(...finite,...(kind==='line'?[]:[0])):0;
  // Half scaling avoids overflow for domains spanning both finite extremes.
  const span=max-min;
  const normalize=(value:number)=>min===max?0.5:Number.isFinite(span)?(value-min)/span:(value/2-min/2)/(max/2-min/2);
  const points=numeric.map((value,i)=>value===null?null:Object.freeze({x:values.length===1?width/2:i*width/Math.max(1,values.length-1),y:(1-normalize(value))*height}));
  return Object.freeze({points:Object.freeze(points),baseline:(1-Math.max(0,Math.min(1,normalize(0))))*height,min,max,count:finite.length});
}

/** Stateless Canvas renderer; clipping/DPR are owned by the grid. */
export function createChartRenderer(columns:Readonly<Record<string,ChartKind>>, color='#d44b21'):CellRenderer {
  const bindings=Object.freeze({...columns});
  if(Object.values(bindings).some(kind=>!['line','column','bar'].includes(kind)))throw new TypeError('Invalid chart kind.');
  return (context,cell)=>{
    const kind=Object.hasOwn(bindings,cell.columnKey)?bindings[cell.columnKey]:undefined;
    if(!kind||!Array.isArray(cell.value))return false;
    const width=cell.width-16,height=cell.height-12;
    if(width<=0||height<=0)return true;
    const geometry=chartGeometry(cell.value,width,height,kind);
    context.save();
    try {
      context.beginPath();context.rect(cell.x,cell.y,cell.width,cell.height);context.clip();
      context.translate(cell.x+8,cell.y+6);context.strokeStyle=color;context.fillStyle=color;context.lineWidth=1.5;
      if(kind==='line') {
        context.beginPath();let connected=false;
        for(const point of geometry.points) {if(!point){connected=false;continue;}if(connected)context.lineTo(point.x,point.y);else context.moveTo(point.x,point.y);connected=true;}
        context.stroke();
        for(const point of geometry.points)if(point){context.beginPath();context.arc(point.x,point.y,1.5,0,Math.PI*2);context.fill();}
      } else {
        const step=(kind==='bar'?height:width)/Math.max(1,geometry.points.length);
        geometry.points.forEach((point,i)=>{
          if(!point)return;
          if(kind==='column')context.fillRect(i*step+step*0.1,Math.min(point.y,geometry.baseline),step*0.8,Math.abs(point.y-geometry.baseline));
          else {const valueX=width*(1-point.y/height),baselineX=width*(1-geometry.baseline/height);context.fillRect(Math.min(valueX,baselineX),i*step+step*0.1,Math.abs(valueX-baselineX),step*0.8);}
        });
      }
      return true;
    } finally {context.restore();}
  };
}
