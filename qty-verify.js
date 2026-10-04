/* Camera verification: only two matching live reads can pass OCR. Self-confirmation is a separate picking action. */
(()=>{
'use strict';
const $=id=>document.getElementById(id),roi={x:.5,y:.5,w:.52,h:.25};
let session=null,stream=null,epoch=0,busy=false,returnFocus=null,oldOverflow='';
function stopStream(){if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;$('ocrVideo').srcObject=null;}
function position(){
 roi.w=Number($('ocrWidth').value)/100;roi.h=Number($('ocrHeight').value)/100;
 roi.x=Math.max(roi.w/2,Math.min(1-roi.w/2,roi.x));roi.y=Math.max(roi.h/2,Math.min(1-roi.h/2,roi.y));
 Object.assign($('ocrFrame').style,{left:(roi.x-roi.w/2)*100+'%',top:(roi.y-roi.h/2)*100+'%',width:roi.w*100+'%',height:roi.h*100+'%'});
}
function setBusy(value){
 busy=value;for(const id of ['ocrWidth','ocrHeight'])$(id).disabled=value;
 $('ocrShoot').disabled=value||!stream||!session||session.passed;
 $('ocrShoot').textContent=value?'個数を確認中…':'枠の中を読む';
}
function close(){
 const previous=session;
 epoch++;stopStream();session=null;setBusy(false);
 if($('ocrModal').classList.contains('on')){
  $('ocrModal').classList.remove('on');if(!previous?.inline)document.body.style.overflow=oldOverflow;
  if(!previous?.inline && returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
 }
 previous?.onClose?.();
}
async function startCamera(){
 if(!session)return;
 const token=++epoch;stopStream();setBusy(true);$('ocrCameraRetry').hidden=true;
 $('ocrStatus').textContent='カメラを準備中…';
 try{
  if(!navigator.mediaDevices?.getUserMedia)throw new Error('カメラを利用できません');
  const s=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1920},height:{ideal:1080}}});
  if(token!==epoch){s.getTracks().forEach(t=>t.stop());return;}
  stream=s;$('ocrVideo').srcObject=s;await $('ocrVideo').play();
  if(token!==epoch)return;
  $('ocrStage').style.width=`min(100%, calc(38dvh * ${$('ocrVideo').videoWidth/$('ocrVideo').videoHeight}))`;
  $('ocrStatus').textContent='数字を枠に合わせて「枠の中を読む」。2回続けて必要数と一致すると確認完了です。';
 }catch(e){
  if(token!==epoch)return;
  stopStream();$('ocrStatus').textContent='カメラを開けませんでした。カメラの許可を確認して再開してください。';$('ocrCameraRetry').hidden=false;
 }finally{if(token===epoch)setBusy(false);}
}
function open(options){
 close();if(!/^\d{1,7}$/.test(options.expected))return;
 session={...options,passed:false};returnFocus=document.activeElement;oldOverflow=document.body.style.overflow;if(!options.inline)document.body.style.overflow='hidden';
 $('ocrPart').textContent=options.code;$('ocrTarget').textContent=options.expected;$('ocrBatch').textContent=options.batch;
 $('ocrResult').textContent='—';$('ocrResult').className='ocr-result';
 $('ocrModal').classList.add('on');position();if(!options.inline)$('ocrCancel').focus();startCamera();
}
function capture(){
 const video=$('ocrVideo'),w=video.videoWidth,h=video.videoHeight;
 if(!w||!h||video.readyState<2||video.paused||!stream?.getVideoTracks().some(t=>t.readyState==='live'))throw new Error('映像が停止しています。カメラを再開してください。');
 const x=Math.round((roi.x-roi.w/2)*w),y=Math.round((roi.y-roi.h/2)*h);
 const c=document.createElement('canvas');c.width=Math.max(1,Math.min(w-x,Math.round(roi.w*w)));c.height=Math.max(1,Math.min(h-y,Math.round(roi.h*h)));
 c.getContext('2d').drawImage(video,x,y,c.width,c.height,0,0,c.width,c.height);return c;
}
function showFailure(result,expected){
 $('ocrResult').className='ocr-result ng';$('ocrResult').textContent=result.predicted===null?'読取できず':result.predicted+' 個';
 $('ocrStatus').textContent=result.predicted!==null?`必要数は${expected}個です。表示が違うため次へ進めません。個数と枠の位置を確認して、もう一度読み取ってください。`:result.rejection==='clipped-digit'?'数字が枠の端で切れています。枠を少し広げて、もう一度読み取ってください。':'数字を確定できませんでした。個数の数字だけが入るように枠を合わせ直してください。';
}
$('ocrShoot').onclick=async()=>{
 if(busy||!session||session.passed||!stream)return;
 const active=session,token=epoch;setBusy(true);
 $('ocrResult').textContent='—';$('ocrResult').className='ocr-result';$('ocrStatus').textContent='数字を読み取り中…';
 try{
  if(!window.QuantityOcr)throw new Error('読取機能を読み込めません。ネット接続を確認して開き直してください。');
  const first=await QuantityOcr.read(capture());
  if(token!==epoch||session!==active)return;
  if(first.predicted!==active.expected){showFailure(first,active.expected);return;}
  $('ocrResult').textContent=first.predicted+' 個';$('ocrStatus').textContent='1回目は一致。そのまま計量器を映してください…';
  // Capture a new live frame, never run the same still image twice.
  const before=$('ocrVideo').currentTime;await new Promise(resolve=>setTimeout(resolve,350));
  if(token!==epoch||session!==active)return;
  if($('ocrVideo').currentTime<=before)throw new Error('映像の更新を確認できませんでした。もう一度読み取ってください。');
  const second=await QuantityOcr.read(capture());
  if(token!==epoch||session!==active)return;
  if(second.predicted!==active.expected){showFailure(second,active.expected);return;}
  active.passed=true;stopStream();$('ocrResult').className='ocr-result ok';$('ocrResult').textContent='✓ '+second.predicted+' 個';
  $('ocrStatus').textContent='2回連続で一致しました。個数確認完了！';
  active.onMatch({value:second.predicted});
  setTimeout(()=>{if(token===epoch&&session===active)close();},750);
 }catch(e){
  if(token!==epoch||session!==active)return;
  $('ocrResult').textContent='読取できず';$('ocrResult').className='ocr-result ng';
  $('ocrStatus').textContent='個数を確認できませんでした。'+String(e.message||e);
 }finally{if(token===epoch&&session===active)setBusy(false);}
};
$('ocrCancel').onclick=close;$('ocrCameraRetry').onclick=startCamera;
$('ocrWidth').oninput=$('ocrHeight').oninput=position;
$('ocrStage').onclick=e=>{if(busy||!stream||session?.passed)return;const r=$('ocrStage').getBoundingClientRect();roi.x=(e.clientX-r.left)/r.width;roi.y=(e.clientY-r.top)/r.height;position();};
document.addEventListener('keydown',e=>{
 if(!session)return;if(e.key==='Escape'){close();return;}
 if(e.key==='Tab' && !session.inline){
  const buttons=[...$('ocrModal').querySelectorAll('button,input')].filter(el=>!el.disabled&&!el.hidden);
  const first=buttons[0],last=buttons.at(-1);
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
 }
});
document.addEventListener('visibilitychange',()=>{
 if(!document.hidden||!session)return;
 if(session.passed){close();return;}
 epoch++;stopStream();setBusy(false);$('ocrResult').textContent='—';$('ocrCameraRetry').hidden=false;
 $('ocrStatus').textContent='カメラを停止しました。「カメラを再開」して個数を読み取ってください。';
});
addEventListener('pagehide',close);
window.QuantityVerifier=Object.freeze({open,close});
})();
