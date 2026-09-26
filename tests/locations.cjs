const assert=require('node:assert/strict');
const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const window={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../warehouse3d.js'),'utf8'),{window});
const {locations,find,materialize}=window.Warehouse3D;
const db={spots:{C00000001:{cells:[{f:0,x:2,y:2,s:'r'},{f:1,x:8,y:8,s:'p'}]},C00000010:{cells:[{f:0,x:12,y:12,s:'r'}]}},maps:{floors:[{cols:20,rows:20,rects:[{id:1,x:1,y:1,w:4,h:4,parts:['C00000001','B00000002']}]},{cols:20,rows:20,rects:[]}]}};
// Overflow leaves the original location and another floor intact.
assert.equal(find(db,'C1').cells.length,2);
// Move only the selected original location.
db.spots.C00000001.cells[0]={f:0,x:6,y:14,s:'b'};
assert.equal(find(db,'C1').cells[0].y,14);assert.equal(find(db,'C1').cells[1].f,1);
// An empty location cannot reappear via legacy shelf data or similar part C10.
db.spots.C00000001.cells.splice(0,1);assert.equal(find(db,'C1').cells.length,1);
db.spots.C00000001.cells=[];assert.equal(find(db,'C1'),null);assert.equal(find(db,'C10').cells.length,1);
const restored=JSON.parse(JSON.stringify(db));assert.equal(find(restored,'C1'),null);
// Editing a legacy-only entry preserves the scope and permits an explicit removal.
const key=materialize(db,'B2');assert.equal(db.spots[key].cells[0].w,4);
db.spots[key].cells=[];assert.equal(find(db,'B2'),null);
// Malformed or out-of-floor spots never create markers.
db.spots.C99={cells:[{f:5,x:1,y:1},{f:0,x:-1,y:1},{f:0,x:21,y:1}]};
assert.equal(locations(db).length,1);
console.log('PASS: overflow, individual move/removal, reload, legacy data, exact code matching, invalid locations');
