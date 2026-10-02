/* Shared quantity OCR. Recognition never receives the expected picking quantity. */
(()=>{
'use strict';
let workerPromise=null,queue=Promise.resolve();
function canvas(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));return c;}
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
 if(!workerPromise)workerPromise=(async()=>{
  if(!window.Tesseract)throw new Error('読取機能を読み込めません。ネット接続を確認して開き直してください。');
  const w=await Tesseract.createWorker('eng',1);
  await w.setParameters({tessedit_char_whitelist:'0123456789',tessedit_pageseg_mode:'7',user_defined_dpi:'300'});
  return w;
 })().catch(e=>{workerPromise=null;throw e;});
 return workerPromise;
}
function read(crop){
 const run=async()=>{
  const variants=['yellow','dark','bright'].map(method=>preprocess(crop,method));
  const expectedDigits=expectedDigitCount(variants),worker=await getWorker(),candidates=[];
  for(const v of variants)candidates.push(await recognizeVariant(worker,v,expectedDigits));
  return {...choosePrediction(candidates),candidates};
 };
 const result=queue.then(run);queue=result.catch(()=>{});return result;
}
window.QuantityOcr=Object.freeze({parse,preprocess,qualify,choosePrediction,expectedDigitCount,recognizeVariant,read});
})();
