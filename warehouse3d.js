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
  // Four rows are confirmed. Direction and width are provisional, isolated here.
  // World units: one pallet = 4. No map/localStorage migration is performed.
  const shelfSettings=Object.freeze({rows:4,direction:'x',aisle:4,depth:2,endClearance:2,height:6.9,levels:5});
  function shelfLayout(r){
    if(String(r.label||'').replace(/\s/g,'')!=='棚番の品'||r.type)return null;
    const x=r.x*2+.06,z=r.y*2+.06,w=r.w*2-.12,d=r.h*2-.12;
    if(w<=0||d<=0)return null;
    const cfg=shelfSettings,across=cfg.direction==='x'?d:w,along=cfg.direction==='x'?w:d;
    const fit=Math.min(1,across/(cfg.rows*cfg.depth+(cfg.rows-1)*cfg.aisle+2*cfg.endClearance));
    const depth=cfg.depth*fit,gap=cfg.aisle*fit,span=cfg.rows*depth+(cfg.rows-1)*gap;
    const offset=(across-span)/2,end=Math.min(cfg.endClearance,along*.1),length=along-2*end;
    const rows=Array.from({length:cfg.rows},(_,i)=>cfg.direction==='x'?{x:x+end,z:z+offset+i*(depth+gap),w:length,d:depth}:{x:x+offset+i*(depth+gap),z:z+end,w:depth,d:length});
    return {rect:r,x,z,w,d,rows,direction:cfg.direction,gap,height:cfg.height,levels:cfg.levels};
  }
  function dispose(scene) {
    if (!scene) return;
    const gs=new Set(), ms=new Set(), ts=new Set();
    scene.traverse(o => {
      if(o.userData&&o.userData.dispose)o.userData.dispose();
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
    const T=root.THREE,S=2,f=db.maps.floors[fi],W=f.cols*S,D=f.rows*S,HALL=9.6;
    const detail=!!opts.walk&&!!root.WarehouseMaterials,kit=detail?root.WarehouseMaterials.kit():null;
    const scene=new T.Scene();scene.background=new T.Color(opts.walk?'#b1b3a9':'#e8edf0');
    if(opts.walk)scene.fog=new T.Fog('#a4a69a',Math.max(W,D)*1.3,Math.max(W,D)*3);
    scene.add(new T.HemisphereLight('#f1f1e5','#494e42',opts.walk?.52:.85));
    const sun=new T.DirectionalLight('#fff6e5',opts.walk?.28:.85);sun.position.set(-W*.3,Math.max(W,D),D*.6);
    sun.target.position.set(W/2,0,D/2);scene.add(sun.target);scene.add(sun);
    sun.castShadow=!opts.walk;sun.shadow.mapSize.set(1024,1024);const sc=sun.shadow.camera;
    sc.left=-W;sc.right=W;sc.top=D;sc.bottom=-D;sc.far=Math.max(W,D)*4;sc.updateProjectionMatrix();sun.shadow.bias=-.00015;sun.shadow.normalBias=.025;
    const groups=new Map(),geom=new T.BoxGeometry(1,1,1),matCache=new Map();
    function mat(col,metal=0){if(col&&col.isMaterial)return col;const key=col+':'+metal;if(!matCache.has(key))matCache.set(key,new T.MeshStandardMaterial({color:new T.Color(col).convertSRGBToLinear(),roughness:metal?.4:.72,metalness:metal}));return matCache.get(key);}
    function box(x,z,w,d,y,h,col,metal=0){if(w<=0||d<=0||h<=0)return;const m=mat(col,metal);if(!groups.has(m))groups.set(m,[]);groups.get(m).push([x+w/2,y+h/2,z+d/2,w,h,d]);}
    const ground=f.floor==='gray'?'#929fa2':f.floor==='white'?'#ced5d4':'#647c69';
    const floorMaterial=kit?kit.floor(W,D,f.floor):mat(ground);
    const floor=new T.Mesh(new T.PlaneGeometry(W,D),floorMaterial);floor.rotation.x=-Math.PI/2;floor.position.set(W/2,.015,D/2);floor.receiveShadow=true;scene.add(floor);
    const mirror=kit?kit.reflection(W,D):null;if(mirror)scene.add(mirror);
    box(-.35,-.35,W+.7,D+.7,-.6,.45,'#6b726d');
    const panelMat=kit?kit.painted(1,1,'#e9ebe6'):mat('#c6c6bd');
    const wallMat=kit?kit.painted(1,1.7,'#e3e7e5'):mat('#d7d5c9');
    const pipeMat=mat('#878d8b',.68),pipeGeo=new T.CylinderGeometry(1,1,1,10),pipeInstances=[];
    function pipe(ax,ay,az,bx,by,bz,r){const a=new T.Vector3(ax,ay,az),b=new T.Vector3(bx,by,bz),v=b.clone().sub(a),o=new T.Object3D();o.position.copy(a).add(b).multiplyScalar(.5);o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),v.clone().normalize());o.scale.set(r,v.length(),r);o.updateMatrix();pipeInstances.push(o.matrix.clone());}
    const lampPositions=[],lampPool=[];
    if(opts.walk){
      // Panel-sized wall pieces keep texture scale consistent in differently sized maps.
      for(let z=0;z<D;z+=6){box(-.18,z,.18,Math.min(6,D-z),0,HALL,wallMat);box(W,z,.18,Math.min(6,D-z),0,HALL,wallMat);}
      for(let x=0;x<W;x+=6){box(x,-.18,Math.min(6,W-x),.18,0,HALL,wallMat);box(x,D,Math.min(6,W-x),.18,0,HALL,wallMat);}
      const ceiling=new T.Mesh(new T.PlaneGeometry(W,D),kit?kit.painted(W/6,D/6):panelMat);ceiling.rotation.x=Math.PI/2;ceiling.position.set(W/2,HALL,D/2);scene.add(ceiling);
      for(let z=0;z<D;z+=4.8)box(0,z,W,.023,HALL-.015,.014,'#66695f');
      for(let x=0;x<W;x+=2.4)box(x,0,.02,D,HALL-.018,.014,'#73756a');
      // Existing surface conduit, hangers and twin-tube fluorescent housings.
      const glow=new T.MeshBasicMaterial({color:'#eff9ff',toneMapped:false});
      for(let z=3;z<D;z+=12){
        pipe(0,HALL-.55,z,W,HALL-.55,z,.065);
        for(let x=4;x<W;x+=12){
          box(x-.13,z-.44,3.8,.88,HALL-.54,.13,panelMat);
          box(x,z-.4,.18,.8,HALL-.8,.3,panelMat);box(x+3.4,z-.4,.18,.8,HALL-.8,.3,panelMat);
          for(const dz of [-.23,.23]){const tube=new T.Mesh(new T.CylinderGeometry(.085,.085,3.3,12),glow);tube.rotation.z=Math.PI/2;tube.position.set(x+1.8,HALL-.76,z+dz);scene.add(tube);}
          lampPositions.push(new T.Vector3(x+1.7,HALL-.98,z));
          pipe(x+1.7,HALL-.25,z-.5,x+1.7,HALL-.65,z-.5,.025);
        }
      }
      for(let x=2;x<W;x+=16){pipe(x,HALL-.18,0,x,HALL-.18,D,.037);for(let z=2;z<D;z+=6)box(x-.08,z,.16,.08,HALL-.3,.25,'#73766f',.35);}
      // A fixed-size light pool follows the nearest fixtures, keeping mobile shader cost bounded.
      for(let i=0;i<Math.min(6,lampPositions.length);i++){const l=new T.PointLight('#f4f8ff',.8,23,1.4);scene.add(l);lampPool.push(l);}
    }
    const contactMat=kit?new T.MeshBasicMaterial({map:kit.contactMap(),transparent:true,depthWrite:false,color:'#000000',opacity:.62}):null;
    const contacts=[];
    function contact(x,z,w,d){if(contactMat)contacts.push([x+w/2,z+d/2,w+.65,d+.65]);}
    const blockers=[], heightRects=[], pickZones=[],shelfLayouts=[];
    function border(x,z,w,d,col,y=.035,t=.065){box(x,z,w,t,y,.018,col);box(x,z+d-t,w,t,y,.018,col);box(x,z,t,d,y,.018,col);box(x+w-t,z,t,d,y,.018,col);}
    function pallet(x,z,w,d){
      contact(x,z,w,d);
      // Deep molded rim, fork openings and thin recessed lattice (not a flat wire grid).
      const dark='#151b1a',edge='#29302e',rib='#303632';
      for(const k of [0,.5,1]){
        const rx=x+k*(w-.3);box(rx,z,.3,d,.07,.11,dark);
        for(const j of [0,.5,1])box(rx,z+j*(d-.38),.3,.38,.16,.28,dark);
      }
      box(x,z,w,.15,.35,.23,edge);box(x,z+d-.15,w,.15,.35,.23,edge);
      box(x,z,.15,d,.35,.23,edge);box(x+w-.15,z,.15,d,.35,.23,edge);
      for(let k=1;k<8;k++){box(x+k*w/8,z,.042,d,.42,.115,rib);box(x,z+k*d/8,w,.042,.42,.115,rib);}
      for(const k of [.25,.75]){box(x+k*w-.07,z,.14,d,.38,.17,edge);box(x,z+k*d-.07,w,.14,.38,.17,edge);}
      // Small worn molded lip catches the light without whitening the whole pallet.
      box(x,z,w,.024,.57,.015,'#48504a');box(x,z,.024,d,.57,.015,'#48504a');
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
    function steelShelves(layout){
      const alongX=layout.direction==='x',H=layout.height;
      layout.rows.forEach(row=>{
        const L=alongX?row.w:row.d,B=alongX?row.d:row.w,bays=Math.max(1,Math.ceil(L/6.4)),bay=L/bays;
        function piece(u,v,a,b,y,h,col,metal=.38){if(alongX)box(row.x+u,row.z+v,a,b,y,h,col,metal);else box(row.x+v,row.z+u,b,a,y,h,col,metal);}
        contact(row.x,row.z,row.w,row.d);
        for(let i=0;i<=bays;i++)for(const side of [0,1]){
          const u=Math.min(L-.13,i*bay),v=side*(B-.13);
          piece(u,v,.13,.035,.1,H-.1,'#8a918c');piece(u,v,.035,.13,.1,H-.1,'#8a918c');
          piece(Math.max(0,u-.045),Math.max(0,v-.04),.2,.19,.04,.06,'#747b74');
          for(let y=.55;y<H-.1;y+=.32)piece(u+.055,v+(side?.133:-.008),.035,.012,y,.065,'#414b46',.05);
        }
        for(let level=0;level<layout.levels;level++){
          const y=.35+level*(H-.65)/(layout.levels-1);
          for(let i=0;i<bays;i++){
            piece(i*bay+.055,.055,bay-.11,B-.11,y,.075,'#b1b2a9',.25);
            for(const v of [.055,B-.11])piece(i*bay+.055,v,bay-.11,.055,y-.12,.16,'#838b84');
          }
        }
        blockers.push([row.x,row.z,row.x+row.w,row.z+row.d]);
      });
    }
    function metalDoor(x,z,w,d){
      // Closed door is opaque frosted glass, so the existing outer wall never shows through it.
      const alongX=w>=d,span=Math.min(3.4,alongX?w:d),H=7.4;
      const origin=(alongX?x:z)+((alongX?w:d)-span)/2;
      let plane=alongX?z+d/2:x+w/2;
      if(alongX){if(z<.2)plane=.08;else if(z+d>D-.2)plane=D-.08;}
      else {if(x<.2)plane=.08;else if(x+w>W-.2)plane=W-.08;}
      const flip=alongX?plane>D/2:plane<W/2;
      function piece(u,v,a,b,y,h,col,metal=0){if(flip)u=span-u-a;if(alongX)box(origin+u,plane+v,a,b,y,h,col,metal);else box(plane+v,origin+u,b,a,y,h,col,metal);}
      const frame=mat('#9a9fa0',.7),leaf=mat('#a1a5a1',.38);
      const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d'),pixels=g.createImageData(128,128);
      let seed=53;for(let i=0;i<128*128;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const n=(seed>>>24)/255*14-7;const y=Math.floor(i/128)/128;pixels.data[i*4]=220+n;pixels.data[i*4+1]=214+n-y*8;pixels.data[i*4+2]=207+n-y*16;pixels.data[i*4+3]=255;}g.putImageData(pixels,0,0);
      const tex=new T.CanvasTexture(c);tex.encoding=T.sRGBEncoding;
      const glass=new T.MeshStandardMaterial({map:tex,roughness:.97,metalness:0,emissive:'#d4c5b3',emissiveIntensity:.18});
      piece(0,-.15,.14,.3,0,H,frame);piece(span-.14,-.15,.14,.3,0,H,frame);piece(0,-.15,span,.3,H-.16,.16,frame);
      piece(.14,-.1,span-.28,.2,.09,3.43,leaf);
      piece(.2,-.055,span-.4,.11,3.65,H-3.91,glass);
      piece(.14,-.11,span-.28,.22,3.5,.15,frame);piece(.14,-.11,.065,.22,3.65,H-3.81,frame);piece(span-.205,-.11,.065,.22,3.65,H-3.81,frame);
      piece(.03,-.22,span-.06,.44,.025,.07,frame);
      // Photo reference: round handle, hinges, overhead closer; no extra wall equipment.
      for(const side of [-1,1]){
        piece(span-.43,side*.17-.04,.18,.08,3.49,.2,frame);
        const knob=new T.Mesh(new T.SphereGeometry(.14,12,8),frame);
        const knobU=flip?.34:span-.34;
        knob.position.set(alongX?origin+knobU:plane+side*.24,3.59,alongX?plane+side*.24:origin+knobU);scene.add(knob);
      }
      for(const y of [1.2,5.8])piece(.02,-.17,.13,.34,y,.3,frame);
      piece(.32,-.19,.8,.38,H-.44,.18,frame);piece(.75,-.24,.9,.1,H-.36,.055,frame);
      return H;
    }
    let warmLights=0;
    f.rects.forEach(r=>{
      const x=r.x*S+.06,z=r.y*S+.06,w=r.w*S-.12,d=r.h*S-.12;
      const shelves=shelfLayout(r);
      let H=.13;
      if(r.type==='wall') {H=opts.walk?HALL:3.6;box(x,z,w,d,0,H,wallMat);box(x,z,w,d,H,.08,'#c9cbc2');contact(x,z,w,d);}
      else if(r.type==='shut') {
        H=8.6;box(x,z,w,d,0,H,kit?kit.curtain(Math.max(w,d),H):'#d1b431');
        for(let y=.6;y<H;y+=2)box(x-.02,z-.02,w+.04,d+.04,y,.09,'#c5a52d',.15);
        box(x,z,w,d,H,.2,'#d3d5ca',.3);
        if(w>d){box(x-.12,z-.03,.12,d+.06,0,H,'#9a9e96',.4);box(x+w,z-.03,.12,d+.06,0,H,'#9a9e96',.4);}
        else{box(x-.03,z-.12,w+.06,.12,0,H,'#9a9e96',.4);box(x-.03,z+d,w+.06,.12,0,H,'#9a9e96',.4);}
        if(opts.walk&&warmLights++<2){const light=new T.PointLight('#ffd16c',1.1,20,1.5);light.position.set(x+w/2,3,z+d/2);scene.add(light);}
      }
      else if(r.type==='door'){H=metalDoor(x,z,w,d);border(x,z,w,d,'#e8c976');}
      else if(r.type==='nest'){H=rack(x,z,w,d,true);}
      else {
        border(x,z,w,d,'#b6a24c',.03,.08);if(!shelves)contact(x,z,w,d);
        // Preserve explicit shapes; summarized shelf areas stay a single region.
        const style=r.view3d || (r.pal?'pallet':'shelf');
        if(shelves){H=shelves.height;steelShelves(shelves);shelfLayouts.push(shelves);}
        else if(style==='shelf') { H=3.5; box(x,z,w,d,0,H,panelMat); }
        else if(style==='rack') {
          H=4.73;const nx=Math.max(1,Math.ceil(w/4)),nz=Math.max(1,Math.ceil(d/4));
          for(let a=0;a<nx;a++)for(let b=0;b<nz;b++)rack(x+a*w/nx+.08,z+b*d/nz+.08,w/nx-.16,d/nz-.16);
        } else if(style==='pallet') {
          H=.585;for(let a=0;a<r.w;a+=2)for(let b=0;b<r.h;b+=2)pallet(x+a*S+.08,z+b*S+.08,Math.min(2,r.w-a)*S-.28,Math.min(2,r.h-b)*S-.28);
        }
        // Generic areas and the old "load" shape never fabricate physical boxes.
      }
      if(r.type!=='door'&&!shelves)blockers.push([x,z,x+w,z+d]);
      heightRects.push({x,z,w,d,h:H});
      const hit=new T.Mesh(new T.BoxGeometry(w,Math.max(.2,H),d),new T.MeshBasicMaterial({visible:false}));hit.position.set(x+w/2,Math.max(.2,H)/2,z+d/2);hit.userData.rect=r;scene.add(hit);pickZones.push(hit);
      if(r.label){const sp=label(r.label,'#314c58',Math.min(opts.walk?3:6,Math.max(2.3,w*.6)));sp.position.set(x+w/2,H+.8,z+d/2);scene.add(sp);}
    });
    const heightAt=(x,z)=>heightRects.reduce((h,r)=>x>=r.x&&x<=r.x+r.w&&z>=r.z&&z<=r.z+r.d?Math.max(h,r.h):h,0);
    const records=locations(db).filter(c=>c.f===fi), grouped=new Map(),markGroup=new T.Group();scene.add(markGroup);
    records.forEach(c=>{const k=[c.x,c.y,c.w,c.h].join(':');if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(c);});
    const marks=[];
    if(!opts.walk) grouped.forEach(items=>{
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
    groups.forEach((instances,material)=>{const mesh=new T.InstancedMesh(geom,material,instances.length),o=new T.Object3D();instances.forEach((a,i)=>{o.position.set(a[0],a[1],a[2]);o.scale.set(a[3],a[4],a[5]);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);});mesh.castShadow=material!==mat('#a7b4b7');mesh.receiveShadow=true;mesh.frustumCulled=false;scene.add(mesh);});
    if(pipeInstances.length){const mesh=new T.InstancedMesh(pipeGeo,pipeMat,pipeInstances.length);pipeInstances.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.frustumCulled=false;scene.add(mesh);}else pipeGeo.dispose();
    if(contacts.length){const mesh=new T.InstancedMesh(new T.PlaneGeometry(1,1),contactMat,contacts.length),o=new T.Object3D();contacts.forEach((a,i)=>{o.position.set(a[0],.029,a[1]);o.rotation.x=-Math.PI/2;o.scale.set(a[2],a[3],1);o.updateMatrix();mesh.setMatrixAt(i,o.matrix);});mesh.frustumCulled=false;scene.add(mesh);}
    let lastLightX=-100,lastLightZ=-100;
    function updateCamera(camera){if(!lampPool.length||Math.hypot(camera.position.x-lastLightX,camera.position.z-lastLightZ)<2)return;lastLightX=camera.position.x;lastLightZ=camera.position.z;const near=lampPositions.slice().sort((a,b)=>a.distanceToSquared(camera.position)-b.distanceToSquared(camera.position));lampPool.forEach((l,i)=>l.position.copy(near[i]));}
    return {scene,blockers,heightAt,marks,pickZones,W,D,records,markGroup,shelfLayouts,updateCamera,setReflections:on=>{if(mirror)mirror.visible=on;},hasReflections:!!mirror};

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
  root.Warehouse3D={locations,find,materialize,createWorld,overview,configure,dispose,norm,label,shelfLayout,shelfSettings};
})(window);
