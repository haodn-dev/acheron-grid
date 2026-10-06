import test from 'node:test';
import assert from 'node:assert/strict';
import {createGridEngine,LocalDataSource,encodeBlocks,decodeBlocks} from '../dist/index.js';

function fixture(extra={}){
 const source=new LocalDataSource([{id:'a',x:1,y:2},{id:'b',x:3,y:4},{id:'c',x:5,y:6}],row=>row.id);
 const engine=createGridEngine({dataSource:source,columns:['x','y'].map(key=>({key,title:key,editable:true,parse:Number,validate:value=>Number.isFinite(value)?undefined:'Invalid number'})),...extra});
 engine.select(0,0);return {source,engine};
}
test('paste special values, formats, transpose and skip-empty preserve atomic history',()=>{
 const {source,engine}=fixture();
 const payload=encodeBlocks([{row:0,column:0,values:[['10','20'],['30','40']],formats:[[{numberFormat:'percent'},{background:'#fff'}],[{},{}]]}]);
 engine.pasteSelectionBlocks(payload,{mode:'values',transpose:true});
 assert.deepEqual([source.getValue(0,'x'),source.getValue(0,'y'),source.getValue(1,'x'),source.getValue(1,'y')],[10,30,20,40]);
 assert.deepEqual(engine.getFormat(0,0),{});engine.undo();engine.select(0,0);
 engine.pasteSelectionBlocks(payload,{mode:'formats'});assert.equal(source.getValue(0,'x'),1);assert.equal(engine.getFormat(0,0).numberFormat,'percent');
 engine.undo();assert.deepEqual(engine.getFormat(0,0),{});engine.redo();
 engine.select(0,0);engine.paste('\t7',{skipEmpty:true});assert.equal(source.getValue(0,'x'),1);assert.equal(source.getValue(0,'y'),7);
 engine.undo();assert.equal(source.getValue(0,'y'),2);
 const before=engine.exportState();assert.throws(()=>engine.paste('8\tNaN'),/Invalid number/);assert.equal(source.getValue(0,'x'),1);assert.deepEqual(engine.exportState(),before);
 assert.throws(()=>engine.paste('9',{mode:'bogus'}),/paste options/);engine.destroy();
});
test('format-only paste skips parsers/write permission but enforces formatting permission',()=>{
 let formatAllowed=true,parses=0;
 const {source,engine}=fixture({columns:[{key:'x',title:'X',parse:()=>{parses++;throw Error('Never parse');}},{key:'y',title:'Y'}],resolveCellPermission:()=>({writable:false,pasteable:false,formatting:formatAllowed})});
 const payload=encodeBlocks([{row:0,column:0,values:[['not numeric']],formats:[[{numberFormat:'currency'}]]}]);
 engine.pasteSelectionBlocks(payload,{mode:'formats'});assert.equal(parses,0);assert.equal(source.getValue(0,'x'),1);assert.equal(engine.getFormat(0,0).numberFormat,'currency');
 engine.undo();formatAllowed=false;assert.throws(()=>engine.pasteSelectionBlocks(payload,{mode:'formats'}),/formatting/);assert.deepEqual(engine.getFormat(0,0),{});
});
test('number formatting validates clipboard/state, overlays and undo without changing values',()=>{
 const {engine,source}=fixture();engine.format([{scope:'column',columnIndex:0}],{numberFormat:'decimal'});
 engine.format([{scope:'cell',rowIndex:0,columnIndex:0}],{numberFormat:'percent'});assert.equal(engine.getFormat(0,0).numberFormat,'percent');
 engine.undo();assert.equal(engine.getFormat(0,0).numberFormat,'decimal');engine.redo();
 const state=engine.exportState();engine.format([{scope:'table'}],{numberFormat:null});engine.restoreState(state);assert.equal(engine.getFormat(0,0).numberFormat,'percent');assert.equal(source.getValue(0,'x'),1);
 assert.throws(()=>engine.format([{scope:'table'}],{numberFormat:'eval'}),/format/);
 assert.throws(()=>decodeBlocks(encodeBlocks([{row:0,column:0,values:[['1']],formats:[[{numberFormat:'eval'}]]}])),/format/);
});
test('hidden geometry retains sizes/identities through view, state, structure and history',()=>{
 const {engine,source}=fixture();engine.setRowHeight(1,48);engine.setColumnWidth(1,200);
 engine.setRowsHidden([1],true);engine.setColumnsHidden([1],true);
 assert.equal(engine.rows.position(3),64);assert.equal(engine.columnsLayout.position(2),160);assert.equal(engine.getSelection(),null);
 assert.equal(source.getValue(1,'y'),4);assert.equal(engine.exportConfiguration().columns[1].width,200);
 const state=engine.exportState();engine.setRowsHidden([1],false);engine.setColumnsHidden([1],false);engine.restoreState(state);
 assert.deepEqual(engine.getHiddenRows(),[1]);assert.deepEqual(engine.getHiddenColumns(),[1]);
 engine.setView({sort:{columnKey:'x',direction:'desc'}});assert.equal(engine.isRowHidden(1),true);assert.equal(engine.rows.size(1),0);
 engine.setView({});engine.moveRows([1],0);assert.deepEqual(engine.getHiddenRows(),[0]);engine.undo();assert.deepEqual(engine.getHiddenRows(),[1]);
 engine.moveColumns([1],0);assert.deepEqual(engine.getHiddenColumns(),[0]);engine.undo();
 engine.setRowsHidden([1],false);assert.equal(engine.rows.size(1),48);engine.undo();assert.equal(engine.rows.size(1),0);engine.redo();assert.equal(engine.rows.size(1),48);
});
test('visibility veto and malformed saved state leave geometry unchanged',()=>{
 let allow=true;const {engine}=fixture({canChangeVisibility:()=>allow});
 engine.setRowsHidden([1],true);allow=false;assert.throws(()=>engine.undo(),/visibility/);assert.equal(engine.rows.size(1),0);
 const state=engine.exportState();assert.throws(()=>engine.restoreState({...state,hiddenColumns:[99]}));assert.deepEqual(engine.exportState(),state);
 allow=true;engine.setRowsHidden([1],false);assert.throws(()=>engine.setRowsHidden([0,0],true));assert.throws(()=>engine.restoreState({...state,hiddenRows:'bad'}));
});

 test('sparse hidden runs preserve million-row viewport hit testing without reading data',async()=>{
 const {GridAxis}=await import('../dist/axis.js');const axis=new GridAxis(1_000_000,24);
 axis.replaceHidden(Array.from({length:10_000},(_,i)=>i+1));assert.equal(axis.position(10_001),24);assert.equal(axis.indexAt(24),10_001);assert.deepEqual(axis.range(24,48),{start:10_001,end:10_003});
 axis.replaceHidden([999_999]);assert.equal(axis.indexAt(axis.position(999_999)),1_000_000);axis.replaceHidden([]);assert.equal(axis.size(999_999),24);
 });

