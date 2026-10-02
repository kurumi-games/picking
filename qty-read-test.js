/* Isolated evaluation tool. Never reads or writes the picking DB or auto-accepts a quantity. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),VERSION='71',ENGINE='tesseract.js 5.1.1 / eng LSTM',DB='pickingQtyReadTests_v1';
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
const {parse,preprocess,qualify,choosePrediction,expectedDigitCount,recognizeVariant}=window.QuantityOcr;
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
