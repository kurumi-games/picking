// Full picking order + existing saved data + mobile layout. Camera/OCR inputs are simulated.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');let browser;
const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+req.url.split('?')[0]);if(!p.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(p,(e,d)=>{if(e)return res.writeHead(404).end();res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');res.end(d);});});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const page=await browser.newPage({viewport:{width:412,height:915}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
 const fixture={products:{'KLE-4139-16-20':[
 {code:'C00000001',qty:'10',shelf:'H022-4',name:'電源ブッシング'},
 {code:'C00004259',qty:'100',shelf:'H054-5',name:'差し込みバンパー RB-016（穴塞ぎパッキン）'},
 {code:'C00000003',qty:'40',shelf:'H061-4',name:'ねじ'}]},maps:{cur:0,floors:[{name:'倉庫',w:20,h:20,rects:[{x:2,y:2,w:1,h:1,label:'145',type:'pallet'}]}]},spots:{C00004259:{cells:[{f:0,x:2,y:2,s:'r'}]}},lastUnits:50};
 await page.addInitScript(fixture=>{localStorage.setItem('pickingDB_v1',JSON.stringify(fixture));window.ZXing={BrowserMultiFormatReader:class{async decodeFromVideoDevice(a,b,cb){window.scanCode=v=>cb({getText:()=>v});}reset(){}}};},fixture);
 const url=process.env.PICKING_PUBLIC_URL || 'http://127.0.0.1:'+server.address().port;
 // Public smoke allows only the user's published app; prevent all CDN connections.
 if(process.env.PICKING_PUBLIC_URL)await page.unroute('https://**/*');
 if(process.env.PICKING_PUBLIC_URL)await page.route('https://**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
 await page.context().grantPermissions(['camera'],{origin:new URL(url).origin});await page.goto(url+'/index.html');
 await page.evaluate(()=>{window.QuantityOcr={read:async()=>({predicted:'98',rejection:null})};});
 await page.locator('.home-machine').click();await page.locator('#ssList .ss-row').nth(1).click();
 assert.equal(await page.locator('#targetCode').textContent(),'C00004259');assert.equal(await page.locator('#shelfBadge').textContent(),'H054-5');
 assert.equal(await page.locator('#workTitle').textContent(),'部品を確認');assert.equal(await page.locator('#postponeBtn').count(),0);
 await page.locator('#mapBadge').click();assert(await page.locator('#wmModal').evaluate(e=>e.classList.contains('on')));await page.locator('#wmClose').click();
 const shot=async name=>{if(process.env.PICKING_SCREENSHOTS){await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:path.join(process.env.PICKING_SCREENSHOTS,name+'.png'),fullPage:true});}};
 assert(!await page.locator('#camArea').isVisible());
 for(const [width,height] of [[360,640],[393,720],[412,915]]){
  await page.setViewportSize({width,height});
  assert(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight+1),'part screen should fit '+width+'x'+height);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
 }
 await shot('picking-v74-part');
 const before=await page.locator('#partStage').boundingBox();
 await page.locator('#camStartBtn').click();assert(!await page.locator('#target').isVisible());
 assert.deepEqual(await page.locator('#camArea').boundingBox(),before);
 await shot('picking-v74-camera');
 await page.evaluate(()=>window.oldScanCode=window.scanCode);
 await page.locator('#camArea').click({position:{x:12,y:12}});assert(await page.locator('#target').isVisible());
 await page.evaluate(()=>oldScanCode('C00004259'));assert.equal(await page.locator('#workTitle').textContent(),'部品を確認');
 // A rejected camera request restores the part card and permits a retry.
 await page.evaluate(()=>{window.decode=ZXing.BrowserMultiFormatReader.prototype.decodeFromVideoDevice;ZXing.BrowserMultiFormatReader.prototype.decodeFromVideoDevice=async()=>{throw Error('denied')};});
 await page.locator('#camStartBtn').click();assert(await page.locator('#target').isVisible());assert.match(await page.locator('#verdict').textContent(),/カメラを開けません/);
 await page.evaluate(()=>ZXing.BrowserMultiFormatReader.prototype.decodeFromVideoDevice=window.decode);
 await page.locator('#camStartBtn').click();

 await page.evaluate(()=>scanCode('C00004259'));await page.waitForFunction(()=>!document.getElementById('ocrShoot').disabled);
 assert.equal(await page.locator('#workTitle').textContent(),'個数を確認');assert.equal(await page.locator('#targetCode').textContent(),'C00004259');
 assert(await page.locator('#targetName').isVisible());assert.equal(await page.locator('#ocrModal').evaluate(el=>getComputedStyle(el).position),'static');
 await page.locator('#ocrShoot').click();await page.waitForFunction(()=>!document.getElementById('ocrShoot').disabled);await shot('picking-v74-quantity');
 await page.locator('#manualQtyBtn').click();assert(await page.locator('#nextBtn').isDisabled());await page.locator('#manualQtyConfirm').click();await page.locator('#nextBtn').click();
 assert.equal(await page.locator('#targetCode').textContent(),'C00000003');await page.locator('#missBtn').click();
 assert.equal(await page.locator('#targetCode').textContent(),'C00000001');await page.locator('#excludeBtn').click();
 assert(await page.locator('#finish').evaluate(e=>e.classList.contains('on')));assert.match(await page.locator('#finishCount').textContent(),/1部品 確認済み.*出庫不要 1件.*在庫不足 1件/);
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('pickingDB_v1')).maps),fixture.maps);
 assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('pickingDB_v1')).spots),fixture.spots);
 for(const width of [360,412]){await page.setViewportSize({width,height:800});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
 assert.deepEqual(errors,[]);console.log('PASS: machine selection, middle-start wrap order, shelf/map, white inline quantity UI, explicit manual check, separate exclusions/shortages, saved maps preserved; no JS errors.');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();server.close();});
