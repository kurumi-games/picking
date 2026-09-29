const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../warehouse-walk.js'),'utf8'),{window});
const {navigation,palletCell}=window.WarehouseWalk;
// A wall with a lower opening forces the route around it, never through it.
const nav=navigation(20,20,[[9,0,11,15]]),start=nav.nearest(4,3),end=nav.nearest(16,3),route=nav.path(start,end);
assert(route&&route.some(p=>p[1]>15));for(const p of route)assert(!nav.blocked(...p));
// A sealed wall cannot be crossed by map taps or movement.
const sealed=navigation(20,20,[[9,0,11,20]]),a=sealed.nearest(4,3),b=sealed.nearest(16,3);
assert.equal(sealed.path(a,b),null);assert.equal(sealed.flood(a)[b],0);
// Search lands outside the pallet, in a reachable aisle.
const pallet={x:3,y:3,w:2,h:2};const n=navigation(20,20,[[6,6,10,10]]),i=n.nearest(3,3),approach=n.approach(pallet,n.flood(i),3,3);
assert(approach>=0);assert(!n.blocked(...n.point(approach)));
// A fully packed floor reports no walkable start rather than spawning in stock.
assert.equal(navigation(4,4,[[0,0,4,4]]).nearest(2,2),-1);
// Pallets are anchored to their rectangle, not global even grid coordinates.
const r={x:3,y:5,w:5,h:3};const c=palletCell(r,15.9,15.9,1);
assert.equal(JSON.stringify(c),JSON.stringify({f:1,x:7,y:7,w:1,h:1,s:'r'}));
assert.equal(palletCell(r,6.1,10.1,0).x,3);
console.log('PASS: aisle routes, disconnected areas, safe search arrival, full floor, two-cell pallet picking');
