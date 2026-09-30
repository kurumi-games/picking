// ver65: dragging an unselected part pans the map; a tap selects it; only a selected part moves.
const {chromium}=require('playwright'),fs=require('fs'),http=require('http'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+req.url.split('?')[0]);if(!p.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(p,(e,d)=>{if(e)return res.writeHead(404).end();res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.webp')?'image/webp':'text/html');res.end(d);});});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:412,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());const url='http://127.0.0.1:'+server.address().port;
await page.goto(url+'/index.html');await page.evaluate(()=>{const db=JSON.parse(localStorage.getItem('pickingDB_v1')||'{}');db.maps={cur:0,floors:[{name:'検証',cols:20,rows:20,rects:[{id:1,x:4,y:4,w:4,h:4,label:'パレット'}]}]};localStorage.setItem('pickingDB_v1',JSON.stringify(db));});await page.reload();
const read=async()=>(await page.evaluate(()=>JSON.parse(localStorage.getItem('pickingDB_v1')))).maps.floors[0].rects[0];
await page.locator('#bnMap').click();const rect=page.locator('.mp-rect[data-id="1"]');
const drag=async()=>{const b=await rect.boundingBox(),f=await page.locator('#mpFrame').boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2+f.width/10,b.y+b.height/2+f.height/10,{steps:6});await page.mouse.up();};
const frame0=await page.locator('#mpFrame').boundingBox();
await drag();let r=await read();assert.deepEqual([r.x,r.y],[4,4],'unselected part must not move');
assert.equal(await rect.evaluate(e=>e.classList.contains('sel')),false,'drag must not select');
const frame1=await page.locator('#mpFrame').boundingBox();assert(frame1.x>frame0.x+20&&frame1.y>frame0.y+20,'map should pan');
await rect.click();assert(await rect.evaluate(e=>e.classList.contains('sel')),'tap selects');
await drag();r=await read();assert.deepEqual([r.x,r.y],[6,6],'selected part moves');
await page.mouse.click(5,900);
assert.deepEqual(errors,[]);console.log('PASS: pan over unselected part, tap to select, move only when selected');await browser.close();server.close();})().catch(e=>{console.error(e);process.exit(1);});
