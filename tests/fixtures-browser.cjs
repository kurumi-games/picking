const {chromium}=require('playwright');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const name=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!name.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(name,(err,data)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.webp')?'image/webp':'text/html');res.end(data);});});
let browser;
(async()=>{
await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--no-zygote','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],headless:true});
const page=await browser.newPage({viewport:{width:900,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errors.push(m.text());});
await page.goto('http://127.0.0.1:'+server.address().port+'/warehouse-full-preview.html');await page.waitForFunction(()=>window.fullWarehouse?.world.shelfLayouts.length===1);
const detail=await page.evaluate(()=>{
 const world=fullWarehouse.world,a=world.shelfLayouts[0],r=a.rows,nav=fullWarehouse.nav,p=fullWarehouse.getPosition(),reachable=nav.flood(nav.nearest(p.x,p.z));
 const aisles=r.slice(0,-1).map((row,i)=>({x:row.x+row.w/2,z:(row.z+row.d+r[i+1].z)/2}));
 return {rows:r.length,gap:a.gap,levels:a.levels,aislesClear:aisles.every(q=>!nav.blocked(q.x,q.z)&&reachable[nav.nearest(q.x,q.z)]),rowsBlocked:r.every(q=>nav.blocked(q.x+q.w/2,q.z+q.d/2)),oneZone:world.pickZones.filter(z=>z.userData.rect.label==='棚番の品').length,storage:localStorage.length};
});assert.equal(detail.rows,4);assert.equal(detail.levels,5);assert.equal(detail.oneZone,1);assert(detail.aislesClear);assert(detail.rowsBlocked);assert.equal(detail.storage,0);assert(Math.abs(detail.gap-4)<.03);
// A different area explicitly styled as shelf must retain its solid block.
assert.equal(await page.evaluate(()=>Warehouse3D.shelfLayout({x:0,y:0,w:10,h:10,label:'資材',view3d:'shelf'})),null);
// Optional baseline comparison: every render instance outside the two requested areas stays identical.
if(process.env.BASELINE_WORLD){
 const baseline=fs.readFileSync(process.env.BASELINE_WORLD,'utf8');
 const diff=await page.evaluate(code=>{
 const current=Warehouse3D,db={maps:{floors:[WarehouseLayout.floor]},spots:{}};const before=JSON.stringify(db);
 function snapshot(world){const records=[];const fixtures=WarehouseLayout.floor.rects.filter(r=>r.label==='棚番の品'||r.type==='door');
 const ignore=(x,z)=>fixtures.some(r=>x>=r.x*2-.4&&x<=(r.x+r.w)*2+.4&&z>=r.y*2-.4&&z<=(r.y+r.h)*2+.4);
 const round=v=>Number(v.toFixed(5));
 function material(m){return [m.type,m.color?.getHex(),m.roughness,m.metalness,m.opacity,m.map?.image?.src||'',m.map?.repeat.toArray()];}
 world.scene.traverse(o=>{if(o.isInstancedMesh){const matrix=new THREE.Matrix4();for(let i=0;i<o.count;i++){o.getMatrixAt(i,matrix);if(!ignore(matrix.elements[12],matrix.elements[14]))records.push(JSON.stringify(['instance',o.geometry.type,material(o.material),matrix.elements.map(round)]));}}
 else if(o.isMesh||o.isSprite||o.isLight){if(!ignore(o.position.x,o.position.z))records.push(JSON.stringify([o.type,o.geometry?.type,o.geometry?.parameters,o.material?material(o.material):null,o.position.toArray().map(round),o.rotation.toArray(),o.scale.toArray(),o.color?.getHex(),o.intensity,o.distance]));}});return records.sort();}
 const newWorld=current.createWorld(db,0,{walk:true});const after=snapshot(newWorld);current.dispose(newWorld.scene);
 (0,eval)(code);const oldWorld=Warehouse3D.createWorld(db,0,{walk:true});const prior=snapshot(oldWorld);Warehouse3D.dispose(oldWorld.scene);window.Warehouse3D=current;
 return {same:JSON.stringify(prior)===JSON.stringify(after),oldCount:prior.length,newCount:after.length,dbSame:JSON.stringify(db)===before};
 },baseline);assert(diff.same,JSON.stringify(diff));assert(diff.dbSame);console.log('PASS: all render instances outside shelf area and door match baseline',diff.oldCount);
}
// Capture door, then enter a real aisle via the map (no test-only camera movement).
if(process.env.SCREENSHOT_DIR){
 // Use the actual swipe control to face the door.
 await page.mouse.move(460,330);await page.mouse.down();await page.mouse.move(146,315,{steps:6});await page.mouse.up();await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'ver53-door.png')});}
await page.locator('#openMap').click();const aim=await page.evaluate(()=>{const a=fullWarehouse.world.shelfLayouts[0],row=a.rows[0],next=a.rows[1];return {x:row.x+3,z:(row.z+row.d+next.z)/2};});const bounds=await page.locator('#fullMap').boundingBox();await page.mouse.click(bounds.x+bounds.width*aim.x/70,bounds.y+bounds.height*aim.z/82);await page.waitForFunction(()=>fullWarehouse.getPosition().z>55);
// Turn down the shelf aisle using a drag; confirm position remains in a free cell.
await page.mouse.move(200,350);await page.mouse.down();await page.mouse.move(828,350,{steps:10});await page.mouse.up();
assert(await page.evaluate(()=>{const v=fullWarehouse,p=v.getPosition();return !v.nav.blocked(p.x,p.z);}));
if(process.env.SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'ver53-shelves.png')});assert.deepEqual(errors,[]);console.log('PASS: four empty shelf rows, connected internal aisles, one pick region, door, map navigation, no errors');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
