const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'..'),THREE=require(path.join(root,'vendor/three-r128.min.js')),context={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(root,'warehouse-office-fixtures.js'),'utf8'),context);
const fixtures=context.window.WarehouseOfficeFixtures;
function bounds(group){
  group.updateMatrixWorld(true);const result=new THREE.Box3();
  group.traverse(o=>{
    if(!o.geometry)return;o.geometry.computeBoundingBox();
    if(o.isInstancedMesh){for(let i=0;i<o.count;i++){const m=new THREE.Matrix4();o.getMatrixAt(i,m);m.premultiply(o.matrixWorld);result.union(o.geometry.boundingBox.clone().applyMatrix4(m));}}
    else result.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
  });return result;
}
function check(w,h,back){
  const r={id:1,type:'officefixture',fixture:'materialshelf',x:2,y:3,w,h,back},saved=JSON.stringify(r),group=fixtures.create(THREE,r),b=bounds(group),size=b.getSize(new THREE.Vector3());
  // A rack must occupy its footprint, not merely fit somewhere inside it.
  assert(size.x>w*2*.94&&size.x<=w*2+.001,JSON.stringify({w,h,back,size}));
  assert(size.z>h*2*.94&&size.z<=h*2+.001,JSON.stringify({w,h,back,size}));
  assert(Math.abs(size.y-7.2)<1e-6);
  assert(b.min.x>=r.x*2-.001&&b.max.x<=(r.x+w)*2+.001);
  assert(b.min.z>=r.y*2-.001&&b.max.z<=(r.y+h)*2+.001);
  // The model's width axis must follow the rectangle's long side, even for legacy back values.
  if(w!==h)assert.equal(Math.abs(Math.round(group.rotation.y/(Math.PI/2)))%2,Number(h>w));
  assert.equal(JSON.stringify(r),saved);return size;
}
for(const back of ['north','east','south','west']){
  for(const [w,h] of [[3,1],[1,3],[1,8],[8,1],[1.25,3.5],[3.5,1.25],[.25,.25]])check(w,h,back);
  const a=check(1,8,back),b=check(1,8,back),c=check(1,9,back);
  assert(a.equals(b));assert(Math.abs(c.z/a.z-9/8)<1e-6);assert(Math.abs(c.x-a.x)<1e-6);
}
console.log('PASS: shelf footprint coverage, four orientations, legacy tall rectangles, equal front shelves, longer rear shelf, fixed height and data preservation');
