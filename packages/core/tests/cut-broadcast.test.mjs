import test from 'node:test';
import assert from 'node:assert/strict';
import {createGridEngine,LocalDataSource} from '../dist/index.js';
function fixture(extra={}) {
 const source=new LocalDataSource([{id:1,a:'A',b:'B'},{id:2,a:'C',b:'D'},{id:3,a:'E',b:'F'}],row=>row.id);
 const engine=createGridEngine({dataSource:source,columns:[{key:'a',title:'A',editable:true},{key:'b',title:'B',editable:true}],...extra});return {source,engine};
}
test('scalar paste fills selected cells and disjoint ranges atomically with formatting',()=>{
 const {engine,source}=fixture();engine.select(0,0);engine.format([{scope:'cell',rowIndex:0,columnIndex:0}],{fontWeight:'bold'});const text=engine.copySelectionBlocks();
 engine.selectRange({startRow:1,endRow:2,startColumn:0,endColumn:1});engine.pasteSelectionBlocks(text);
 assert.equal(source.getValue(2,'b'),'A');assert.equal(engine.getFormat(2,1).fontWeight,'bold');engine.undo();assert.equal(source.getValue(2,'b'),'F');
 engine.select(1,0);engine.addSelection(2,1);engine.pasteSelectionBlocks(text);assert.equal(source.getValue(1,'a'),'A');assert.equal(source.getValue(2,'b'),'A');
 engine.undo();engine.setLocked({scope:'cell',rowIndex:2,columnIndex:1},true);assert.throws(()=>engine.paste('X'));assert.equal(source.getValue(1,'a'),'C');
});
test('cut stages source until atomic paste succeeds, handles overlap and replays one history entry',()=>{
 const {engine,source}=fixture();engine.select(0,0);const cut=engine.cutSelectionBlocks();assert.equal(source.getValue(0,'a'),'A');engine.select(1,1);engine.pasteCutSelectionBlocks(cut);
 assert.equal(source.getValue(0,'a'),null);assert.equal(source.getValue(1,'b'),'A');engine.undo();assert.equal(source.getValue(0,'a'),'A');assert.equal(source.getValue(1,'b'),'D');engine.redo();assert.equal(source.getValue(0,'a'),null);
 engine.undo();engine.selectRange({startRow:0,endRow:1,startColumn:0,endColumn:0});const overlap=engine.cutSelectionBlocks();engine.select(1,0);engine.pasteCutSelectionBlocks(overlap);assert.equal(source.getValue(0,'a'),null);assert.equal(source.getValue(1,'a'),'A');assert.equal(source.getValue(2,'a'),'C');engine.undo();assert.equal(source.getValue(0,'a'),'A');assert.equal(source.getValue(2,'a'),'E');
});
test('cut validates destination and unchanged writable source before any clearing',()=>{
 const {engine,source}=fixture();engine.select(0,0);const cut=engine.cutSelectionBlocks();engine.select(1,1);engine.setLocked({scope:'cell',rowIndex:1,columnIndex:1},true);assert.throws(()=>engine.pasteCutSelectionBlocks(cut));assert.equal(source.getValue(0,'a'),'A');
 engine.setLocked({scope:'cell',rowIndex:1,columnIndex:1},false);engine.updateCells([{rowIndex:0,columnKey:'a',value:'Changed'}]);assert.throws(()=>engine.pasteCutSelectionBlocks(cut),/changed/i);assert.equal(source.getValue(1,'b'),'D');
 engine.cancelCut();assert.throws(()=>engine.pasteCutSelectionBlocks(cut),/pending/i);
});
