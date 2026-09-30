/* ver57 additions: photo-referenced empty carts, material rooms, door-side extinguishers.
   All dimensions below are drawing units (2 units = 1 map cell), not measured sizes. */
(function(root){
  'use strict';
  const dirs=['north','east','south','west'];
  function cartLayout(r){
    if(r.type!=='cartbay'||![r.x,r.y,r.w,r.h].every(Number.isFinite)||r.w<=0||r.h<=0)return null;
    const turn=((Number(r.cartTurn)||0)%4+4)%4,rotated=turn%2;
    const x=r.x*2,z=r.y*2,w=r.w*2,d=r.h*2,pad=.16,gap=.22;
    const cw=rotated?1.72:3.32,cd=rotated?3.32:1.72;
    const scale=Math.min(1,Math.max(.1,w-2*pad)/cw,Math.max(.1,d-2*pad)/cd);
    const fw=cw*scale,fd=cd*scale;
    const nx=Math.max(1,Math.floor((w-2*pad+gap)/(fw+gap))),nz=Math.max(1,Math.floor((d-2*pad+gap)/(fd+gap)));
    const ox=(w-(nx*fw+(nx-1)*gap))/2,oz=(d-(nz*fd+(nz-1)*gap))/2,carts=[];
    for(let i=0;i<nx;i++)for(let j=0;j<nz;j++)carts.push({x:x+ox+fw/2+i*(fw+gap),z:z+oz+fd/2+j*(fd+gap),angle:turn*Math.PI/2,scale});
    return {x,z,w,d,carts};
  }
  function isMaterialRoom(r){return !r.type&&String(r.label||'').replace(/\s/g,'')==='資材';}
  function materialRoomLayout(r,f){
    if(!isMaterialRoom(r)||r.w<=0||r.h<=0)return null;
    const x=r.x*2+.06,z=r.y*2+.06,w=r.w*2-.12,d=r.h*2-.12;
    const doorWidth=Math.min(3.4,Math.max(.6,w-.44)),maxOffset=Math.max(0,(w-doorWidth)/2-.12);
    // Default to the widest gap in the immediately adjacent front pallet row.
    const intervals=f.rects.filter(q=>q!==r&&!q.type&&(q.pal||q.view3d==='pallet')&&q.y>=r.y+r.h-.1&&q.y<=r.y+r.h+2.1)
      .map(q=>[Math.max(x,q.x*2),Math.min(x+w,(q.x+q.w)*2)]).filter(q=>q[1]>q[0]).sort((a,b)=>a[0]-b[0]);
    let cursor=x,gaps=[];for(const [a,b] of intervals){if(a>cursor)gaps.push([cursor,a]);cursor=Math.max(cursor,b);}if(cursor<x+w)gaps.push([cursor,x+w]);
    gaps=gaps.filter(g=>g[1]-g[0]>=doorWidth+.24).sort((a,b)=>(b[1]-b[0])-(a[1]-a[0]));
    const defaultCenter=gaps.length?(gaps[0][0]+gaps[0][1])/2:x+w/2;
    const value=r.materialRoom?.doorOffset,offset=Number.isFinite(value)?value*2:defaultCenter-x-w/2;
    const center=x+w/2+Math.max(-maxOffset,Math.min(maxOffset,offset));
    return {x,z,w,d,height:9.6,doorWidth,doorX:center-doorWidth/2,doorOffset:(center-x-w/2)/2,maxOffset:maxOffset/2};
  }
  function doorAnchor(r,W,D){
    const x=r.x*2+.06,z=r.y*2+.06,w=r.w*2-.12,d=r.h*2-.12,alongX=w>=d,span=Math.min(3.4,alongX?w:d);
    let plane=alongX?z+d/2:x+w/2;
    if(alongX){if(z<.2)plane=.08;else if(z+d>D-.2)plane=D-.08;}
    else{if(x<.2)plane=.08;else if(x+w>W-.2)plane=W-.08;}
    const front=alongX?(plane>D/2?'south':'north'):(plane<W/2?'west':'east');
    return {x:alongX?x+w/2:plane,z:alongX?plane:z+d/2,angle:-dirs.indexOf(front)*Math.PI/2,span,front};
  }
  function builder(T,name){
    const group=new T.Group();group.name=name;
    const geometries={box:new T.BoxGeometry(1,1,1),rod:new T.CylinderGeometry(1,1,1,10),wheel:new T.CylinderGeometry(1,1,1,20),ball:new T.SphereGeometry(1,12,8)};
    const batches=new Map(),cache=new Map(),o=new T.Object3D();
    function mat(c,metal=0){const key=c+':'+metal;if(!cache.has(key))cache.set(key,new T.MeshStandardMaterial({color:new T.Color(c).convertSRGBToLinear(),metalness:metal,roughness:metal?.34:.78}));return cache.get(key);}
    function add(type,m,x,y,z,sx,sy,sz,q){const key=type+':'+m.uuid;if(!batches.has(key))batches.set(key,{type,m,items:[]});o.position.set(x,y,z);o.scale.set(sx,sy,sz);o.quaternion.identity();if(q)o.quaternion.copy(q);o.updateMatrix();batches.get(key).items.push(o.matrix.clone());}
    function box(x,y,z,w,h,d,m){add('box',m,x,y,z,w,h,d);}
    function rod(a,b,r,m){const p=new T.Vector3(...a),v=new T.Vector3(...b).sub(p),c=p.clone().addScaledVector(v,.5);add('rod',m,c.x,c.y,c.z,r,v.length(),r,new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),v.normalize()));}
    function finish(){batches.forEach(({type,m,items})=>{const mesh=new T.InstancedMesh(geometries[type],m,items.length);items.forEach((a,i)=>mesh.setMatrixAt(i,a));mesh.frustumCulled=false;mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);});Object.entries(geometries).forEach(([key,g])=>{if(![...batches.values()].some(b=>b.type===key))g.dispose();});return group;}
    return {group,mat,add,box,rod,finish};
  }
  function createCartBay(T,r){
    const layout=cartLayout(r),b=builder(T,'cart-bay'),chrome=b.mat('#c8cdcd',.78),black=b.mat('#232628'),rubber=b.mat('#1e2224'),hub=b.mat('#9caaaa',.56);
    b.group.userData={rectId:r.id,cartCount:layout.carts.length};
    const wheelQ=new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),Math.PI/2);
    for(const cart of layout.carts){
      const ca=Math.cos(cart.angle),sa=Math.sin(cart.angle),s=cart.scale;
      const p=(x,y,z)=>[cart.x+(ca*x+sa*z)*s,y*s,cart.z+(-sa*x+ca*z)*s];
      const rod=(a,c,r,m)=>b.rod(p(...a),p(...c),r*s,m);
      const box=(x,y,z,w,h,d,m)=>{const a=p(x,y,z);b.add('box',m,...a,w*s,h*s,d*s,new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),cart.angle));};
      for(const xx of [-1.55,1.55])for(const zz of [-.75,.75]){
        const height=zz<0?6.15:4.8;rod([xx,.42,zz],[xx,height,zz],.05,chrome);
        for(let y=.8;y<height;y+=.22)rod([xx,y,zz],[xx,y+.014,zz],.055,hub);
        const wp=p(xx,.23,zz),q=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),cart.angle).multiply(wheelQ);
        b.add('wheel',rubber,...wp,.22*s,.15*s,.22*s,q);b.add('wheel',hub,...wp,.105*s,.17*s,.105*s,q);
        for(const side of [-1,1])box(xx,.36,zz+side*.1,.27,.22,.045,chrome);
        box(xx,.49,zz,.3,.045,.29,chrome);
      }
      for(const y of [.68,1.98,3.28,4.58]){
        box(0,y+.08,0,3.12,.045,1.5,black);
        for(let xx=-1.45;xx<=1.45;xx+=.11)box(xx,y+.105,0,.018,.012,1.43,b.mat('#343839'));
        for(const zz of [-.75,.75]){
          rod([-1.55,y,zz],[1.55,y,zz],.035,chrome);rod([-1.55,y-.19,zz],[1.55,y-.19,zz],.03,chrome);
          for(let i=0;i<12;i++)rod([-1.55+i*3.1/12,y-(i%2?.19:0),zz],[-1.55+(i+1)*3.1/12,y-(i%2?0:.19),zz],.015,chrome);
        }
        for(const xx of [-1.55,1.55]){rod([xx,y,-.75],[xx,y,.75],.035,chrome);rod([xx,y-.19,-.75],[xx,y-.19,.75],.03,chrome);for(let i=0;i<6;i++)rod([xx,y-(i%2?.19:0),-.75+i*.25],[xx,y-(i%2?0:.19),-.75+(i+1)*.25],.015,chrome);}
      }
    }
    return b.finish();
  }
  function createExtinguishers(T,r,W,D){
    const anchor=doorAnchor(r,W,D),b=builder(T,'door-extinguishers'),red=b.mat('#b42028',.2),metal=b.mat('#bcc2c1',.68),black=b.mat('#202628'),white=b.mat('#ece8dc');
    b.group.userData={rectId:r.id,front:anchor.front};b.group.position.set(anchor.x,0,anchor.z);b.group.rotation.y=anchor.angle;
    const cx=-anchor.span/2-1.28;
    for(const x of [cx-.43,cx+.43]){
      b.add('rod',red,x,1.67,.37,.21,1.12,.21);b.add('ball',red,x,2.2,.37,.21,.16,.21);b.add('ball',red,x,1.1,.37,.205,.12,.205);
      b.rod([x,2.24,.37],[x,2.46,.37],.052,metal);b.box(x+.08,2.47,.37,.39,.065,.1,black);b.rod([x-.13,2.49,.37],[x+.25,2.62,.37],.023,black);
      b.box(x,1.72,.584,.18,.63,.018,white);b.box(x,1.64,.597,.12,.22,.01,red);
      const points=[[x-.08,2.45,.43],[x-.34,2.31,.44],[x-.32,1.72,.45],[x-.26,1.21,.47]].map(p=>new T.Vector3(...p));
      b.group.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points),14,.025,6,false),black));
    }
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;const g=canvas.getContext('2d');g.fillStyle='#b51b26';g.fillRect(0,0,512,256);g.strokeStyle='#fff';g.lineWidth=8;g.strokeRect(8,8,496,240);g.fillStyle='#fff';g.font='bold 94px sans-serif';g.textAlign='center';g.fillText('消火器',256,111);g.fillRect(239,137,34,44);g.beginPath();g.moveTo(209,177);g.lineTo(303,177);g.lineTo(256,229);g.fill();
    const tex=new T.CanvasTexture(canvas);tex.encoding=T.sRGBEncoding;
    const sign=new T.Mesh(new T.PlaneGeometry(1.8,.9),new T.MeshStandardMaterial({map:tex,roughness:.8}));sign.name='extinguisher-sign';sign.position.set(cx,3.48,.22);b.group.add(sign);
    return b.finish();
  }
  root.WarehouseV57={cartLayout,isMaterialRoom,materialRoomLayout,doorAnchor,createCartBay,createExtinguishers};
})(window);
