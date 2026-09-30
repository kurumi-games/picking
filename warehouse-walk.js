/* Continuous map-based warehouse view. One pallet = two map cells. */
(function(root){
  'use strict';
  const S=2, STEP=.5, R=.45, EYE=5.6;
  function navigation(W,D,blocks){
    const nx=Math.floor(W/STEP),nz=Math.floor(D/STEP),size=nx*nz,free=new Uint8Array(size);
    const point=i=>[(i%nx+.5)*STEP,(Math.floor(i/nx)+.5)*STEP];
    const index=(x,z)=>x>=0&&z>=0&&x<W&&z<D?Math.floor(z/STEP)*nx+Math.floor(x/STEP):-1;
    const blocked=(x,z)=>x<R||z<R||x>W-R||z>D-R||blocks.some(b=>x>b[0]-R&&x<b[2]+R&&z>b[1]-R&&z<b[3]+R);
    for(let i=0;i<size;i++){const p=point(i);free[i]=blocked(...p)?0:1;}
    function neighbors(i,fn){const x=i%nx,z=Math.floor(i/nx);if(x>0&&free[i-1])fn(i-1);if(x<nx-1&&free[i+1])fn(i+1);if(z>0&&free[i-nx])fn(i-nx);if(z<nz-1&&free[i+nx])fn(i+nx);}
    function nearest(x,z,allowed=free){let best=-1,d=Infinity;for(let i=0;i<size;i++){if(!allowed[i])continue;const p=point(i),v=(p[0]-x)**2+(p[1]-z)**2;if(v<d){d=v;best=i;}}return best;}
    function flood(start){const seen=new Uint8Array(size);if(start<0||!free[start])return seen;const q=[start];seen[start]=1;for(let k=0;k<q.length;k++)neighbors(q[k],v=>{if(!seen[v]){seen[v]=1;q.push(v);}});return seen;}
    function path(start,end){if(start<0||end<0||!free[start]||!free[end])return null;const prev=new Int32Array(size).fill(-1),q=[start];prev[start]=start;for(let k=0;k<q.length&&prev[end]<0;k++)neighbors(q[k],v=>{if(prev[v]<0){prev[v]=q[k];q.push(v);}});if(prev[end]<0)return null;const out=[];for(let i=end;i!==start;i=prev[i])out.push(point(i));out.push(point(start));return out.reverse();}
    function approach(c,allowed,x,z){const x1=c.x*S,z1=c.y*S,x2=(c.x+c.w)*S,z2=(c.y+c.h)*S;let best=-1,score=Infinity;for(let i=0;i<size;i++){if(!allowed[i])continue;const p=point(i),dx=Math.max(x1-p[0],0,p[0]-x2),dz=Math.max(z1-p[1],0,p[1]-z2),edge=Math.hypot(dx,dz);if(edge>2.5)continue;const cost=Math.abs(edge-1.4)*20+Math.hypot(p[0]-x,p[1]-z);if(cost<score){score=cost;best=i;}}return best;}
    return {free,point,index,nearest,flood,path,approach,blocked};
  }
  function palletCell(r,x,z,fi){
    const a=Math.min(Math.max(0,Math.floor((x/S-r.x)/2)*2),Math.max(0,Math.ceil(r.w/2)*2-2));
    const b=Math.min(Math.max(0,Math.floor((z/S-r.y)/2)*2),Math.max(0,Math.ceil(r.h/2)*2-2));
    return {f:fi,x:r.x+a,y:r.y+b,w:Math.min(2,r.w-a),h:Math.min(2,r.h-b),s:'r'};
  }
  function create(stage,db,fi,opts={}){
    const T=root.THREE,f=db.maps.floors[fi],world=root.Warehouse3D.createWorld(db,fi,{walk:true});
    const {scene,W,D}=world,nav=navigation(W,D,world.blockers);
    const renderer=new T.WebGLRenderer({antialias:true});root.Warehouse3D.configure(renderer);renderer.shadowMap.enabled=false;renderer.toneMappingExposure=1.05;stage.replaceChildren(renderer.domElement);
    const cam=new T.PerspectiveCamera(opts.wide?95:60,1,.08,Math.max(W,D)*3),ray=new T.Raycaster();
    const door=f.rects.find(r=>r.type==='door');
    let start=nav.nearest(opts.position?.x??(door?(door.x+door.w/2)*S:W/2),opts.position?.z??(door?(door.y+door.h/2)*S:D-2));
    if(start<0){root.Warehouse3D.dispose(scene);renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();throw new Error('歩ける通路がありません。マップの通路を確認してください。');}
    let [x,z]=nav.point(start),yaw=opts.position?.yaw??0,pitch=opts.position?.pitch??-.3,reachable=nav.flood(start),target=null,route=[],dead=false,raf=0,last=performance.now(),miniAt=0,keys={},held='',placing=false;
    const arrowGroup=new T.Group();scene.add(arrowGroup);
    let targetBase=0,targetCenter=null,selection=null;
    const red=new T.MeshBasicMaterial({color:new T.Color('#ed182d').convertSRGBToLinear(),toneMapped:false});
    const head=new T.Mesh(new T.ConeGeometry(.62,1,24),red);head.rotation.z=Math.PI;head.position.y=.5;
    const shaft=new T.Mesh(new T.CylinderGeometry(.19,.19,1.7,16),red);shaft.position.y=1.8;
    arrowGroup.add(head,shaft);arrowGroup.scale.setScalar(.58);arrowGroup.visible=false;
    const badgeCanvas=document.createElement('canvas');badgeCanvas.width=192;badgeCanvas.height=80;
    const bg=badgeCanvas.getContext('2d');bg.fillStyle='#ffffff';bg.fillRect(0,0,192,80);bg.fillStyle='#cc1427';bg.font='bold 48px sans-serif';bg.textAlign='center';bg.textBaseline='middle';bg.fillText('ここ！',96,42);
    const badgeTexture=new T.CanvasTexture(badgeCanvas);badgeTexture.encoding=T.sRGBEncoding;
    const badge=new T.Sprite(new T.SpriteMaterial({map:badgeTexture,toneMapped:false}));badge.scale.set(1.5,.625,1);badge.position.y=3;arrowGroup.add(badge);
    const footprint=new T.LineLoop(new T.BufferGeometry(),new T.LineBasicMaterial({color:'#ff2638'}));scene.add(footprint);footprint.visible=false;
    const steps=[];
    const arrow=new T.Shape();arrow.moveTo(0,.55);arrow.lineTo(-.48,-.05);arrow.lineTo(-.18,-.05);arrow.lineTo(-.18,-.5);arrow.lineTo(.18,-.5);arrow.lineTo(.18,-.05);arrow.lineTo(.48,-.05);arrow.closePath();
    const arrowGeom=new T.ShapeGeometry(arrow),stepMat=new T.MeshBasicMaterial({color:'#ffffff',side:T.DoubleSide});
    const diskGeom=new T.CircleGeometry(.95,32),diskMat=new T.MeshBasicMaterial({color:'#183d39',transparent:true,opacity:.83,side:T.DoubleSide});
    for(let i=0;i<4;i++){const group=new T.Group(),disk=new T.Mesh(diskGeom,diskMat),a=new T.Mesh(arrowGeom,stepMat);disk.rotation.x=a.rotation.x=-Math.PI/2;a.position.y=.02;group.add(disk,a);scene.add(group);steps.push({group,disk,a,end:-1});}
    const routeLine=new T.Line(new T.BufferGeometry(),new T.LineBasicMaterial({color:'#ffe154',transparent:true,opacity:.9}));scene.add(routeLine);
    function updateRoute(){routeLine.geometry.dispose();routeLine.geometry=new T.BufferGeometry().setFromPoints([[x,z],...route].map(p=>new T.Vector3(p[0],.09,p[1])));routeLine.visible=route.length>0;}
    function tell(msg){if(opts.onMessage)opts.onMessage(msg);}
    function face(cx,cz,cy=1){yaw=Math.atan2(x-cx,z-cz);pitch=Math.atan2(cy-EYE,Math.hypot(cx-x,cz-z));pitch=Math.max(-1,Math.min(.8,pitch));}
    function showFootprint(c,color){const y=world.heightAt((c.x+c.w/2)*S,(c.y+c.h/2)*S)+.07;footprint.geometry.dispose();footprint.geometry=new T.BufferGeometry().setFromPoints([[c.x,c.y],[c.x+c.w,c.y],[c.x+c.w,c.y+c.h],[c.x,c.y+c.h]].map(p=>new T.Vector3(p[0]*S,y,p[1]*S)));footprint.material.color.set(color);footprint.visible=true;}
    function focus(c,jump=true){
      target=c;selection=null;placing=false;route=[];updateRoute();if(!c){arrowGroup.visible=footprint.visible=false;targetCenter=null;return;}
      targetCenter=[(c.x+c.w/2)*S,(c.y+c.h/2)*S];targetBase=world.heightAt(...targetCenter)+.15;
      arrowGroup.position.set(targetCenter[0],targetBase,targetCenter[1]);arrowGroup.visible=true;showFootprint(c,'#ff2638');
      let end=nav.approach(c,reachable,x,z);
      // Explicit search may switch to another disconnected aisle; ordinary movement never does.
      if(end<0&&jump)end=nav.approach(c,nav.free,x,z);
      if(end>=0&&jump){[x,z]=nav.point(end);reachable=nav.flood(end);face(...targetCenter,targetBase+1.1);tell('赤い矢印が登録場所です');}
      else {face(...targetCenter,targetBase+1.1);tell(end<0?'この場所に隣接する通路がありません。全体マップで確認してください。':'赤い矢印が登録場所です');}
      updateSteps();drawMini();
    }
    function moveTo(end){if(placing||end<0||!reachable[end])return;const path=nav.path(nav.nearest(x,z,reachable),end);if(!path)return;route=path;updateRoute();if(route.length>1){yaw=Math.atan2(x-route[1][0],z-route[1][1]);pitch=-.18;}}
    function updateSteps(){const base=Math.round(yaw/(Math.PI/2))*Math.PI/2;steps.forEach((s,i)=>{const angle=base+i*Math.PI/2,px=x-Math.sin(angle)*6,pz=z-Math.cos(angle)*6;const end=nav.index(px,pz);let clear=end>=0&&reachable[end];for(let t=.25;clear&&t<=6;t+=.25)if(nav.blocked(x-Math.sin(angle)*t,z-Math.cos(angle)*t))clear=false;s.end=clear?end:-1;s.group.visible=!!clear&&!placing;s.group.position.set(px,.075,pz);s.a.rotation.z=-angle;});}
    const mini=opts.minimap,mg=mini?.getContext('2d');
    function drawMini(){if(!mg)return;const w=mini.width,h=mini.height,k=Math.min((w-16)/W,(h-16)/D),ox=(w-W*k)/2,oy=(h-D*k)/2;mini._map={k,ox,oy};mg.clearRect(0,0,w,h);root.Warehouse3D.floorCanvas(mg,f,S*k,ox,oy);f.rects.forEach(r=>{if(r.type==='cartreturn'){mg.strokeStyle='#ffffff';mg.lineWidth=2;mg.strokeRect(ox+r.x*S*k,oy+r.y*S*k,r.w*S*k,r.h*S*k);return;}mg.fillStyle=r.type==='wall'||r.type==='shut'?'#526066':r.type==='door'?'#eddc84':'#e2e5e2';mg.fillRect(ox+r.x*S*k,oy+r.y*S*k,r.w*S*k,r.h*S*k);});world.shelfLayouts.forEach(a=>{mg.save();mg.beginPath();mg.rect(ox+a.x*k,oy+a.z*k,a.w*k,a.d*k);mg.clip();root.Warehouse3D.floorCanvas(mg,f,S*k,ox,oy);mg.restore();mg.fillStyle='#a5ada8';a.rows.forEach(r=>mg.fillRect(ox+r.x*k,oy+r.z*k,r.w*k,r.d*k));mg.strokeStyle='#87938c';mg.lineWidth=1;mg.strokeRect(ox+a.x*k,oy+a.z*k,a.w*k,a.d*k);});if(route.length){mg.strokeStyle='#ffe353';mg.lineWidth=3;mg.beginPath();mg.moveTo(ox+x*k,oy+z*k);route.forEach(p=>mg.lineTo(ox+p[0]*k,oy+p[1]*k));mg.stroke();}if(target){mg.fillStyle='#ef283d';mg.fillRect(ox+target.x*S*k,oy+target.y*S*k,target.w*S*k,target.h*S*k);}mg.save();mg.translate(ox+x*k,oy+z*k);mg.rotate(-yaw);mg.fillStyle='#147cff';mg.strokeStyle='#fff';mg.lineWidth=2;mg.beginPath();mg.moveTo(0,-10);mg.lineTo(7,7);mg.lineTo(0,3);mg.lineTo(-7,7);mg.closePath();mg.fill();mg.stroke();mg.restore();}
    function miniClick(e){if(!mini._map)return;const r=mini.getBoundingClientRect(),{k,ox,oy}=mini._map,px=((e.clientX-r.left)*mini.width/r.width-ox)/k,pz=((e.clientY-r.top)*mini.height/r.height-oy)/k;const i=nav.index(px,pz);if(i<0||!reachable[i]){tell('つながった通路をタップしてください');return;}moveTo(i);}
    if(mini)mini.addEventListener('click',miniClick);
    function pick(e){const r=stage.getBoundingClientRect();ray.setFromCamera(new T.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),cam);
      if(placing){const hit=ray.intersectObjects(world.pickZones)[0];if(!hit||!(hit.object.userData.rect.pal||hit.object.userData.rect.view3d==='pallet')){tell('黒いパレットをタップしてください。区画の設定は全体マップで変更できます。');return;}const c=palletCell(hit.object.userData.rect,hit.point.x,hit.point.z,fi);selection=c;showFootprint(c,'#ffe154');opts.onPick?.(c);return;}
      const candidates=steps.filter(s=>s.group.visible),hit=ray.intersectObjects(candidates.map(s=>s.disk))[0];if(hit)moveTo(candidates.find(s=>s.disk===hit.object).end);
    }
    let pointer=null;
    function down(e){if(pointer)return;stage.setPointerCapture(e.pointerId);pointer={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false};route=[];updateRoute();}
    function move(e){if(!pointer||pointer.id!==e.pointerId)return;const dx=e.clientX-pointer.x,dy=e.clientY-pointer.y;if(Math.hypot(e.clientX-pointer.startX,e.clientY-pointer.startY)>6)pointer.moved=true;yaw-=dx*.005;pitch=Math.max(-1.25,Math.min(1.1,pitch-dy*.004));pointer.x=e.clientX;pointer.y=e.clientY;}
    function up(e){if(!pointer||pointer.id!==e.pointerId)return;const tap=!pointer.moved;pointer=null;if(tap&&e.type==='pointerup')pick(e);updateSteps();}
    const listeners=[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up]];listeners.forEach(([n,fn])=>stage.addEventListener(n,fn));
    function keyboard(e){if(opts.isPaused?.()||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;const key=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright'].includes(key)){e.preventDefault();keys[key]=e.type==='keydown';}}
    function reset(){keys={};held='';pointer=null;route=[];updateRoute();}
    root.addEventListener('keydown',keyboard);root.addEventListener('keyup',keyboard);root.addEventListener('blur',reset);
    const control=opts.controls;function controlDown(e){const b=e.target.closest('[data-walk]');if(!b)return;e.preventDefault();b.setPointerCapture(e.pointerId);held=b.dataset.walk;route=[];updateRoute();}function controlUp(){held='';}
    control?.addEventListener('pointerdown',controlDown);control?.addEventListener('pointerup',controlUp);control?.addEventListener('pointercancel',controlUp);
    function resize(){const w=stage.clientWidth,h=stage.clientHeight;if(!w||!h)return;renderer.setSize(w,h);cam.aspect=w/h;cam.updateProjectionMatrix();}
    const ro=new ResizeObserver(resize);ro.observe(stage);resize();
    if(opts.target)focus(opts.target,opts.jump!==false);else {updateSteps();drawMini();}
    function loop(now){if(dead)return;raf=requestAnimationFrame(loop);const dt=Math.min(.05,(now-last)/1000);last=now;
      if(!opts.isPaused?.()){
        let forward=(keys.w||keys.arrowup||held==='forward'?1:0)-(keys.s||keys.arrowdown||held==='back'?1:0),side=(keys.d||held==='right'?1:0)-(keys.a||held==='left'?1:0);
        if(keys.arrowleft)yaw+=dt*1.6;if(keys.arrowright)yaw-=dt*1.6;
        if(forward||side){route=[];routeLine.visible=false;const scale=8*dt/Math.max(1,Math.hypot(forward,side)),vx=(-Math.sin(yaw)*forward+Math.cos(yaw)*side)*scale,vz=(-Math.cos(yaw)*forward-Math.sin(yaw)*side)*scale;if(!nav.blocked(x+vx,z))x+=vx;if(!nav.blocked(x,z+vz))z+=vz;}
        else if(route.length){const p=route[0],dist=Math.hypot(p[0]-x,p[1]-z),step=12*dt;if(dist<=step){[x,z]=p;route.shift();if(!route.length){routeLine.visible=false;if(targetCenter)face(...targetCenter,targetBase+1.1);}}else{const desired=Math.atan2(x-p[0],z-p[1]),delta=Math.atan2(Math.sin(desired-yaw),Math.cos(desired-yaw));yaw+=delta*Math.min(1,dt*9);x+=(p[0]-x)/dist*step;z+=(p[1]-z)/dist*step;}}
      }else {held='';keys={};}
      cam.position.set(x,EYE,z);cam.rotation.order='YXZ';cam.rotation.set(pitch,yaw,0,'YXZ');arrowGroup.position.y=targetBase+Math.sin(now*.003)*.14;
      if(now-miniAt>100){miniAt=now;updateSteps();drawMini();}
      world.updateCamera?.(cam);renderer.render(scene,cam);
    }
    raf=requestAnimationFrame(loop);
    return {world,nav,cam,renderer,focus,setWide(on){cam.fov=on?95:60;cam.updateProjectionMatrix();},getPosition:()=>({x,z,yaw,pitch,f:fi}),setPlacing(on){placing=on;selection=null;route=[];updateRoute();if(on){arrowGroup.visible=footprint.visible=false;tell('登録したい黒いパレットをタップ');}else focus(target,false);updateSteps();},destroy(){dead=true;cancelAnimationFrame(raf);ro.disconnect();listeners.forEach(([n,fn])=>stage.removeEventListener(n,fn));mini?.removeEventListener('click',miniClick);root.removeEventListener('keydown',keyboard);root.removeEventListener('keyup',keyboard);root.removeEventListener('blur',reset);control?.removeEventListener('pointerdown',controlDown);control?.removeEventListener('pointerup',controlUp);control?.removeEventListener('pointercancel',controlUp);root.Warehouse3D.dispose(scene);renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}};
  }
  root.WarehouseWalk={navigation,palletCell,create};
})(window);
