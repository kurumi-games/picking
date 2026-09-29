const {chromium}=require('playwright');
const fs=require('fs'),http=require('http'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{const name=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]==='/'?'/index.html':req.url.split('?')[0]));if(!name.startsWith(root+path.sep)){res.writeHead(403).end();return;}fs.readFile(name,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(data);});});
let browser;
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--no-zygote','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],headless:true});
 const page=await browser.newPage({viewport:{width:412,height:850},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://**/*',r=>r.abort());
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.evaluate(()=>{const db=JSON.parse(localStorage.getItem('pickingDB_v1')||'{}');db.maps={cur:0,floors:[{name:'倉庫1階',cols:28,rows:32,floor:'green',rects:[{id:1,x:3,y:2,w:20,h:4,pal:true,label:'電源・本体'},{id:2,x:3,y:8,w:6,h:10,pal:true},{id:3,x:11,y:8,w:6,h:10,pal:true},{id:4,x:19,y:8,w:4,h:10,pal:true},{id:5,x:3,y:20,w:6,h:6,pal:true},{id:6,x:12,y:21,w:14,h:9,label:'棚番の品'},{id:7,x:0,y:14,w:1,h:2,type:'door',label:'扉'}]},{name:'2階',cols:20,rows:20,floor:'gray',rects:[{id:8,x:4,y:4,w:8,h:8,pal:true}]}]};db.spots={C00004765:{cells:[{f:0,x:3,y:8,w:2,h:2,s:'r'},{f:1,x:4,y:4,w:2,h:2,s:'b'}]}};localStorage.setItem('pickingDB_v1',JSON.stringify(db));});
 await page.reload();
 // Capture the public module's result for coordinate/collision and resource checks.
 await page.evaluate(()=>{const create=WarehouseWalk.create;WarehouseWalk.create=(...args)=>{window.testWalk=create(...args);return window.testWalk;};});
 await page.locator('#bnMap').click();await page.locator('#mpWalk').click();await page.waitForFunction(()=>window.testWalk?.renderer?.domElement.width>0);await page.waitForTimeout(700);
 // Drag changes the actual camera, not a sequence of still photographs.
 const before=await page.evaluate(()=>testWalk.getPosition());
 await page.mouse.move(200,330);await page.mouse.down();await page.mouse.move(280,330,{steps:5});await page.mouse.up();
 assert.notEqual(await page.evaluate(()=>testWalk.getPosition().yaw),before.yaw);
 // A visible floor arrow moves the camera without crossing an obstacle.
 const floorArrow=await page.evaluate(()=>{let result=null;testWalk.world.scene.children.filter(o=>o.isGroup&&o.children.some(c=>c.geometry?.type==='CircleGeometry')&&o.visible).some(g=>{const p=g.position.clone().project(testWalk.cam);if(Math.abs(p.x)<.8&&p.y>-.6&&p.y<.4){result={x:(p.x+1)*206,y:(1-p.y)*425};return true;}return false;});return result;});
 if(floorArrow){await page.mouse.click(floorArrow.x,floorArrow.y);await page.waitForTimeout(1000);const after=await page.evaluate(()=>testWalk.getPosition());assert(Math.hypot(after.x-before.x,after.z-before.z)>.1);}
 // Mini-map navigation follows a route within the connected aisle.
 const miniPoint=await page.evaluate(()=>{const mini=document.getElementById('wkMini'),{k,ox,oy}=mini._map,r=mini.getBoundingClientRect();return {x:r.left+(ox+3*k)/mini.width*r.width,y:r.top+(oy+44*k)/mini.height*r.height};});
 await page.mouse.click(miniPoint.x,miniPoint.y);await page.waitForTimeout(1500);
 assert(await page.evaluate(()=>{const p=testWalk.getPosition();return !testWalk.nav.blocked(p.x,p.z);}));
 if(process.env.SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'walk-initial.png')});
 await page.locator('#wkFind').click();await page.locator('#wkSearchCode').fill('C4765');await page.locator('#wkSearchForm button').click();await page.waitForTimeout(500);
 console.log('search',await page.locator('#wkTitle').textContent(),await page.locator('#wkBarTxt').textContent());
 console.log('position',await page.evaluate(()=>{const p=testWalk.getPosition();return {...p,blocked:testWalk.nav.blocked(p.x,p.z)};}));
 if(process.env.SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'walk-target.png')});
 // Register an additional code at the highlighted physical pallet.
 await page.locator('#wkRegister').click();
 const pixel=await page.evaluate(()=>{const p=new THREE.Vector3(8,.52,18).project(testWalk.cam);return {x:(p.x+1)/2*412,y:(1-p.y)/2*850};});console.log('pick pixel',pixel);
 await page.mouse.click(pixel.x,pixel.y);await page.waitForTimeout(200);
 if(!await page.locator('#wkPlace').evaluate(e=>e.classList.contains('on')))throw new Error('3D pallet pick did not open registration');
 await page.locator('#wkPlaceCode').fill('C777');await page.locator('#wkPlaceForm button[type=submit]').click();await page.waitForTimeout(250);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pickingDB_v1')).spots.C00000777.cells[0].x),3);
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pickingDB_v1')).spots.C00004765.cells.length),2);
 await page.locator('#wkFind').click();await page.locator('#wkSearchCode').fill('C4765');await page.locator('#wkSearchForm button').click();await page.waitForTimeout(150);await page.locator('#wkBarBtn').click();await page.waitForTimeout(250);
 assert.equal(await page.locator('#wkFloor').inputValue(),'1');
 await page.locator('#wkOverview').click();await page.waitForTimeout(250);console.log('overview canvas',await page.locator('#w3Stage canvas').count());
 await page.locator('#w3Close').click();await page.reload();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('pickingDB_v1')).spots.C00000777.cells.length),1);
 console.log('errors',errors);if(errors.length)throw new Error(errors.join(';'));
 console.log('PASS: mobile walkthrough, search, registration, multi-floor, overview, persistence');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await browser?.close();server.close();});
