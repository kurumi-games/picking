// Synthetic regression cases; optionally replay an exported JSON with real Tesseract 5.1.1.
// QUANTITY_TEST_FILE=/path/to/export.json TESSDATA_DIR=/path/to/4.0.0_best_int node tests/quantity-ocr-browser.cjs
// User photos stay local and are not fixtures in this repository.
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');let browser,worker;
const server=http.createServer((req,res)=>{
 const p=path.resolve(root,'.'+req.url.split('?')[0]);if(!p.startsWith(root+path.sep))return res.writeHead(403).end();
 fs.readFile(p,(err,data)=>{if(err)return res.writeHead(404).end();res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':'text/html');
  if(p.endsWith('qty-read-test.js'))data=data.toString().replace('position();refresh()', 'window.QtyTest={preprocess,qualify,choosePrediction,expectedDigitCount,recognizeVariant};position();refresh()');
  res.end(data);
 });
});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']});
 const page=await browser.newPage();await page.route('https://**/*',r=>r.abort());await page.goto('http://127.0.0.1:'+server.address().port+'/qty-read-test.html');
 const synthetic=await page.evaluate(()=>{
  const cases=[];
  for(const font of ['bold 140px sans-serif','italic bold 140px sans-serif','bold 140px serif'])for(const value of ['10','11','101','0','1234567']){
   const c=document.createElement('canvas');c.width=900;c.height=260;const x=c.getContext('2d');x.fillStyle='black';x.fillRect(0,0,c.width,c.height);x.save();x.scale(.6,1);x.fillStyle='#ffbe45';x.font=font;x.fillText(value,100,200);x.restore();
   // Add a border and a much shorter unit label; neither may add a digit.
   x.strokeStyle='#ffbe45';x.lineWidth=2;x.strokeRect(10,10,870,240);x.font='20px sans-serif';x.fillStyle='#ffbe45';x.fillText('pcs',650,215);
   const v=QtyTest.preprocess(c,'yellow'),q=QtyTest.qualify({rawText:value,value:String(Number(value)),confidence:90,estimatedDigits:v.estimatedDigits,glyphs:v.glyphs});
   cases.push({font,value,count:v.estimatedDigits,result:q.value,accepted:q.accepted,seven:v.glyphs.some((g,i)=>value[i]==='1'&&g.looksSeven)});
  }
  const c=document.createElement('canvas');c.width=400;c.height=260;const x=c.getContext('2d');x.fillStyle='black';x.fillRect(0,0,400,260);x.strokeStyle='#ffbe45';x.lineWidth=30;x.beginPath();x.moveTo(90,60);x.lineTo(155,60);x.stroke();x.lineWidth=18;x.beginPath();x.moveTo(155,60);x.lineTo(108,215);x.stroke();
  const v=QtyTest.preprocess(c,'yellow'),seven=QtyTest.qualify({rawText:'1',value:'1',confidence:90,estimatedDigits:v.estimatedDigits,glyphs:v.glyphs});
  const zeros=QtyTest.qualify({rawText:'00',value:'0',confidence:90,estimatedDigits:2});
  return {cases,seven,zeros};
 });
 for(const c of synthetic.cases){assert.equal(c.count,c.value.length,JSON.stringify(c));assert(c.accepted,JSON.stringify(c));assert.equal(c.result,String(Number(c.value)),JSON.stringify(c));assert(!c.seven,JSON.stringify(c));}
 assert.equal(synthetic.seven.value,'7');assert(synthetic.seven.accepted);assert(synthetic.zeros.accepted);assert.equal(synthetic.zeros.value,'0');
 console.log('PASS: borders/short units excluded, 1–7 digits, regular/italic/serif ones preserved, geometric 7 correction, leading zero digit count');
 if(process.env.QUANTITY_TEST_FILE){
  const Tesseract=require(process.env.TESSERACT_MODULE||'tesseract.js');
  worker=await Tesseract.createWorker('eng',1,{...(process.env.TESSDATA_DIR?{langPath:process.env.TESSDATA_DIR}:{}),cachePath:process.env.TESS_CACHE_DIR||'/tmp/quantity-ocr-test'});
  await worker.setParameters({tessedit_char_whitelist:'0123456789',user_defined_dpi:'300'});
  await page.exposeFunction('recognizeFixture',async ({url,psm})=>{await worker.setParameters({tessedit_pageseg_mode:psm});const {data}=await worker.recognize(Buffer.from(url.split(',')[1],'base64'));return {data:{text:data.text,confidence:data.confidence}};});
  const records=JSON.parse(fs.readFileSync(process.env.QUANTITY_TEST_FILE,'utf8')).records;let checked=0,unlabelled=0,unlabelledAnswers=0;
  for(const record of records){
   const result=await page.evaluate(async url=>{
    const img=new Image();img.src=url;await img.decode();const c=document.createElement('canvas');c.width=img.width;c.height=img.height;c.getContext('2d').drawImage(img,0,0);
    const variants=['yellow','dark','bright'].map(m=>QtyTest.preprocess(c,m)),expected=QtyTest.expectedDigitCount(variants),candidates=[];let psm='7';
    const w={setParameters:async p=>{psm=p.tessedit_pageseg_mode;},recognize:async image=>recognizeFixture({url:image.toDataURL(),psm})};
    for(const v of variants)candidates.push(await QtyTest.recognizeVariant(w,v,expected));return QtyTest.choosePrediction(candidates);
   },record.images.crop);
   if(record.actual!==null&&record.actual!==undefined){assert.equal(result.predicted,String(Number(record.actual)),record.id);checked++;}
   else{unlabelled++;if(result.predicted!==null)unlabelledAnswers++;}
  }
  console.log(`PASS: ${checked} labelled images matched; ${unlabelled} unlabelled images replayed (${unlabelledAnswers} answers, not scored)`);
 }
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await worker?.terminate();await browser?.close();server.close();});
