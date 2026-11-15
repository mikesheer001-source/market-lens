import test from 'node:test';
import assert from 'node:assert/strict';
import {priceScaleFromDrag,timeScaleFromDrag} from '../lib/chart-gestures.ts';

test('price axis drag scales in a bounded positive domain',()=>{
 assert.equal(priceScaleFromDrag(1,0),1);
 assert.ok(priceScaleFromDrag(1,100)>1);
 assert.ok(priceScaleFromDrag(1,-100)<1);
 assert.equal(priceScaleFromDrag(1,100000),20);
 assert.equal(priceScaleFromDrag(1,-100000),.05);
 assert.equal(priceScaleFromDrag(NaN,1),1);
});
test('time axis zoom anchors the middle and clamps to available history',()=>{
 const zoomed=timeScaleFromDrag(100,300,100,1000);
 assert.ok(zoomed.count<100);
 assert.ok(Math.abs((zoomed.end-zoomed.count/2)-250)<=1);
 assert.deepEqual(timeScaleFromDrag(100,100,0,10),{count:10,end:10});
 assert.deepEqual(timeScaleFromDrag(0,0,0,0),{count:1,end:0});
});
test('time axis keeps latest bar pinned and supports zoom in and out',()=>{
 const zoomedIn=timeScaleFromDrag(100,1000,100,1000);
 const zoomedOut=timeScaleFromDrag(100,1000,-100,1000);
 assert.equal(zoomedIn.end,1000); assert.ok(zoomedIn.count<100);
 assert.equal(zoomedOut.end,1000); assert.ok(zoomedOut.count>100);
});