test('state restore checks unhide policy by column identity and permits unchanged empty visibility',()=>{
 let allow=true;const {engine}=fixture({canChangeVisibility:({hidden})=>hidden||allow});engine.setRowsHidden([1],true);engine.setColumnsHidden([1],true);
 const state=engine.exportState();allow=false;assert.throws(()=>engine.restoreState({...state,hiddenRows:[],hiddenColumns:[]}),/visibility/);assert.deepEqual(engine.exportState(),state);
 const swapped={...state,hiddenRows:[],configuration:{...state.configuration,columns:[...state.configuration.columns].reverse()},hiddenColumns:[0]};
 assert.throws(()=>engine.restoreState(swapped),/visibility/);
 engine.restoreState({...swapped,hiddenRows:[1]});assert.deepEqual(engine.getHiddenColumns(),[0]);assert.equal(engine.columns[0].key,'y');
 const reordered=engine.exportState();assert.throws(()=>engine.restoreState({...reordered,hiddenColumns:[]}),/visibility/);assert.deepEqual(engine.exportState(),reordered);
 allow=true;engine.restoreState(swapped);assert.deepEqual(engine.getHiddenRows(),[]);
 const fixed=fixture({canChangeVisibility:()=>false}).engine;fixed.restoreState(fixed.exportState());assert.deepEqual(fixed.getHiddenRows(),[]);
});
