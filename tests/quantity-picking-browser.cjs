// Integration behavior: fake camera + injected OCR results. Recognition is tested separately.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');let browser;
const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+req.url.split('?')[0]);if(!p.startsWith(root+path.sep))return res.writeHead(403).end();fs.readFile(p,(err,data)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');res.end(data);});});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
 const page=await browser.newPage({viewport:{width:412,height:915}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('https://**/*',r=>r.abort());
 await page.addInitScript(()=>{window.ZXing={BrowserMultiFormatReader:class{async decodeFromVideoDevice(a,b,callback){window.scanCode=val=>callback({getText:()=>val});}reset(){}}};});
 const url='http://127.0.0.1:'+server.address().port;await page.context().grantPermissions(['camera'],{origin:url});
 await page.goto(url+'/index.html');
 await page.evaluate(()=>{window.answers=[];window.readCalls=0;window.QuantityOcr={read:async crop=>{readCalls++;if(!(crop instanceof HTMLCanvasElement)||!crop.width)throw Error('missing crop');await new Promise(r=>setTimeout(r,window.readDelay||0));return {predicted:answers.shift()??null,rejection:null};}};});
 async function start(qty='40',units='50'){
  if(await page.locator('#work').evaluate(e=>e.classList.contains('on')))await page.locator('#work [data-home]').click();
  else if(await page.locator('#finish').evaluate(e=>e.classList.contains('on')))await page.locator('#homeBtn2').click();
  await page.locator('#rows .c-in').nth(0).fill('C00000040');await page.locator('#rows .q-in').nth(0).fill(qty);
  await page.locator('#rows .c-in').nth(1).fill('C00000050');await page.locator('#rows .q-in').nth(1).fill('50');
  await page.locator('#startBtn').click();await page.locator('#ssUnits').fill(units);await page.locator('#ssTop').click();
 }
 async function scan(code='C00000040'){await page.evaluate(code=>window.scanCode(code),code);}
 async function ready(){await page.waitForFunction(()=>!document.getElementById('ocrShoot').disabled);}
 async function read(values){await page.evaluate(values=>window.answers=values,values);await ready();await page.locator('#ocrShoot').click();}
 async function settled(){await page.waitForFunction(()=>!document.getElementById('ocrShoot').disabled);}
 async function closed(){await page.waitForFunction(()=>!document.getElementById('ocrModal').classList.contains('on'));}
 async function locked(){assert(await page.locator('#nextBtn').evaluate(e=>e.classList.contains('locked')));}
 await start();await scan('C00000041');assert(!await page.locator('#ocrModal').evaluate(e=>e.classList.contains('on')));
 await page.evaluate(()=>window.scanCode('C00000040'));await ready();assert.equal(await page.locator('#ocrTarget').textContent(),'40');await locked();
 assert.equal(await page.locator('#ocrAccept').count(),0);
 await read(['39']);await settled();assert.match(await page.locator('#ocrStatus').textContent(),/必要数は40/);await locked();
 await read([null]);await settled();assert.equal(await page.locator('#ocrResult').textContent(),'読取できず');await locked();
 await read(['40','39']);await settled();await locked();assert.match(await page.locator('#ocrStatus').textContent(),/次へ進めません/);
 await page.evaluate(()=>window.savedTrack=document.getElementById('ocrVideo').srcObject.getVideoTracks()[0]);
 if(process.env.QUANTITY_SCREENSHOT)await page.screenshot({path:process.env.QUANTITY_SCREENSHOT,fullPage:true});
 await read(['40','40']);await closed();assert.equal(await page.evaluate(()=>savedTrack.readyState),'ended');assert(!await page.locator('#nextBtn').evaluate(e=>e.classList.contains('locked')));
 await page.locator('#nextBtn').click();assert.match(await page.locator('#targetCode').textContent(),/C00000050/);assert.equal(await page.locator('#qtyRows .checked').count(),0);
 // A row tap opens reading and cannot check itself; cancel and late reads cannot pass.
 await start();await scan();await ready();await page.locator('#ocrCancel').click();await page.locator('#qtyRows .qty-row').click();await ready();await locked();
 await page.evaluate(()=>window.readDelay=300);await read(['40','40']);await page.locator('#ocrCancel').click();await page.locator('#redoBtn').click();await page.waitForTimeout(800);assert.equal(await page.locator('#qtyRows .checked').count(),0);await locked();await page.evaluate(()=>window.readDelay=0);
 // Two identical boxes need separate reads. A successful first box never passes the second.
 await start('80','100');await scan();await read(['40','40']);await closed();await locked();assert.equal(await page.locator('#qtyRows .checked').count(),1);
 await page.locator('#qtyRows .qty-row').nth(1).click();await ready();assert.match(await page.locator('#ocrBatch').textContent(),/2箱目/);await read(['40','40']);await closed();assert(!await page.locator('#nextBtn').evaluate(e=>e.classList.contains('locked')));
 // Unknown target cannot auto-pass; manual barcode bypass still requires OCR plus name check.
 await start('');await scan();assert(!await page.locator('#ocrModal').evaluate(e=>e.classList.contains('on')));await locked();
 await start();await page.locator('#skipBtn').click();await read(['40','40']);await closed();await locked();await page.locator('#chk3').click();assert(!await page.locator('#nextBtn').evaluate(e=>e.classList.contains('locked')));
 // Camera failure stays locked and offers retry; leaving stops the camera.
 await start();await page.evaluate(()=>{window.realGetUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async()=>{throw Error('denied')};});await scan();await page.waitForFunction(()=>!document.getElementById('ocrCameraRetry').hidden);await locked();
 await page.evaluate(()=>navigator.mediaDevices.getUserMedia=window.realGetUserMedia);await page.locator('#ocrCameraRetry').click();await ready();
 await page.evaluate(()=>{window.savedTrack=document.getElementById('ocrVideo').srcObject.getVideoTracks()[0];window.dispatchEvent(new Event('pagehide'));});await closed();assert.equal(await page.evaluate(()=>savedTrack.readyState),'ended');await locked();
 // Self-confirmation is explicit, per box, and never inferred from opening the panel.
 await start('80','100');await scan();await ready();
 await page.locator('#manualQtyBtn').click();await locked();
 assert.match(await page.locator('#manualQtyText').textContent(),/1箱目.*40個/);
 await page.locator('#manualQtyConfirm').click();await locked();
 assert.equal(await page.locator('#qtyRows .checked').count(),1);
 await page.locator('#manualQtyBtn').click();assert.match(await page.locator('#manualQtyText').textContent(),/2箱目/);
 await page.locator('#manualQtyConfirm').click();assert(!await page.locator('#nextBtn').isDisabled());
 await page.locator('#nextBtn').click();assert.equal(await page.locator('#workTitle').textContent(),'部品を確認');
 // Excluded and shortage are separate, and returning to an excluded item doesn't repeat completed items.
 await page.locator('#excludeBtn').click();assert(await page.locator('#finish').evaluate(e=>e.classList.contains('on')));
 assert.match(await page.locator('#finishCount').textContent(),/1部品 確認済み.*出庫不要 1件.*在庫不足 0件/);
 await page.locator('#excludedList button').click();await scan('C00000050');await ready();
 await page.locator('#manualQtyBtn').click();await page.locator('#manualQtyConfirm').click();
 await page.locator('#manualQtyBtn').click();await page.locator('#manualQtyConfirm').click();
 await page.locator('#nextBtn').click();assert.match(await page.locator('#finishCount').textContent(),/2部品 確認済み.*出庫不要 0件/);
 await start();await page.locator('#missBtn').click();await scan('C00000050');await ready();
 await page.locator('#manualQtyBtn').click();await page.locator('#manualQtyConfirm').click();await page.locator('#nextBtn').click();
 assert.match(await page.locator('#finishTitle').textContent(),/在庫不足/);
 await page.locator('#missList button').click();await scan();await ready();await page.locator('#manualQtyBtn').click();await page.locator('#manualQtyConfirm').click();await page.locator('#nextBtn').click();
 assert(await page.locator('#finish').evaluate(e=>e.classList.contains('on')));assert.match(await page.locator('#finishCount').textContent(),/2部品 確認済み.*在庫不足 0件/);
 assert.deepEqual(errors,[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 console.log('PASS: barcode gate, 39/40 mismatch, unreadable, two live-frame agreement, per-box checks, no manual OCR acceptance; separate self-confirmation, cancel/redo invalidation, next-item reset, missing target, manual code + name gate, denied camera retry, pagehide cleanup, mobile width');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();server.close();});
