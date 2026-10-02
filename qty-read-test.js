/* Isolated evaluation tool. Never reads or writes the picking DB or auto-accepts a quantity. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),VERSION='70',ENGINE='tesseract.js 5.1.1 / eng LSTM',DB='pickingQtyReadTests_v1';
let stream=null,source=null,busy=false,current=null,workerPromise=null,epoch=0,saving=false,records=[];
const roi={x:.5,y:.5,w:.6,h:.25};
const dbPromise=new Promise((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>req.result.createObjectStore('reads',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
function errorText(e){return String(e?.message||e||'不明なエラー');}
async function store(record){const db=await dbPromise;return new Promise((resolve,reject)=>{const tx=db.transaction('reads','readwrite');tx.objectStore('reads').put(record);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('保存を中断しました'));});}
async function list(){const db=await dbPromise;return new Promise((resolve,reject)=>{const req=db.transaction('reads').objectStore('reads').getAll();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function refresh(){
 records=(await list()).sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt));
 const yes=records.filter(r=>r.verdict==='correct').length,no=records.filter(r=>r.verdict==='incorrect').length;
 $('summary').textContent=`${records.length}件保存／正解 ${yes}件・不正解 ${no}件・未採点 ${records.length-yes-no}件`;
 $('export').disabled=!records.length;$('share').disabled=!records.length;
 $('history').replaceChildren();for(const r of records.slice(0,8)){const li=document.createElement('li');li.textContent=`${new Date(r.capturedAt).toLocaleTimeString('ja-JP')}　回答 ${r.predicted??'読取不可'} → ${r.actual??'未採点'} ${r.verdict==='correct'?'○':r.verdict==='incorrect'?'×':''}`;$('history').append(li);}
}
function setBusy(value){busy=value;for(const id of ['camera','photo','width','height'])$(id).disabled=value;$('read').disabled=value||!source;$('read').textContent=value?'読み取り中…':'枠の中を読む';}
function position(){roi.w=Number($('width').value)/100;roi.h=Number($('height').value)/100;roi.x=Math.max(roi.w/2,Math.min(1-roi.w/2,roi.x));roi.y=Math.max(roi.h/2,Math.min(1-roi.h/2,roi.y));Object.assign($('roi').style,{left:(roi.x-roi.w/2)*100+'%',top:(roi.y-roi.h/2)*100+'%',width:roi.w*100+'%',height:roi.h*100+'%'});}
$('width').oninput=$('height').oninput=position;
$('stage').onclick=e=>{if(!source||busy)return;const b=$('stage').getBoundingClientRect();roi.x=(e.clientX-b.left)/b.width;roi.y=(e.clientY-b.top)/b.height;position();};
function stopCamera(){epoch++;if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;if(source===$('video')){source=null;$('read').disabled=true;}$('camera').textContent='カメラを開く';}
function showSource(el){source=el;$('video').hidden=el!==$('video');$('photoView').hidden=el!==$('photoView');$('placeholder').hidden=true;$('roi').hidden=false;position();$('read').disabled=busy;}
$('camera').onclick=async()=>{
 if(stream){stopCamera();$('status').textContent='カメラを停止しました。再開するときは「カメラを開く」。';return;}
 const token=++epoch;$('camera').disabled=true;
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('このブラウザではカメラを利用できません。写真で試してください。');
  const s=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});
  if(token!==epoch){s.getTracks().forEach(t=>t.stop());return;}stream=s;$('video').srcObject=s;await $('video').play();
  if(token!==epoch)return;showSource($('video'));$('camera').textContent='カメラを止める';$('status').textContent='個数の数字だけを緑の枠に入れてください。';
 }catch(e){stopCamera();$('status').textContent='カメラを開けませんでした。許可を確認するか、写真で試してください。 '+errorText(e);}
 finally{$('camera').disabled=busy;}
};
$('photo').onchange=async()=>{
 const file=$('photo').files[0];if(!file)return;stopCamera();const url=URL.createObjectURL(file);
 try{$('photoView').src=url;await $('photoView').decode();showSource($('photoView'));$('status').textContent='個数欄をタップし、枠の大きさを合わせてください。';}
 catch(e){$('status').textContent='写真を開けませんでした。別の写真で試してください。';}finally{URL.revokeObjectURL(url);$('photo').value='';}
};
function canvas(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));return c;}
function capture(){
 const w=source.videoWidth||source.naturalWidth,h=source.videoHeight||source.naturalHeight;if(!w||!h)throw new Error('映像の準備ができていません。');
 const x=Math.round((roi.x-roi.w/2)*w),y=Math.round((roi.y-roi.h/2)*h),cw=Math.max(1,Math.min(w-x,Math.round(roi.w*w))),ch=Math.max(1,Math.min(h-y,Math.round(roi.h*h)));
 const crop=canvas(cw,ch);crop.getContext('2d').drawImage(source,x,y,cw,ch,0,0,cw,ch);
 const scale=Math.min(1,1280/Math.max(w,h)),frame=canvas(w*scale,h*scale);frame.getContext('2d').drawImage(source,0,0,frame.width,frame.height);
 return {crop,frame:frame.toDataURL('image/jpeg',.8),region:{x,y,width:cw,height:ch,sourceWidth:w,sourceHeight:h}};
}
function isolateDigits(binary,method){
 const ctx=binary.getContext('2d'),w=binary.width,h=binary.height,d=ctx.getImageData(0,0,w,h).data;
 const labels=new Int32Array(w*h),components=[];let nextLabel=0;
 for(let start=0;start<w*h;start++){
  if(labels[start]||d[start*4]>=96)continue;
  const id=++nextLabel,stack=[start];let area=0,minX=w,minY=h,maxX=0,maxY=0;labels[start]=id;
  while(stack.length){
   const p=stack.pop(),x=p%w,y=(p-x)/w;area++;minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const nx=x+dx,ny=y+dy;if(nx<0||nx>=w||ny<0||ny>=h)continue;const n=ny*w+nx;
    if(!labels[n]&&d[n*4]<96){labels[n]=id;stack.push(n);}
   }
  }
  if(area>=18)components.push({id,x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1,area});
 }
 // Select a row of similarly sized glyphs, not the largest background/border.
 // Unit labels are shorter; frame lines are too thin, sparse, or touch the ROI edge.
 // A small bridge between two glyphs must not turn two digits into one.
 const separated=components.flatMap(c=>{
  if(c.w/c.h<.68||c.w/c.h>1.6)return [c];
  let cut=-1,best=c.h;
  for(let x=c.x+Math.ceil(c.h*.2);x<c.x+c.w-c.h*.2;x++){
   let ink=0;for(let y=c.y;y<c.y+c.h;y++)if(labels[y*w+x]===c.id)ink++;
   if(ink<best){best=ink;cut=x;}
  }
  if(cut<0||best>c.h*.09)return [c];
  const parts=[[c.x,cut],[cut,c.x+c.w]].map(([left,right])=>{
   let top=h,bottom=0,area=0;for(let y=c.y;y<c.y+c.h;y++)for(let x=left;x<right;x++)if(labels[y*w+x]===c.id){top=Math.min(top,y);bottom=Math.max(bottom,y);area++;}
   return {...c,x:left,y:top,w:right-left,h:bottom-top+1,area};
  });
  return parts.every(p=>p.h>=c.h*.8)?parts:[c];
 });
 const clipped=separated.some(c=>c.h>h*.3&&c.w/c.h>=.15&&c.w/c.h<=1.35&&c.area/(c.w*c.h)>.18&&
  (c.x===0||c.y===0||c.x+c.w===w||c.y+c.h===h));
 const usable=separated.filter(c=>{
  const ratio=c.w/c.h,fill=c.area/(c.w*c.h);
  return c.h>=Math.max(14,h*.12)&&ratio>=.09&&ratio<=1.35&&fill>=.16&&fill<=.94&&
   c.x>0&&c.y>0&&c.x+c.w<w&&c.y+c.h<h;
 });
 const rows=[];
 for(const seed of usable){
  const aligned=usable.filter(c=>c.h>=seed.h*.72&&c.h<=seed.h*1.38&&Math.abs(c.y+c.h/2-seed.y-seed.h/2)<seed.h*.23).sort((a,b)=>a.x-b.x);
  let group=[];
  for(const c of aligned){
   if(group.length&&c.x-(group.at(-1).x+group.at(-1).w)>seed.h*.65){rows.push(group);group=[];}
   group.push(c);
  }
  if(group.length)rows.push(group);
 }
 rows.sort((a,b)=>b.reduce((s,c)=>s+c.area,0)-a.reduce((s,c)=>s+c.area,0));
 const digits=rows[0]||[],ids=new Set(digits.map(c=>c.id));
 const other=rows.find(row=>row.every(c=>!ids.has(c.id))&&row.some(c=>c.h>=Math.max(...digits.map(g=>g.h))*.7));
 const ambiguous=!!other&&other.reduce((s,c)=>s+c.area,0)>digits.reduce((s,c)=>s+c.area,0)*.4;
 const empty=()=>{const out=canvas(80,80),o=out.getContext('2d');o.fillStyle='white';o.fillRect(0,0,80,80);return {image:out,estimatedDigits:0,components:components.length,method,glyphs:[],ambiguous,clipped};};
 if(!digits.length||digits.length>7||ambiguous||clipped)return empty();
 const minX=Math.min(...digits.map(c=>c.x)),minY=Math.min(...digits.map(c=>c.y)),maxX=Math.max(...digits.map(c=>c.x+c.w)),maxY=Math.max(...digits.map(c=>c.y+c.h));
 const clean=canvas(maxX-minX,maxY-minY),cc=clean.getContext('2d'),im=cc.createImageData(clean.width,clean.height);im.data.fill(255);
 for(let y=minY;y<maxY;y++)for(let x=minX;x<maxX;x++)if(ids.has(labels[y*w+x])){const i=((y-minY)*clean.width+x-minX)*4;im.data[i]=im.data[i+1]=im.data[i+2]=0;}
 cc.putImageData(im,0,0);
 const median=values=>{values.sort((a,b)=>a-b);return values.length?values[Math.floor(values.length/2)]:0;};
 const glyphs=digits.map(c=>{
  const band=(lo,hi)=>{const widths=[],centres=[];for(let y=c.y+Math.floor(c.h*lo);y<c.y+Math.ceil(c.h*hi);y++){
   let left=w,right=-1;for(let x=c.x;x<c.x+c.w;x++)if(labels[y*w+x]===c.id){left=Math.min(left,x);right=x;}
   if(right>=left){widths.push((right-left+1)/c.w);centres.push(((left+right)/2-c.x)/c.w);}
  }return {width:median(widths),centre:median(centres)};};
  const top=band(.06,.2),mid=band(.3,.45),low=band(.72,.88),foot=band(.9,.98),ratio=c.w/c.h;
  const looksSeven=ratio>.28&&ratio<.7&&top.width>.72&&mid.width<.52&&low.width<.55&&foot.width<.55&&mid.centre-low.centre>.14;
  return {x:c.x,y:c.y,width:c.w,height:c.h,looksSeven,top,mid,low,foot};
 });
 const scale=Math.min(4,190/clean.height),out=canvas(clean.width*scale*1.6+48,clean.height*scale+48),o=out.getContext('2d');
 o.fillStyle='white';o.fillRect(0,0,out.width,out.height);o.imageSmoothingEnabled=false;o.drawImage(clean,24,24,clean.width*scale*1.6,clean.height*scale);
 return {image:out,estimatedDigits:digits.length,components:components.length,method,glyphs,ambiguous:false,clipped:false};
}
function preprocess(crop,method){
 const scale=Math.min(3,Math.max(.45,260/crop.height)),small=canvas(crop.width*scale,crop.height*scale),ctx=small.getContext('2d');ctx.drawImage(crop,0,0,small.width,small.height);
 const im=ctx.getImageData(0,0,small.width,small.height),d=im.data;
 let sum=0;for(let i=0;i<d.length;i+=4)sum+=.299*d[i]+.587*d[i+1]+.114*d[i+2];const avg=sum/(d.length/4);
 for(let i=0;i<d.length;i+=4){const r=d[i],g=d[i+1],b=d[i+2];let v;
  const lum=.299*r+.587*g+.114*b;
  if(method==='yellow')v=((r>70&&g>55&&Math.min(r,g)-b>22&&r/g>.55&&r/g<2.15)||(r>95&&g>25&&r>g*1.9&&r>b*1.8))?0:255;
  else if(method==='dark')v=lum<avg*.82?0:255;
  else v=lum>Math.min(245,avg*1.22+18)?0:255;
  d[i]=d[i+1]=d[i+2]=v;
 }ctx.putImageData(im,0,0);
 return isolateDigits(small,method);
}
function parse(text){const groups=String(text??'').match(/\d+/g)||[];if(groups.length!==1||!/^\d{1,7}$/.test(groups[0]))return null;return String(Number(groups[0]));}
function qualify(candidate){
 if(candidate.clipped){candidate.accepted=false;candidate.rejectReason='clipped-digit';return candidate;}
 if(candidate.value===null){candidate.accepted=false;candidate.rejectReason=String(candidate.rawText??'').match(/\d+/g)?.length>1?'multiple-number-groups':'no-number';return candidate;}
 if(candidate.ambiguous||!candidate.estimatedDigits){candidate.accepted=false;candidate.rejectReason=candidate.ambiguous?'multiple-number-regions':'no-digit-region';return candidate;}
 const expected=candidate.expectedDigits||candidate.estimatedDigits;
 const rawDigits=String(candidate.rawText).match(/\d+/)?.[0]||'';
 if(rawDigits.length!==expected){candidate.accepted=false;candidate.rejectReason='digit-count-mismatch';return candidate;}
 if(candidate.confidence<25){candidate.accepted=false;candidate.rejectReason='low-confidence';return candidate;}
 candidate.shapeCorrections=[];
 if(candidate.glyphs?.length===rawDigits.length){
  const chars=rawDigits.split('');
  candidate.glyphs.forEach((g,i)=>{if(chars[i]==='1'&&g.looksSeven){chars[i]='7';candidate.shapeCorrections.push({index:i,from:'1',to:'7'});}});
  candidate.value=String(Number(chars.join('')));
 }
 candidate.accepted=true;candidate.rejectReason=null;return candidate;
}
function choosePrediction(candidates){
 const accepted=candidates.filter(c=>c.accepted);
 if(!accepted.length)return {predicted:null,agreement:false,rejection:candidates.find(c=>c.method!=='dark'&&c.rejectReason==='clipped-digit')?.rejectReason||candidates.find(c=>c.rejectReason==='digit-count-mismatch')?.rejectReason||candidates.find(c=>c.rejectReason)?.rejectReason||'no-number'};
 const byValue=new Map();
 for(const c of accepted){const prev=byValue.get(c.value)||{value:c.value,count:0,bestConfidence:-1};prev.count++;prev.bestConfidence=Math.max(prev.bestConfidence,c.confidence||0);byValue.set(c.value,prev);}
 const ranked=[...byValue.values()].sort((a,b)=>b.count-a.count||b.bestConfidence-a.bestConfidence);
 return {predicted:ranked[0].value,agreement:ranked[0].count>=2,rejection:null};
}
function expectedDigitCount(variants){
 // Only compare aligned foreground rows. The dark mask often sees the digit's
 // holes or the background, so it must never impose a count on a display.
 const rows=variants.filter(v=>v.method!=='dark'&&v.estimatedDigits&&v.glyphs.length);
 if(!rows.length)return 0;
 const anchor=rows.reduce((a,b)=>a.estimatedDigits>=b.estimatedDigits?a:b);
 const cy=v=>v.glyphs.reduce((sum,g)=>sum+g.y+g.height/2,0)/v.glyphs.length;
 const height=v=>v.glyphs.reduce((sum,g)=>sum+g.height,0)/v.glyphs.length;
 if(rows.some(v=>Math.abs(cy(v)-cy(anchor))>height(anchor)*.25))return 0;
 return anchor.estimatedDigits;
}
async function recognizeVariant(worker,v,expectedDigits){
 const attempts=[];
 const attempt=async psm=>{
  await worker.setParameters({tessedit_pageseg_mode:psm});
  const {data}=await worker.recognize(v.image);
  const c=qualify({method:v.method,rawText:data.text,value:parse(data.text),confidence:data.confidence,estimatedDigits:v.estimatedDigits,expectedDigits,componentCount:v.components,glyphs:v.glyphs,ambiguous:v.ambiguous,clipped:v.clipped,psm});
  attempts.push({psm,rawText:c.rawText,confidence:c.confidence,rejectReason:c.rejectReason});return c;
 };
 if(!v.estimatedDigits)return qualify({method:v.method,rawText:'',value:null,confidence:0,estimatedDigits:0,expectedDigits,componentCount:v.components,glyphs:v.glyphs,ambiguous:v.ambiguous,clipped:v.clipped,attempts});
 let c=await attempt('7');
 if(!c.accepted){const fallback=await attempt('8');if(fallback.accepted)c=fallback;}
 return {...c,attempts};
}
function getWorker(){
 if(!workerPromise){workerPromise=(async()=>{
  if(!window.Tesseract)throw new Error('読取機能を読み込めません。ネット接続を確認して、このページを開き直してください。');
  const w=await Tesseract.createWorker('eng',1,{logger:m=>{if(busy&&m.status)$('status').textContent=m.status==='recognizing text'?'数字を読み取り中…':'読取機能を準備中…';}});
  await w.setParameters({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:'7',user_defined_dpi:'300'});return w;
 })().catch(e=>{workerPromise=null;throw e;});}return workerPromise;
}
function renderAnswer(){
 $('answer').hidden=false;$('number').textContent=current.predicted??'読取できず';$('number').style.fontSize=current.predicted?'64px':'34px';
 $('detail').textContent=current.agreement?'複数の画像処理で回答が一致しました（正解の保証ではありません）。':current.predicted?'画像処理によって回答が異なります。表示をよく確認してください。':current.rejection==='clipped-digit'?'数字が枠の端で切れている可能性があります。少し枠を広げて撮り直してください。':current.rejection==='digit-count-mismatch'?'画像の数字の数と読取結果の桁数が合わないため、回答として採用しませんでした。不正解から正しい個数を教えてください。':'数字を確定できませんでした。不正解から正しい個数を教えてください。';
 $('cropPreview').src=current.images.crop;$('grade').hidden=false;$('correct').disabled=current.predicted===null;$('incorrect').disabled=false;$('correction').hidden=true;$('actual').value='';$('feedback').textContent='';
}
$('read').onclick=async()=>{
 if(busy||saving||!source)return;
 if(current?.verdict==='unreviewed'&&!confirm('前の結果は未採点です。未採点のまま次を読みますか？'))return;
 setBusy(true);$('answer').hidden=true;current=null;
 try{
  const shot=capture(),sourceType=source===$('video')?'camera':'photo',cameraSettings=stream?.getVideoTracks()[0]?.getSettings()||null,started=performance.now(),capturedAt=new Date().toISOString(),variants=['yellow','dark','bright'].map(method=>preprocess(shot.crop,method)),expectedDigits=expectedDigitCount(variants),w=await getWorker(),candidates=[];
  for(const v of variants)candidates.push(await recognizeVariant(w,v,expectedDigits));
  const picked=choosePrediction(candidates);
  current={id:crypto.randomUUID(),schemaVersion:1,appVersion:VERSION,engine:ENGINE,capturedAt,source:sourceType,region:shot.region,frameImageMaxSide:1280,roi:{...roi},cameraSettings,userAgent:navigator.userAgent,elapsedMs:Math.round(performance.now()-started),candidates,predicted:picked.predicted,agreement:picked.agreement,rejection:picked.rejection,verdict:'unreviewed',actual:null,images:{frame:shot.frame,crop:shot.crop.toDataURL('image/jpeg',.9),yellow:variants[0].image.toDataURL('image/png'),dark:variants[1].image.toDataURL('image/png'),inverted:variants[2].image.toDataURL('image/png')}};
  await store(current);await refresh();renderAnswer();$('status').textContent='読み取り完了。結果を採点してください。';$('answer').scrollIntoView({behavior:'smooth',block:'nearest'});
 }catch(e){current=null;$('answer').hidden=true;$('status').textContent='読み取り・保存が完了しませんでした。 '+errorText(e);}
 finally{setBusy(false);}
};
async function grade(verdict,actual){
 if(!current||current.verdict!=='unreviewed'||saving)return;saving=true;$('correct').disabled=$('incorrect').disabled=true;$('correction').querySelector('button').disabled=true;$('read').disabled=true;
 try{const updated={...current,verdict,actual,reviewedAt:new Date().toISOString()};await store(updated);current=updated;await refresh();$('grade').hidden=true;$('correction').hidden=true;$('feedback').textContent='記録しました。次の個数を試せます。';}
 catch(e){$('feedback').textContent='保存できませんでした。再度押してください。 '+errorText(e);$('correct').disabled=current.predicted===null;$('incorrect').disabled=false;}
 finally{saving=false;$('correction').querySelector('button').disabled=false;$('read').disabled=busy||!source;}
}
$('correct').onclick=()=>{if(current?.predicted!==null)grade('correct',current.predicted);};
$('incorrect').onclick=()=>{$('correction').hidden=false;$('actual').focus();};
$('correction').onsubmit=e=>{e.preventDefault();const actual=parse($('actual').value);if(actual===null){$('feedback').textContent='正しい個数を半角数字で入力してください。';return;}if(actual===current.predicted){$('feedback').textContent='アプリの回答と同じ個数です。合っていれば「正解」を押してください。';return;}grade('incorrect',actual);};
async function exportFile(){const all=await list();return new File([JSON.stringify({schema:'picking-quantity-read-tests',schemaVersion:1,exportedAt:new Date().toISOString(),appVersion:VERSION,records:all},null,2)],'quantity-read-tests-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',{type:'application/json'});}
$('export').onclick=async()=>{try{const f=await exportFile(),url=URL.createObjectURL(f),a=document.createElement('a');a.href=url;a.download=f.name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);$('status').textContent='画像つき記録を書き出しました。このJSONをチャットに添付してください。';}catch(e){$('status').textContent='書き出せませんでした。 '+errorText(e);}};
if(navigator.share&&navigator.canShare)$('share').style.display='block';
$('share').onclick=async()=>{try{const f=await exportFile();if(!navigator.canShare({files:[f]})){$('status').textContent='この端末ではファイル共有できません。「記録をダウンロード」を使ってください。';return;}await navigator.share({files:[f],title:'個数読取テスト記録'});}catch(e){if(e.name!=='AbortError')$('status').textContent='共有できませんでした。「記録をダウンロード」を使ってください。';}};
addEventListener('pagehide',()=>{stopCamera();if(workerPromise)workerPromise.then(w=>w.terminate()).catch(()=>{});workerPromise=null;});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopCamera();});
position();refresh().catch(e=>{$('status').textContent='記録用の保存領域を開けません。ブラウザの保存設定を確認してください。 '+errorText(e);});
})();
