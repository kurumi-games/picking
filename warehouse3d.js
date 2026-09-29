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
        if (!f || !Number.isFinite(c.x) || !Number.isFinite(c.y) || c.x < 0 || c.y < 0 || c.x >= f.cols || c.y >= planRows(f)) return;
        out.push({code, f:c.f, x:c.x, y:c.y, w:Math.min(c.w || 2, f.cols-c.x), h:Math.min(c.h || 2, planRows(f)-c.y), s:c.s || 'r', index:i});
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
  // Four longitudinal rows, each composed of two empty shelves placed back-to-back.
  // World units: one pallet = 4. No map/localStorage migration is performed.
  const shelfSettings=Object.freeze({rows:4,direction:'z',aisle:4,depth:2,unitsPerRow:2,endClearance:2,height:6.9,levels:5});
  function shelfLayout(r){
    if(String(r.label||'').replace(/\s/g,'')!=='棚番の品'||r.type)return null;
    const x=r.x*2+.06,z=r.y*2+.06,w=r.w*2-.12,d=r.h*2-.12;
    if(w<=0||d<=0)return null;
    const cfg=shelfSettings,across=cfg.direction==='x'?d:w,along=cfg.direction==='x'?w:d;
    const fit=Math.min(1,across/(cfg.rows*cfg.depth*cfg.unitsPerRow+(cfg.rows-1)*cfg.aisle+2*cfg.endClearance));
    const depth=cfg.depth*cfg.unitsPerRow*fit,gap=cfg.aisle*fit,span=cfg.rows*depth+(cfg.rows-1)*gap;
    const offset=(across-span)/2,end=Math.min(cfg.endClearance,along*.1),length=along-2*end;
    const rows=Array.from({length:cfg.rows},(_,i)=>cfg.direction==='x'?{x:x+end,z:z+offset+i*(depth+gap),w:length,d:depth}:{x:x+offset+i*(depth+gap),z:z+end,w:depth,d:length});
    rows.forEach(row=>{row.units=Array.from({length:cfg.unitsPerRow},(_,i)=>cfg.direction==='x'?{x:row.x,z:row.z+i*row.d/cfg.unitsPerRow,w:row.w,d:row.d/cfg.unitsPerRow}:{x:row.x+i*row.w/cfg.unitsPerRow,z:row.z,w:row.w/cfg.unitsPerRow,d:row.d});});
    return {rect:r,x,z,w,d,rows,direction:cfg.direction,gap,height:cfg.height,levels:cfg.levels,unitsPerRow:cfg.unitsPerRow};
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
  function wallFixtureLayout(f){
    // Preserve ver55 wall fixtures, including the vent anchor. This never places a workstation.
    // Ignore explicit desks so dragging one cannot move windows/AC/vent/duct.
    const pcs=f.rects.filter(r=>r.type!=='pcdesk'&&/PC|パソコン/i.test(r.label||'')&&r.y<=2);
    if(!pcs.length)return null;
    const W=f.cols*2,depth=4.5,preferred=(Math.min(...pcs.map(r=>r.x*2))+Math.max(...pcs.map(r=>(r.x+r.w)*2)))/2;
    const occupied=f.rects.filter(r=>r.y*2<depth+.5&&r.type!=='door'&&r.type!=='pcdesk').map(r=>[Math.max(.65,r.x*2-.35),Math.min(W-.65,(r.x+r.w)*2+.35)]).sort((a,b)=>a[0]-b[0]);
    // Door thresholds also remain empty even though doors are not navigation blockers.
    f.rects.filter(r=>r.type==='door'&&r.y*2<depth+.5).forEach(r=>occupied.push([r.x*2-.5,(r.x+r.w)*2+.5]));occupied.sort((a,b)=>a[0]-b[0]);
    let cursor=.65;const gaps=[];for(const [a,b] of occupied){if(a>cursor)gaps.push([cursor,a]);cursor=Math.max(cursor,b);}if(cursor<W-.65)gaps.push([cursor,W-.65]);
    const available=gaps.filter(g=>g[1]-g[0]>=3.8).sort((a,b)=>Math.abs((a[0]+a[1])/2-preferred)-Math.abs((b[0]+b[1])/2-preferred));
    const gap=available[0];
    const anchor=gap?Math.max(gap[0]+1.9,Math.min(gap[1]-1.9,preferred)):preferred;
    return {preferred,wall:'north',ventX:Math.max(1.25,Math.min(W-1.25,anchor-2.5))};
  }
  function officeLayout(f){
    // Only explicit map objects create workstations. Back points to the chosen map edge.
    return {desks:f.rects.filter(r=>r.type==='pcdesk'&&[r.x,r.y,r.w,r.h].every(Number.isFinite)&&r.w>0&&r.h>0).map(r=>{
      const back=['north','east','south','west'].includes(r.back)?r.back:'north';
      const turn=['north','east','south','west'].indexOf(back),width=turn%2?4.4:3.8,depth=turn%2?3.8:4.4;
      return {rect:r,x:(r.x+r.w/2)*2,z:(r.y+r.h/2)*2,angle:-turn*Math.PI/2,scale:Math.min(1,r.w*2/width,r.h*2/depth),back};
    })};
  }
  // The annex is a view extension: original rows/rectangles/part coordinates are retained.
  function annexLayout(f){
    if(f.annex===false)return null;
    let a=f.annex;
    if(!a){
      if(!f.rects.some(r=>r.type!=='pcdesk'&&/PC|パソコン/i.test(r.label||''))||!f.rects.some(r=>r.label==='棚番の品')||!f.rects.some(r=>r.type==='door'&&r.x<=1))return null;
      const taken=f.rects.filter(r=>r.type!=='pcdesk'&&r.y<f.rows&&r.y+r.h>=f.rows-.1).map(r=>[r.x,r.x+r.w]).sort((a,b)=>a[0]-b[0]);
      let left=0;const gaps=[];for(const [x,end] of taken){if(x-left>=2)gaps.push([left,x]);left=Math.max(left,end);}if(f.cols-left>=2)gaps.push([left,f.cols]);
      if(!gaps.length)return null;const gap=gaps[0],openingWidth=Math.min(2.5,gap[1]-gap[0]),openingX=gap[0];
      a={x:Math.max(0,openingX-2),width:Math.min(10,f.cols),depth:8,openingX,openingWidth};
    }
    if(!a||![a.x,a.width,a.depth,a.openingX,a.openingWidth].every(Number.isFinite))return null;
    const width=Math.max(3,Math.min(f.cols,a.width)),x=Math.max(0,Math.min(f.cols-width,a.x)),depth=Math.max(3,Math.min(40,a.depth));
    const openingWidth=Math.max(1,Math.min(width-.5,a.openingWidth)),openingX=Math.max(x+.25,Math.min(x+width-openingWidth-.25,a.openingX));
    return {x,y:f.rows,width,depth,openingX,openingWidth};
  }
  function planRows(f){return f.rows+(annexLayout(f)?.depth||0);}
  function insidePlan(f,x,y){const a=annexLayout(f);return x>=0&&x<f.cols&&y>=0&&(y<f.rows||(a&&y<f.rows+a.depth&&x>=a.x&&x<a.x+a.width));}
  function floorRegions(f){
    const cells=f.floorTiles||{},runs=[],active=new Map(),a=annexLayout(f),rows=planRows(f);
    for(let y=0;y<rows;y++){
      const next=new Map();let x=0;
      while(x<f.cols){const type=cells[x+','+y];if(!insidePlan(f,x,y)||!['green','concrete'].includes(type)){x++;continue;}
        const start=x++;while(x<f.cols&&insidePlan(f,x,y)&&cells[x+','+y]===type)x++;
        const key=start+':'+x+':'+type,old=active.get(key),r=old||{x:start,y,w:x-start,h:0,type};r.h++;if(!old)runs.push(r);next.set(key,r);
      }active.clear();next.forEach((v,k)=>active.set(k,v));
    }
    return (a?[{x:a.x,y:a.y,w:a.width,h:a.depth,type:'concrete'}]:[]).concat(runs);
  }
  function floorSVG(f,scale){
    let s=floorRegions(f).map(r=>'<rect x="'+r.x*scale+'" y="'+r.y*scale+'" width="'+r.w*scale+'" height="'+r.h*scale+'" fill="'+(r.type==='green'?'#63997b':'#b9b7b0')+'"/>').join('');
    const a=annexLayout(f);if(a){for(const r of [[0,a.y,a.x,a.depth],[a.x+a.width,a.y,f.cols-a.x-a.width,a.depth]])s+='<rect x="'+r[0]*scale+'" y="'+r[1]*scale+'" width="'+r[2]*scale+'" height="'+r[3]*scale+'" fill="#f0f2f3"/>';
      s+='<path d="M '+a.openingX*scale+' '+a.y*scale+' H '+a.x*scale+' V '+(a.y+a.depth)*scale+' H '+(a.x+a.width)*scale+' V '+a.y*scale+' H '+(a.openingX+a.openingWidth)*scale+'" fill="none" stroke="#59666b" stroke-width="3"/>';
    }return s;
  }
  function floorCanvas(g,f,k,ox=0,oy=0){
    g.fillStyle=f.floor==='gray'?'#cfd4d9':f.floor==='white'?'#fff':f.floor==='concrete'?'#b9b7b0':'#6d967b';g.fillRect(ox,oy,f.cols*k,planRows(f)*k);
    floorRegions(f).forEach(r=>{g.fillStyle=r.type==='green'?'#6d967b':'#b9b7b0';g.fillRect(ox+r.x*k,oy+r.y*k,r.w*k,r.h*k);});
    const a=annexLayout(f);if(a){g.fillStyle='#edf0ee';g.fillRect(ox,oy+a.y*k,a.x*k,a.depth*k);g.fillRect(ox+(a.x+a.width)*k,oy+a.y*k,(f.cols-a.x-a.width)*k,a.depth*k);g.strokeStyle='#59666b';g.lineWidth=2;g.beginPath();g.moveTo(ox+a.openingX*k,oy+a.y*k);g.lineTo(ox+a.x*k,oy+a.y*k);g.lineTo(ox+a.x*k,oy+(a.y+a.depth)*k);g.lineTo(ox+(a.x+a.width)*k,oy+(a.y+a.depth)*k);g.lineTo(ox+(a.x+a.width)*k,oy+a.y*k);g.lineTo(ox+(a.openingX+a.openingWidth)*k,oy+a.y*k);g.stroke();}
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
    const T=root.THREE,S=2,f=db.maps.floors[fi],W=f.cols*S,D=planRows(f)*S,baseD=f.rows*S,annex=annexLayout(f),HALL=9.6;
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
    const ground=f.floor==='concrete'?'#b9b7b0':f.floor==='gray'?'#929fa2':f.floor==='white'?'#ced5d4':'#647c69';
    const floorMaterial=kit?kit.floor(W,baseD,f.floor):mat(ground);
    const floor=new T.Mesh(new T.PlaneGeometry(W,baseD),floorMaterial);floor.rotation.x=-Math.PI/2;floor.position.set(W/2,.015,baseD/2);floor.receiveShadow=true;scene.add(floor);
    const mirror=kit&&f.floor!=='concrete'?kit.reflection(W,baseD):null;if(mirror)scene.add(mirror);
    const regions=floorRegions(f);regions.forEach((r,i)=>{const mesh=new T.Mesh(new T.PlaneGeometry(r.w*S,r.h*S),kit?kit.floor(r.w*S,r.h*S,r.type):mat(r.type==='green'?'#647c69':'#b9b7b0'));mesh.name='floor-region';mesh.userData.surface=r.type;mesh.rotation.x=-Math.PI/2;mesh.position.set((r.x+r.w/2)*S,.04+i*.00001,(r.y+r.h/2)*S);mesh.receiveShadow=true;scene.add(mesh);});
    box(-.35,-.35,W+.7,baseD+.7,-.6,.45,'#6b726d');
    const panelMat=kit?kit.painted(1,1,'#e9ebe6'):mat('#c6c6bd');
    const wallMat=kit?kit.painted(1,1.7,'#e3e7e5'):mat('#d7d5c9');
    const pipeMat=mat('#878d8b',.68),pipeGeo=new T.CylinderGeometry(1,1,1,10),pipeInstances=[];
    function pipe(ax,ay,az,bx,by,bz,r){const a=new T.Vector3(ax,ay,az),b=new T.Vector3(bx,by,bz),v=b.clone().sub(a),o=new T.Object3D();o.position.copy(a).add(b).multiplyScalar(.5);o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),v.clone().normalize());o.scale.set(r,v.length(),r);o.updateMatrix();pipeInstances.push(o.matrix.clone());}
    const lampPositions=[],lampPool=[];
    if(opts.walk){
      // Panel-sized wall pieces keep texture scale consistent in differently sized maps.
      for(let z=0;z<baseD;z+=6){box(-.18,z,.18,Math.min(6,baseD-z),0,HALL,wallMat);box(W,z,.18,Math.min(6,baseD-z),0,HALL,wallMat);}
      for(let x=0;x<W;x+=6){box(x,-.18,Math.min(6,W-x),.18,0,HALL,wallMat);if(!annex)box(x,baseD,Math.min(6,W-x),.18,0,HALL,wallMat);}
      const ceiling=new T.Mesh(new T.PlaneGeometry(W,baseD),kit?kit.painted(W/6,baseD/6):panelMat);ceiling.rotation.x=Math.PI/2;ceiling.position.set(W/2,HALL,baseD/2);scene.add(ceiling);
      for(let z=0;z<baseD;z+=4.8)box(0,z,W,.023,HALL-.015,.014,'#66695f');
      for(let x=0;x<W;x+=2.4)box(x,0,.02,baseD,HALL-.018,.014,'#73756a');
      // Existing surface conduit, hangers and twin-tube fluorescent housings.
      const glow=new T.MeshBasicMaterial({color:'#eff9ff',toneMapped:false});
      for(let z=3;z<baseD;z+=12){
        pipe(0,HALL-.55,z,W,HALL-.55,z,.065);
        for(let x=4;x<W;x+=12){
          box(x-.13,z-.44,3.8,.88,HALL-.54,.13,panelMat);
          box(x,z-.4,.18,.8,HALL-.8,.3,panelMat);box(x+3.4,z-.4,.18,.8,HALL-.8,.3,panelMat);
          for(const dz of [-.23,.23]){const tube=new T.Mesh(new T.CylinderGeometry(.085,.085,3.3,12),glow);tube.rotation.z=Math.PI/2;tube.position.set(x+1.8,HALL-.76,z+dz);scene.add(tube);}
          lampPositions.push(new T.Vector3(x+1.7,HALL-.98,z));
          pipe(x+1.7,HALL-.25,z-.5,x+1.7,HALL-.65,z-.5,.025);
        }
      }
      for(let x=2;x<W;x+=16){pipe(x,HALL-.18,0,x,HALL-.18,baseD,.037);for(let z=2;z<baseD;z+=6)box(x-.08,z,.16,.08,HALL-.3,.25,'#73766f',.35);}
      // A fixed-size light pool follows the nearest fixtures, keeping mobile shader cost bounded.
      for(let i=0;i<Math.min(6,lampPositions.length);i++){const l=new T.PointLight('#f4f8ff',.8,23,1.4);scene.add(l);lampPool.push(l);}
    }
    const contactMat=kit?new T.MeshBasicMaterial({map:kit.contactMap(),transparent:true,depthWrite:false,color:'#000000',opacity:.62}):null;
    const contacts=[];
    function contact(x,z,w,d){if(contactMat)contacts.push([x+w/2,z+d/2,w+.65,d+.65]);}
    const blockers=[], heightRects=[], pickZones=[],shelfLayouts=[];
    if(annex){
      const a=annex,x=a.x*S,w=a.width*S,z=baseD,d=a.depth*S,entry=a.openingX*S,ew=a.openingWidth*S;
      // The original south wall has one real opening; all space outside the new room stays blocked.
      blockers.push([0,z-.18,entry,z+.18],[entry+ew,z-.18,W,z+.18]);
      if(x>0)blockers.push([0,z,x,D]);if(x+w<W)blockers.push([x+w,z,W,D]);
      blockers.push([x-.18,z,x+.08,D],[x+w-.08,z,x+w+.18,D]);
      box(x-.18,z-.18,w+.36,d+.36,-.6,.45,'#6b726d');
      if(opts.walk){
        for(let wx=0;wx<W;wx+=6){const end=Math.min(W,wx+6);box(wx,z,Math.min(end,entry)-wx,.18,0,HALL,wallMat);const right=Math.max(wx,entry+ew);box(right,z,end-right,.18,0,HALL,wallMat);}
        box(entry,z,ew,.18,7.8,HALL-7.8,wallMat);
        for(let dz=0;dz<d;dz+=6){box(x-.18,z+dz,.18,Math.min(6,d-dz),0,HALL,wallMat);box(x+w,z+dz,.18,Math.min(6,d-dz),0,HALL,wallMat);}for(let dx=0;dx<w;dx+=6)box(x+dx,z+d,Math.min(6,w-dx),.18,0,HALL,wallMat);
        // Metal jambs and lintel match the open internal doorway in photo 6339.
        box(entry-.10,z-.08,.10,.33,0,7.85,'#727d7d',.6);box(entry+ew,z-.08,.10,.33,0,7.85,'#727d7d',.6);box(entry-.10,z-.08,ew+.20,.33,7.75,.15,'#727d7d',.6);
        const roof=new T.Mesh(new T.PlaneGeometry(w,d),kit?kit.painted(w/6,d/6):panelMat);roof.name='annex-ceiling';roof.rotation.x=Math.PI/2;roof.position.set(x+w/2,HALL,z+d/2);scene.add(roof);
        for(let rz=z;rz<D;rz+=4.8)box(x,rz,w,.023,HALL-.015,.014,'#66695f');
        for(let rx=x;rx<x+w;rx+=2.4)box(rx,z,.02,d,HALL-.018,.014,'#73756a');
        const glow=new T.MeshBasicMaterial({color:'#eff9ff',toneMapped:false});
        for(let rz=z+3;rz<D;rz+=7){const cx=x+w/2;box(cx-1.9,rz-.44,3.8,.88,HALL-.54,.13,panelMat);for(const dz of [-.23,.23]){const tube=new T.Mesh(new T.CylinderGeometry(.085,.085,3.3,12),glow);tube.rotation.z=Math.PI/2;tube.position.set(cx,HALL-.76,rz+dz);scene.add(tube);}lampPositions.push(new T.Vector3(cx,HALL-.98,rz));pipe(cx,HALL-.2,rz,cx,HALL-.65,rz,.04);}
      }else{box(x-.18,z,.18,d,0,.5,wallMat);box(x+w,z,.18,d,0,.5,wallMat);box(x,z+d,w,.18,0,.5,wallMat);}
    }
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
      layout.rows.forEach(pair=>{
        contact(pair.x,pair.z,pair.w,pair.d);
        pair.units.forEach(row=>{
        const L=alongX?row.w:row.d,B=alongX?row.d:row.w,bays=Math.max(1,Math.ceil(L/6.4)),bay=L/bays;
        function piece(u,v,a,b,y,h,col,metal=.38){if(alongX)box(row.x+u,row.z+v,a,b,y,h,col,metal);else box(row.x+v,row.z+u,b,a,y,h,col,metal);}
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
        });
        blockers.push([pair.x,pair.z,pair.x+pair.w,pair.z+pair.d]);
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
    function parkedLift(x,z,w,d,rect){
      const lift=new T.Group();lift.name='warehouse-lift';lift.userData={rectId:rect.id,fixture:'parked-lift',label:rect.label};
      const yellow=mat('#d9ad12',.16),edgeYellow=mat('#ba9015',.18),steel=mat('#303738',.48),rubber=mat('#131817',.05),silver=mat('#87908f',.72),dark=mat('#202625',.12);
      const parts=new Map();
      function block(px,py,pz,a,b,c,m){if(!parts.has(m))parts.set(m,[]);parts.get(m).push([px,py,pz,a,b,c]);}
      function mesh(geometry,m,px=0,py=0,pz=0){const item=new T.Mesh(geometry,m);item.position.set(px,py,pz);lift.add(item);return item;}
      function rod(a,b,r,m){const p=new T.Vector3(...a),q=new T.Vector3(...b),v=q.clone().sub(p);const item=mesh(new T.CylinderGeometry(r,r,v.length(),10),m);item.position.copy(p).add(q).multiplyScalar(.5);item.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),v.normalize());return item;}
      function profile(shape,depth,m,z0,bevel=.04){return mesh(new T.ExtrudeGeometry(shape,{depth,bevelEnabled:bevel>0,bevelSize:bevel,bevelThickness:bevel,bevelSegments:3,steps:1,curveSegments:12}),m,0,0,z0);}
      // Standing reach truck: curved side panels, open operator well, no seat or load.
      const body=new T.Shape();body.moveTo(.2,.38);body.quadraticCurveTo(-.22,.38,-.3,.95);body.lineTo(-.3,3.35);body.quadraticCurveTo(-.2,4.2,.5,4.25);body.lineTo(2.15,4.25);body.quadraticCurveTo(2.5,4.2,2.5,3.75);body.lineTo(2.5,.78);body.quadraticCurveTo(2.47,.38,2.12,.38);body.closePath();
      profile(body,.12,yellow,-1.08,.08);profile(body,.12,yellow,.96,.08);
      block(2.35,2.22,0,.26,3.42,2.02,yellow);block(1.08,.58,0,2.63,.3,2.03,edgeYellow);block(1.05,.78,0,2.42,.12,1.8,rubber);
      block(.05,1.05,0,.22,1.04,1.8,steel);block(1.6,3.87,0,1.18,.35,1.84,dark);
      rod([.42,4.29,-1.01],[2.27,4.29,-1.01],.075,dark);rod([.42,4.29,1.01],[2.27,4.29,1.01],.075,dark);
      // Low outriggers and wheels. Fork tips point to local -X.
      for(const zz of [-.88,.88]){
        block(-1.05,.45,zz,2.85,.43,.36,yellow);
        const wheel=mesh(new T.CylinderGeometry(.43,.43,.44,24),rubber,-1.96,.46,zz);wheel.rotation.x=Math.PI/2;
        for(const side of [-1,1]){const hub=mesh(new T.CylinderGeometry(.26,.26,.025,20),steel,-1.96,.46,zz+side*.232);hub.rotation.x=Math.PI/2;}
      }
      const rearWheel=mesh(new T.CylinderGeometry(.43,.43,.64,24),rubber,1.92,.46,0);rearWheel.rotation.x=Math.PI/2;
      for(const zz of [-.59,.59]){
        const fork=new T.Shape();fork.moveTo(-3.25,.13);fork.lineTo(-.8,.13);fork.lineTo(-.8,2.44);fork.lineTo(-.98,2.44);fork.lineTo(-.98,.31);fork.lineTo(-3.25,.23);fork.closePath();profile(fork,.24,steel,zz-.12,.018);
      }
      // Twin mast channels, central hydraulic ram, carriage and restrained cross bars.
      for(const zz of [-.85,.85]){block(-.69,3.91,zz,.36,6.55,.24,steel);block(-.44,3.75,zz,.12,6.08,.09,silver);}
      block(-.69,7.16,0,.4,.18,1.94,steel);block(-.69,2.58,0,.42,.16,1.94,steel);
      rod([-.69,.83,0],[-.69,5.86,0],.12,dark);rod([-.69,2.2,0],[-.69,6.62,0],.065,silver);
      block(-.91,1.71,0,.15,1.81,1.72,dark);
      for(const zz of [-.66,-.33,0,.33,.66])block(-1.025,1.85,zz,.045,1.15,.045,steel);
      // The photo's curved overhead guard is a C profile on each side.
      const guard=new T.Shape();guard.moveTo(.12,4.24);guard.lineTo(-.1,5.35);guard.lineTo(-.1,6.8);guard.quadraticCurveTo(-.06,7.42,.48,7.45);guard.lineTo(2.53,7.45);guard.lineTo(2.57,7.79);guard.lineTo(.22,7.79);guard.quadraticCurveTo(-.56,7.79,-.6,6.98);guard.lineTo(-.58,5.25);guard.lineTo(-.28,4.14);guard.closePath();
      profile(guard,.13,steel,-1.05,.045);profile(guard,.13,steel,.92,.045);
      for(let xx=.28;xx<2.52;xx+=.28)block(xx,7.49,0,.09,.11,1.96,dark);
      block(2.48,7.6,0,.14,.24,2.12,steel);block(.1,7.6,0,.13,.24,2.12,steel);
      // Small controls and amber lamp; no changes to the warehouse lighting.
      rod([.16,3.05,.2],[.45,5.13,.2],.045,dark);
      const steering=mesh(new T.TorusGeometry(.22,.033,8,20),dark,.45,5.15,.2);steering.rotation.y=.35;
      rod([.45,4.96,.2],[.45,5.34,.2],.02,dark);rod([.27,5.15,.27],[.63,5.15,.13],.02,dark);
      rod([1.91,4.05,-.56],[1.91,4.52,-.56],.033,steel);mesh(new T.SphereGeometry(.085,10,8),rubber,1.91,4.55,-.56);
      block(1.96,7.37,.72,.34,.06,.32,steel);block(1.96,6.81,.72,.34,.06,.32,steel);
      for(const xx of [1.81,2.11])block(xx,7.09,.72,.04,.56,.32,steel);
      const amber=new T.MeshStandardMaterial({color:'#c77b15',roughness:.35,metalness:.15,emissive:'#a65b07',emissiveIntensity:.2});
      mesh(new T.CylinderGeometry(.09,.115,.37,16),amber,1.96,7.1,.72);
      // Painted "09" and light scuffs are deterministic Canvas decals, not stock photos.
      const decal=document.createElement('canvas');decal.width=512;decal.height=768;const ctx=decal.getContext('2d');
      ctx.font='italic 900 118px sans-serif';ctx.textAlign='center';ctx.lineWidth=8;ctx.strokeStyle='#273231';ctx.fillStyle='#edece0';ctx.strokeText('09',260,170);ctx.fillText('09',260,170);
      let seed=9;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
      for(let i=0;i<95;i++){const sx=random()*512,sy=220+random()*548;ctx.strokeStyle=i%3?'#48473525':'#f4e08a45';ctx.lineWidth=.6+random();ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(sx+3+random()*28,sy+random()*3);ctx.stroke();}
      const decalMap=new T.CanvasTexture(decal);decalMap.encoding=T.sRGBEncoding;
      const decalMat=new T.MeshStandardMaterial({map:decalMap,transparent:true,depthWrite:false,roughness:.7,polygonOffset:true,polygonOffsetFactor:-1});
      for(const side of [-1,1]){const paint=mesh(new T.PlaneGeometry(2.42,3.38),decalMat,1.11,2.36,side*1.165);if(side<0)paint.rotation.y=Math.PI;}
      // Panel seams and small fasteners give the side a painted-metal finish.
      for(const side of [-1,1]){block(2.1,2.07,side*1.153,.018,2.85,.015,edgeYellow);for(const y of [1.65,3.7]){const screw=mesh(new T.CylinderGeometry(.048,.048,.02,8),silver,.3,y,side*1.161);screw.rotation.x=Math.PI/2;}}
      parts.forEach((instances,material)=>{const batch=new T.InstancedMesh(geom,material,instances.length),o=new T.Object3D();instances.forEach((a,i)=>{o.position.set(a[0],a[1],a[2]);o.scale.set(a[3],a[4],a[5]);o.updateMatrix();batch.setMatrixAt(i,o.matrix);});batch.frustumCulled=false;lift.add(batch);});
      // Fit the whole parked truck (including lowered forks) within the existing rectangle.
      lift.rotation.y=d>w?Math.PI/2:0;lift.updateMatrixWorld(true);
      // r128 Box3 does not expand InstancedMesh transforms. Include each instance explicitly.
      const bounds=new T.Box3(),instance=new T.Matrix4();
      lift.traverse(o=>{if(!o.geometry)return;o.geometry.computeBoundingBox();
        if(o.isInstancedMesh){for(let i=0;i<o.count;i++){o.getMatrixAt(i,instance);bounds.union(o.geometry.boundingBox.clone().applyMatrix4(new T.Matrix4().multiplyMatrices(o.matrixWorld,instance)));}}
        else bounds.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));
      });
      const size=bounds.getSize(new T.Vector3()),center=bounds.getCenter(new T.Vector3());
      const scale=Math.min(1,Math.max(.01,w-.12)/size.x,Math.max(.01,d-.12)/size.z);
      lift.scale.setScalar(scale);lift.position.set(x+w/2-center.x*scale,.035-bounds.min.y*scale,z+d/2-center.z*scale);
      scene.add(lift);contact(x,z,w,d);return size.y*scale+.035;
    }
    let warmLights=0;
    f.rects.forEach(r=>{
      if(r.type==='pcdesk')return;
      const x=r.x*S+.06,z=r.y*S+.06,w=r.w*S-.12,d=r.h*S-.12;
      const shelves=shelfLayout(r),isLift=!r.type&&['リフト','フォークリフト'].includes(String(r.label||'').replace(/\s/g,''));
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
        border(x,z,w,d,'#b6a24c',.03,.08);if(!shelves&&!isLift)contact(x,z,w,d);
        // Preserve explicit shapes; summarized shelf areas stay a single region.
        const style=r.view3d || (r.pal?'pallet':'shelf');
        if(isLift){H=parkedLift(x,z,w,d,r);}
        else if(shelves){H=shelves.height;steelShelves(shelves);shelfLayouts.push(shelves);}
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
    const office=officeLayout(f),fixtures=wallFixtureLayout(f);
    if(fixtures||office.desks.length){
      const equipment=new T.Group();equipment.name='warehouse-office';equipment.userData.plan=office;scene.add(equipment);
      const metal=mat('#a5a8a3',.48),black=mat('#282d2d',.18),cream=mat('#d6d4c9',.06),wood=mat('#a59b7f',.04),blue=mat('#597181',.02);
      function component(name){const group=new T.Group();group.name=name;equipment.add(group);const batches=new Map();
        function block(x,y,z,w,h,d,m){if(!batches.has(m))batches.set(m,[]);batches.get(m).push([x,y,z,w,h,d]);}
        function mesh(geometry,m,x,y,z){const o=new T.Mesh(geometry,m);o.position.set(x,y,z);group.add(o);return o;}
        function rod(a,b,r,m){const p=new T.Vector3(...a),q=new T.Vector3(...b),v=q.clone().sub(p);const o=mesh(new T.CylinderGeometry(r,r,v.length(),10),m,0,0,0);o.position.copy(p).add(q).multiplyScalar(.5);o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),v.normalize());return o;}
        function rounded(x,y,z,w,h,d,m){const s=new T.Shape(),r=Math.min(.14,w/5,h/5),a=-w/2,b=-h/2;s.moveTo(a+r,b);s.lineTo(-a-r,b);s.quadraticCurveTo(-a,b,-a,b+r);s.lineTo(-a,-b-r);s.quadraticCurveTo(-a,-b,-a-r,-b);s.lineTo(a+r,-b);s.quadraticCurveTo(a,-b,a,-b-r);s.lineTo(a,b+r);s.quadraticCurveTo(a,b,a+r,b);return mesh(new T.ExtrudeGeometry(s,{depth:d,bevelEnabled:true,bevelSize:.035,bevelThickness:.035,bevelSegments:2,curveSegments:8,steps:1}),m,x,y,z-d/2);}
        function done(){batches.forEach((items,m)=>{const batch=new T.InstancedMesh(geom,m,items.length),o=new T.Object3D();items.forEach((a,i)=>{o.position.set(a[0],a[1],a[2]);o.scale.set(a[3],a[4],a[5]);o.updateMatrix();batch.setMatrixAt(i,o.matrix);});batch.frustumCulled=false;group.add(batch);});}
        return {group,block,mesh,rod,rounded,done};
      }
      function canvasMaterial(draw,width=512,height=256){const c=document.createElement('canvas');c.width=width;c.height=height;draw(c.getContext('2d'),width,height);const t=new T.CanvasTexture(c);t.encoding=T.sRGBEncoding;return new T.MeshStandardMaterial({map:t,roughness:.83,emissive:'#b6b3a7',emissiveIntensity:.1});}
      if(fixtures){
      const glass=canvasMaterial((g,w,h)=>{g.fillStyle='#c5d5db';g.fillRect(0,0,w,h);g.filter='blur(2px)';g.fillStyle='#e5e6e3';g.fillRect(0,h*.1,w*.57,h);g.fillStyle='#d0d6d5';g.fillRect(w*.59,h*.2,w*.41,h);g.fillStyle='#aebbc0';for(let i=0;i<7;i++)g.fillRect(i*w/7,h*.3,3,h*.7);g.fillStyle='#b2bdc2';g.fillRect(w*.1,h*.45,w*.32,h*.3);g.fillStyle='#e0e4e4';g.fillRect(w*.12,h*.48,w*.28,h*.23);g.filter='none';});
      const exclusions=f.rects.filter(r=>['wall','shut','door'].includes(r.type)&&r.y<1);
      for(const [ratio,wr,blinds] of [[.16,.14,false],[.32,.15,false],[.66,.18,true],[.91,.1,false]]){
        const cx=W*ratio,width=Math.min(9,W*wr),left=cx-width/2,right=cx+width/2;
        if(left<.3||right>W-.3||exclusions.some(r=>left<(r.x+r.w)*2&&right>r.x*2))continue;
        const c=component('office-window');c.block(cx,5.8,.095,width,3.8,.12,black);c.block(cx,5.8,.17,width-.23,3.57,.055,glass);
        for(const px of [left,cx,right])c.block(px,5.8,.23,.085,3.88,.18,metal);for(const py of [3.89,7.71])c.block(cx,py,.25,width+.12,.095,.21,metal);
        c.block(cx,3.86,.39,width+.24,.105,.7,cream);c.block(cx+.12,5.53,.37,.055,.42,.09,black);
        if(blinds){for(let yy=4.07;yy<7.58;yy+=.145)c.block(cx,yy,.275,width-.3,.027,.03,mat('#bdc5c3'));c.rod([right-.24,7.61,.34],[right-.24,4.07,.34],.009,black);}
        c.done();
      }
      for(const cx of [Math.max(2.8,W*.065),Math.min(W-3.7,W*.88)]){
        if(exclusions.some(r=>cx-2.5<(r.x+r.w)*2&&cx+2.5>r.x*2))continue;
        const a=component('office-air-conditioner');a.rounded(cx,8.62,.48,5.3,.95,.83,cream);a.block(cx,8.33,.935,4.8,.24,.045,black);
        for(let yy=8.25;yy<8.47;yy+=.06)a.block(cx,yy,.966,4.72,.022,.045,metal);
        a.block(cx+2.03,8.6,.94,.08,.035,.013,mat('#548561'));a.done();
      }
      const ventX=fixtures.ventX;
      const v=component('office-vent-and-duct');v.block(ventX,7.25,.22,1.8,1.8,.26,wood);v.block(ventX,7.25,.38,1.58,1.58,.1,black);
      for(let i=0;i<4;i++){const a=i*Math.PI/2;const blade=v.mesh(new T.SphereGeometry(1,12,8),metal,ventX+Math.sin(a)*.27,7.25+Math.cos(a)*.27,.49);blade.scale.set(.18,.46,.055);blade.rotation.z=-a+.35;}
      for(const r of [.22,.43,.64,.74])v.mesh(new T.TorusGeometry(r,.016,6,32),black,ventX,7.25,.58);
      for(let i=0;i<6;i++){const a=i*Math.PI/3;v.rod([ventX+Math.cos(a)*.73,7.25+Math.sin(a)*.73,.595],[ventX-Math.cos(a)*.73,7.25-Math.sin(a)*.73,.595],.009,black);}
      const duct=new T.CatmullRomCurve3([new T.Vector3(ventX,7.25,.62),new T.Vector3(ventX,6.68,1.1),new T.Vector3(ventX-.2,5.9,1.24),new T.Vector3(ventX-.8,4.9,.88)]);
      v.mesh(new T.TubeGeometry(duct,24,.26,12,false),mat('#9ca7aa',.25),0,0,0);v.done();
      }
      for(const desk of office.desks){
        const cx=0,cz=1.35,w=3.4,d=2,c=component('office-workstation');
        const anchor=new T.Group();anchor.name='placed-pc-desk';anchor.userData.rectId=desk.rect.id;anchor.userData.back=desk.back;equipment.add(anchor);anchor.add(c.group);c.group.position.z=-2.2;anchor.position.set(desk.x,0,desk.z);anchor.rotation.y=desk.angle;anchor.scale.set(desk.scale,1,desk.scale);
        c.block(cx,2.86,cz,w,.14,d,wood);c.block(cx,2.72,cz,w,.14,d-.1,metal);
        for(const xx of [cx-w/2+.13,cx+w/2-.13])for(const zz of [cz-d/2+.13,cz+d/2-.13])c.block(xx,1.38,zz,.095,2.68,.095,metal);
        for(const xx of [cx-w/2+.13,cx+w/2-.13])c.block(xx,.36,cz,.075,.065,d-.15,metal);
        // Monitor, stand and generic screen: no invented part codes or copied private screen data.
        c.block(cx,2.99,cz-.18,.78,.07,.5,black);c.block(cx,3.22,cz-.34,.095,.48,.11,black);c.rounded(cx,3.99,cz-.39,2.18,1.4,.13,black);
        const screen=canvasMaterial((g,w,h)=>{g.fillStyle='#e1d5b9';g.fillRect(0,0,w,h);g.fillStyle='#b7c0b5';g.fillRect(0,0,w,25);g.fillStyle='#eae4d7';g.fillRect(8,33,w-16,h-42);g.fillStyle='#d1cabb';for(let yy=45;yy<h-15;yy+=20)g.fillRect(14,yy,w-28,1);for(let xx=30;xx<w;xx+=85)g.fillRect(xx,35,1,h-47);g.fillStyle='#aaa99a';for(let yy=50;yy<h-15;yy+=20){g.fillRect(18,yy,40,3);g.fillRect(108,yy,60,3);}});
        c.mesh(new T.PlaneGeometry(2.02,1.23),screen,cx,4.01,cz-.278);
        c.block(cx-.22,2.99,cz+.57,1.6,.065,.49,black);
        for(let row=0;row<4;row++)for(let col=0;col<13;col++)c.block(cx-.9+col*.107,3.03,cz+.39+row*.1,.083,.016,.069,mat('#747b77'));
        const mouse=c.mesh(new T.SphereGeometry(1,12,8),black,cx+1,3.015,cz+.56);mouse.scale.set(.14,.07,.21);
        c.block(cx-1.12,1.29,cz-.03,.73,2.07,1.27,mat('#6b7370',.2));c.block(cx-1.12,1.83,cz+.625,.56,.3,.028,black);
        for(let yy=.55;yy<1.4;yy+=.1)c.block(cx-1.12,yy,cz+.622,.49,.022,.017,black);
        // Blue padded swivel chair with five feet and casters.
        const chairZ=cz+2.08,seat=c.mesh(new T.SphereGeometry(1,20,12),blue,cx,1.68,chairZ);seat.scale.set(.74,.15,.67);
        c.rounded(cx,2.68,chairZ+.46,1.3,1.12,.18,blue);c.rod([cx,1.05,chairZ],[cx,1.57,chairZ],.09,metal);c.rod([cx,1.55,chairZ+.29],[cx,2.59,chairZ+.5],.055,black);
        for(let i=0;i<5;i++){const a=i*Math.PI*2/5,xx=cx+Math.cos(a)*.71,zz=chairZ+Math.sin(a)*.71;c.rod([cx,.49,chairZ],[xx,.2,zz],.05,black);const wheel=c.mesh(new T.CylinderGeometry(.12,.12,.15,12),black,xx,.15,zz);wheel.rotation.x=Math.PI/2;}
        c.rod([cx,.31,chairZ],[cx,1.11,chairZ],.095,black);
        // Back desk uprights and a small task-light fitting, as seen in the reference.
        for(const xx of [cx-1.6,cx+1.6])c.block(xx,4.52,.45,.065,4.67,.065,metal);c.block(cx,6.84,.45,3.3,.09,.12,metal);
        c.block(cx,6.56,.64,2.3,.11,.32,cream);c.block(cx,6.49,.65,2.15,.035,.22,new T.MeshBasicMaterial({color:'#e1e6d8'}));
        const cable=new T.CatmullRomCurve3([new T.Vector3(cx+.4,3.64,cz-.47),new T.Vector3(cx+.63,3.08,cz-.58),new T.Vector3(cx+.44,2.66,cz-.55),new T.Vector3(cx-.84,1.75,cz-.3)]);c.mesh(new T.TubeGeometry(cable,18,.018,6,false),black,0,0,0);
        c.done();
        const r=desk.rect;blockers.push([r.x*S,r.y*S,(r.x+r.w)*S,(r.y+r.h)*S]);
        heightRects.push({x:r.x*S,z:r.y*S,w:r.w*S,d:r.h*S,h:3});
        const hit=new T.Mesh(new T.BoxGeometry(r.w*S,3,r.h*S),new T.MeshBasicMaterial({visible:false}));hit.position.set(desk.x,1.5,desk.z);hit.userData.rect=r;scene.add(hit);pickZones.push(hit);
        const shadow=new T.Mesh(new T.PlaneGeometry(w+.3,4.15),contactMat||new T.MeshBasicMaterial({color:'#000000',transparent:true,opacity:.14,depthWrite:false}));shadow.rotation.x=-Math.PI/2;shadow.position.set(0,.032,.09);anchor.add(shadow);
      }
    }
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
    return {scene,blockers,heightAt,marks,pickZones,W,D,annex,records,markGroup,shelfLayouts,office,updateCamera,setReflections:on=>{if(mirror)mirror.visible=on;},hasReflections:!!mirror};

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
  root.Warehouse3D={locations,find,materialize,createWorld,overview,configure,dispose,norm,label,shelfLayout,shelfSettings,officeLayout,wallFixtureLayout,annexLayout,planRows,insidePlan,floorRegions,floorSVG,floorCanvas};
})(window);
