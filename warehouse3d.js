/* Warehouse navigator. Positions are records, never inferred stock quantities. */
(function (root) {
  'use strict';
  const norm = s => String(s || '').toUpperCase().replace(/^([A-Z]+)0+/, '$1');
  function locations(db) {
    const out = [], known = new Set();
    const floors = db.maps.floors;
    Object.entries(db.spots || {}).forEach(([code, entry]) => {
      known.add(norm(code)); // An empty record is an intentional removal, not a fallback request.
      (entry.cells || []).forEach((c, i) => {
        const f = floors[c.f];
        if (!f || !Number.isFinite(c.x) || !Number.isFinite(c.y) || c.x < 0 || c.y < 0 || c.x >= f.cols || c.y >= f.rows) return;
        out.push({code, f:c.f, x:c.x, y:c.y, w:Math.min(c.w || 2, f.cols-c.x), h:Math.min(c.h || 2, f.rows-c.y), s:c.s || 'r', index:i});
      });
    });
    floors.forEach((f, fi) => f.rects.forEach(r => {
      (r.parts || []).forEach(code => {
        if (!known.has(norm(code))) out.push({code, f:fi, x:r.x, y:r.y, w:r.w, h:r.h, s:'r', legacy:true, rectId:r.id});
      });
    }));
    return out;
  }
  function find(db, q) {
    q = String(q || '').trim().toUpperCase(); if (!q) return null;
    const all = locations(db), codes = [...new Set(all.map(c => c.code))];
    let code = codes.find(c => norm(c) === norm(q));
    // Exact normalized codes only: C1 must never navigate to C10 after C1 is removed.
    return code ? {code, cells:all.filter(c => c.code === code)} : null;
  }
  function materialize(db, code) {
    const matches = locations(db).filter(c => norm(c.code) === norm(code));
    const keys = Object.keys(db.spots).filter(c => norm(c) === norm(code));
    const key = keys[0] || (matches[0] && matches[0].code) || code;
    const cells = matches.map(c => ({f:c.f,x:c.x,y:c.y,w:c.w,h:c.h,s:c.s}));
    keys.forEach(k => { if(k !== key) delete db.spots[k]; });
    db.spots[key] = {cells};
    return key;
  }
  function dispose(scene) {
    if (!scene) return;
    const gs=new Set(), ms=new Set(), ts=new Set();
    scene.traverse(o => {
      if(o.geometry) gs.add(o.geometry);
      if(o.material) (Array.isArray(o.material)?o.material:[o.material]).forEach(m=>ms.add(m));
    });
    ms.forEach(m=>Object.values(m).forEach(v=>{if(v&&v.isTexture)ts.add(v);}));
    gs.forEach(g=>g.dispose()); ts.forEach(t=>t.dispose()); ms.forEach(m=>m.dispose());
  }
  function label(text, color='#253b49', width=3.5) {
    const T=root.THREE,c=document.createElement('canvas'); c.width=512;c.height=112;
    const g=c.getContext('2d'); g.fillStyle='#ffffff';g.fillRect(0,0,512,112);
    g.fillStyle=color;g.fillRect(0,0,12,112);g.font='bold 37px sans-serif';g.textBaseline='middle';
    let textStr=String(text);while(g.measureText(textStr).width>468&&textStr.length>1)textStr=textStr.slice(0,-2)+'…';
    g.fillText(textStr,26,58);
    const tex=new T.CanvasTexture(c);tex.encoding=T.sRGBEncoding;
    const sp=new T.Sprite(new T.SpriteMaterial({map:tex,depthTest:true}));sp.scale.set(width,width*112/512,1);return sp;
  }
  function createWorld(db, fi, opts={}) {
    const T=root.THREE,S=2,f=db.maps.floors[fi],W=f.cols*S,D=f.rows*S;
    const scene=new T.Scene();scene.background=new T.Color('#e8edf0');
    if(opts.walk) scene.fog=new T.Fog('#e8edf0',Math.max(W,D)*.8,Math.max(W,D)*2);
    scene.add(new T.HemisphereLight('#fff9ed','#879dab',.85));
    const sun=new T.DirectionalLight('#fff6e5',.85);sun.position.set(-W*.3,Math.max(W,D),D*.6);
    sun.target.position.set(W/2,0,D/2);scene.add(sun.target);scene.add(sun);
    sun.castShadow=true;sun.shadow.mapSize.set(1024,1024);const sc=sun.shadow.camera;
    sc.left=-W;sc.right=W;sc.top=D;sc.bottom=-D;sc.far=Math.max(W,D)*4;sc.updateProjectionMatrix();sun.shadow.bias=-.00015;sun.shadow.normalBias=.025;
    const groups=new Map(),geom=new T.BoxGeometry(1,1,1),matCache=new Map();
    function mat(col,metal=0){const key=col+':'+metal;if(!matCache.has(key))matCache.set(key,new T.MeshStandardMaterial({color:new T.Color(col).convertSRGBToLinear(),roughness:metal?.48:.88,metalness:metal}));return matCache.get(key);}
    function box(x,z,w,d,y,h,col,metal=0){if(w<=0||d<=0||h<=0)return;const m=mat(col,metal);if(!groups.has(m))groups.set(m,[]);groups.get(m).push([x+w/2,y+h/2,z+d/2,w,h,d]);}
    const ground = f.floor==='gray'?'#929fa2':f.floor==='white'?'#ced5d4':'#6f9985';
    // A subtle, deterministic floor texture is decoration, not an occupancy signal.
    const cv=document.createElement('canvas');cv.width=cv.height=128;const ctx=cv.getContext('2d');ctx.fillStyle=ground;ctx.fillRect(0,0,128,128);
    let seed=781;for(let i=0;i<1300;i++){seed=(seed*16807)%2147483647;const x=seed%128;seed=(seed*16807)%2147483647;ctx.fillStyle=i%2?'#ffffff09':'#00000007';ctx.fillRect(x,seed%128,1,1);}
    ctx.strokeStyle='#ffffff0d';ctx.strokeRect(0,0,128,128);
    const ft=new T.CanvasTexture(cv);ft.wrapS=ft.wrapT=T.RepeatWrapping;ft.repeat.set(f.cols/2,f.rows/2);ft.encoding=T.sRGBEncoding;
    const floor=new T.Mesh(new T.PlaneGeometry(W,D),new T.MeshStandardMaterial({map:ft,roughness:.91}));floor.rotation.x=-Math.PI/2;floor.position.set(W/2,.015,D/2);floor.receiveShadow=true;scene.add(floor);
    box(-.35,-.35,W+.7,D+.7,-.6,.45,'#a7b4b7');
    if(opts.walk){
      box(-.18,0,.18,D,0,7,'#c5cdd0');box(W,0,.18,D,0,7,'#c5cdd0');
      box(0,-.18,W,.18,0,7,'#d5dbdc');box(0,D,W,.18,0,7,'#d5dbdc');
      box(0,0,W,D,7,.15,'#e4e9e9');
      for(let z=2;z<D;z+=10){box(0,z,W,.16,6.7,.3,'#7c919b',.4);for(let x=3;x<W;x+=12)box(x,z,2.5,.5,6.63,.07,'#ffffff');}
    }
    const blockers=[], heightRects=[], pickZones=[];
    function border(x,z,w,d,col,y=.035,t=.065){box(x,z,w,t,y,.018,col);box(x,z+d-t,w,t,y,.018,col);box(x,z,t,d,y,.018,col);box(x+w-t,z,t,d,y,.018,col);}
    function pallet(x,z,w,d){
      box(x,z+.12,w,.24,.08,.22,'#927951');box(x,z+d-.36,w,.24,.08,.22,'#927951');
      const n=Math.max(2,Math.min(6,Math.ceil(w/.55)));for(let k=0;k<n;k++)box(x+k*w/n,z,w/n-.07,d,.3,.12,'#c6ae83');
    }
    function rack(x,z,w,d,nest=false){
      const H=nest?5:4.6, post=.13, clr=nest?'#a64f48':'#405f70';
      [[x,z],[x+w-post,z],[x,z+d-post],[x+w-post,z+d-post]].forEach(p=>{
        box(p[0]-.07,p[1]-.07,.27,.27,.05,.08,'#394c56',.4);box(p[0],p[1],post,post,.12,H,clr,.45);
      });
      const levels=nest?[.26,2.6]:[.32,1.68,3.04];
      levels.forEach(y=>{box(x,z,w,d,y,.08,'#bdc8cc',.45);box(x,z,w,.1,y,.17,nest?clr:'#be9760',.35);box(x,z+d-.1,w,.1,y,.17,nest?clr:'#be9760',.35);});
      if(!nest){box(x,z,w,.12,4.4,.16,clr,.45);box(x,z+d-.12,w,.12,4.4,.16,clr,.45);}
      return H;
    }
    f.rects.forEach(r=>{
      const x=r.x*S+.06,z=r.y*S+.06,w=r.w*S-.12,d=r.h*S-.12;
      let H=.13;
      if(r.type==='wall') {H=opts.walk?7:3.6;box(x,z,w,d,0,H,'#bac7cb',.1);box(x,z,w,d,H,.08,'#dde3e5');}
      else if(r.type==='shut') {H=5.6;box(x,z,w,d,0,H,'#97a8b0',.5);for(let y=.2;y<H;y+=.28)box(x-.01,z-.01,w+.02,d+.02,y,.025,'#6e818b',.3);}
      else if(r.type==='door'){H=0; border(x,z,w,d,'#e8c976');}
      else if(r.type==='nest'){H=rack(x,z,w,d,true);}
      else {
        box(x,z,w,d,.02,.08,'#b9c2c3');border(x,z,w,d,'#e9d69b',.12);
        // 指定なしの区画は棚ブロックとして立てる（ver38までの歩く見た目）。「区画だけ」を選べば平らになる
        const style=r.view3d || (r.pal?'pallet':'shelf');
        if(style==='shelf') { H=3.5; box(x,z,w,d,0,H,'#c3ccd5'); }
        else if(style==='rack') {
          H=4.73;const nx=Math.max(1,Math.ceil(w/4)),nz=Math.max(1,Math.ceil(d/4));
          for(let a=0;a<nx;a++)for(let b=0;b<nz;b++)rack(x+a*w/nx+.08,z+b*d/nz+.08,w/nx-.16,d/nz-.16);
        } else if(style==='pallet') {
          H=.42;for(let a=0;a<r.w;a+=2)for(let b=0;b<r.h;b+=2)pallet(x+a*S+.08,z+b*S+.08,Math.min(2,r.w-a)*S-.28,Math.min(2,r.h-b)*S-.28);
        }
        // Generic areas and the old "load" shape never fabricate physical boxes.
      }
      if(r.type!=='door')blockers.push([x,z,x+w,z+d]);
      heightRects.push({x,z,w,d,h:H});
      const hit=new T.Mesh(new T.BoxGeometry(w,Math.max(.2,H),d),new T.MeshBasicMaterial({visible:false}));hit.position.set(x+w/2,Math.max(.2,H)/2,z+d/2);hit.userData.rect=r;scene.add(hit);pickZones.push(hit);
      if(r.label){const sp=label(r.label,'#314c58',Math.min(6,Math.max(2.3,w*.6)));sp.position.set(x+w/2,H+.8,z+d/2);scene.add(sp);}
    });
    const heightAt=(x,z)=>heightRects.reduce((h,r)=>x>=r.x&&x<=r.x+r.w&&z>=r.z&&z<=r.z+r.d?Math.max(h,r.h):h,0);
    const records=locations(db).filter(c=>c.f===fi), grouped=new Map(),markGroup=new T.Group();scene.add(markGroup);
    records.forEach(c=>{const k=[c.x,c.y,c.w,c.h].join(':');if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(c);});
    const marks=[];
    grouped.forEach(items=>{
      const c=items[0],x=(c.x+c.w/2)*S,z=(c.y+c.h/2)*S,base=heightAt(x,z);
      const selected=items.some(i=>norm(i.code)===norm(opts.selected));
      const color=selected?'#087f75':c.s==='p'?'#9954b8':c.s==='b'?'#317cc0':'#bc6650';
      const m=new T.Mesh(new T.BoxGeometry(Math.min(1.7,c.w*S*.7),.65,Math.min(1.4,c.h*S*.7)),new T.MeshStandardMaterial({color:new T.Color(color).convertSRGBToLinear(),transparent:true,opacity:.92,roughness:.4}));
      m.position.set(x,base+.52,z);m.userData.records=items;m.userData.registration=true;markGroup.add(m);marks.push(m);
      // Stylised registration token, not a carton or a count of real objects.
      const edges=new T.LineSegments(new T.EdgesGeometry(m.geometry),new T.LineBasicMaterial({color:'#ffffff'}));edges.position.copy(m.position);markGroup.add(edges);
      if(selected){const ring=new T.Mesh(new T.RingGeometry(1.0,1.16,32),new T.MeshBasicMaterial({color:'#04baa1',side:T.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.set(x,base+.12,z);markGroup.add(ring);}
      const sp=label(items.length===1?c.code:'登録 '+items.length+'品番',color,3.0);sp.position.set(x,base+1.5,z);markGroup.add(sp);
    });
    groups.forEach((instances,material)=>{const mesh=new T.InstancedMesh(geom,material,instances.length),o=new T.Object3D();instances.forEach((a,i)=>{o.position.set(a[0],a[1],a[2]);o.scale.set(a[3],a[4],a[5]);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);});mesh.castShadow=material!==mat('#a7b4b7');mesh.receiveShadow=false;mesh.frustumCulled=false;scene.add(mesh);});
    return {scene,blockers,heightAt,marks,pickZones,W,D,records,markGroup};
  }
  function configure(renderer){const T=root.THREE;renderer.setPixelRatio(Math.min(1.6,root.devicePixelRatio||1));renderer.outputEncoding=T.sRGBEncoding;renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.92;}
  function overview(stage,db,fi,opts={}){
    const T=root.THREE,world=createWorld(db,fi,opts),renderer=new T.WebGLRenderer({antialias:true,alpha:false});configure(renderer);stage.replaceChildren(renderer.domElement);
    const cam=new T.PerspectiveCamera(42,1,.1,3000),center=new T.Vector3(world.W/2,0,world.D/2);
    let yaw=-.36,pitch=1.04,dist=1,raf=0,dead=false,autoFit=true;
    function render(){if(dead)return;cam.position.set(center.x+Math.sin(yaw)*Math.cos(pitch)*dist,center.y+Math.sin(pitch)*dist,center.z+Math.cos(yaw)*Math.cos(pitch)*dist);cam.lookAt(center);renderer.render(world.scene,cam);}
    function schedule(){if(!raf)raf=requestAnimationFrame(()=>{raf=0;render();});}
    function fit(){
      center.set(world.W/2,1.4,world.D/2);pitch=.96;yaw=-.24;dist=0;
      const tv=Math.tan(cam.fov*Math.PI/360),th=tv*cam.aspect;
      for(const x of [-world.W/2,world.W/2])for(const z of [-world.D/2,world.D/2])for(const y of [-1.4,5.6]){
        const side=x*Math.cos(yaw)-z*Math.sin(yaw),along=x*Math.sin(yaw)+z*Math.cos(yaw);
        const up=-along*Math.sin(pitch)+y*Math.cos(pitch),depth=along*Math.cos(pitch)+y*Math.sin(pitch);
        dist=Math.max(dist,depth+Math.abs(side)/th,depth+Math.abs(up)/tv);
      }
      dist*=1.08;schedule();
    }
    function resize(){renderer.setSize(stage.clientWidth,stage.clientHeight);cam.aspect=stage.clientWidth/Math.max(1,stage.clientHeight);cam.updateProjectionMatrix();if(autoFit)fit();else schedule();}
    const ro=new ResizeObserver(resize);ro.observe(stage);resize();fit();
    const ptr=new Map();let tap=null;
    function down(e){autoFit=false;stage.setPointerCapture(e.pointerId);ptr.set(e.pointerId,{x:e.clientX,y:e.clientY});tap=ptr.size===1?{x:e.clientX,y:e.clientY}:null;}
    function move(e){if(!ptr.has(e.pointerId))return;const old=ptr.get(e.pointerId),dx=e.clientX-old.x,dy=e.clientY-old.y;
      if(tap&&Math.hypot(e.clientX-tap.x,e.clientY-tap.y)>6)tap=null;
      if(ptr.size===2){const other=[...ptr.entries()].find(([k])=>k!==e.pointerId)[1];const a=Math.hypot(old.x-other.x,old.y-other.y),b=Math.hypot(e.clientX-other.x,e.clientY-other.y);if(b>4)dist*=a/b;const k=dist/stage.clientHeight*.8;center.x-=dx*k*.5;center.z-=dy*k*.5;}
      else {yaw-=dx*.006;pitch=Math.max(.22,Math.min(1.5,pitch+dy*.005));}
      dist=Math.max(7,Math.min(Math.max(world.W,world.D)*5,dist));ptr.set(e.pointerId,{x:e.clientX,y:e.clientY});schedule();}
    function up(e){if(tap&&e.type==='pointerup'){const r=stage.getBoundingClientRect(),ray=new T.Raycaster();ray.setFromCamera(new T.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),cam);const hit=ray.intersectObjects(world.marks)[0]||ray.intersectObjects(world.pickZones)[0];if(hit&&opts.onPick)opts.onPick(hit.object.userData);}
      ptr.delete(e.pointerId);tap=null;}
    function wheel(e){autoFit=false;e.preventDefault();dist*=Math.exp(e.deltaY*.001);dist=Math.max(7,Math.min(Math.max(world.W,world.D)*5,dist));schedule();}
    stage.addEventListener('pointerdown',down);stage.addEventListener('pointermove',move);stage.addEventListener('pointerup',up);stage.addEventListener('pointercancel',up);stage.addEventListener('wheel',wheel,{passive:false});
    return {world,renderer,cam,fit:()=>{autoFit=true;fit();},zoom:k=>{autoFit=false;dist=Math.max(7,Math.min(Math.max(world.W,world.D)*5,dist*k));schedule();},destroy(){dead=true;cancelAnimationFrame(raf);ro.disconnect();[['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',up],['wheel',wheel]].forEach(([n,fn])=>stage.removeEventListener(n,fn));dispose(world.scene);renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();}};
  }
  root.Warehouse3D={locations,find,materialize,createWorld,overview,configure,dispose,norm};
})(window);
