/* Photo-referenced warehouse equipment and material shelves. Dimensions are visual estimates, not measurements.
   One map cell = 2 drawing units. Nothing is placed until a floor rectangle is added. */
(function(root){
  'use strict';
  const specs=Object.freeze({ductunit:{label:'ダクト機器',w:1.85,d:1.8,h:6.7},printerstand:{label:'プリンター台',w:1.65,d:1.8,h:3.0},papercabinet:{label:'書類棚',w:1.9,d:1.9,h:3.0},materialshelf:{label:'資材棚',w:5.8,d:1.9,h:7.2}});
  function layout(r){
    const spec=specs[r.fixture];if(r.type!=='officefixture'||!spec||![r.x,r.y,r.w,r.h].every(Number.isFinite)||r.w<=0||r.h<=0)return null;
    const dirs=['north','east','south','west'],turn=Math.max(0,dirs.indexOf(r.back||'north')),w=turn%2?spec.d:spec.w,d=turn%2?spec.w:spec.d,scale=Math.min(r.w*2/w,r.h*2/d);
    return {x:(r.x+r.w/2)*2,z:(r.y+r.h/2)*2,w:w*scale,d:d*scale,h:spec.h,scale,angle:-turn*Math.PI/2};
  }
  function create(T,r){
    const a=layout(r);if(!a)return null;const group=new T.Group();group.name='office-fixture-'+r.fixture;group.userData.rectId=r.id;
    const materials=new Map(),batches=new Map(),boxGeo=new T.BoxGeometry(1,1,1),dummy=new T.Object3D();
    function mat(color,metal=0){const key=color+':'+metal;if(!materials.has(key))materials.set(key,new T.MeshStandardMaterial({color:new T.Color(color).convertSRGBToLinear(),roughness:metal?.4:.78,metalness:metal}));return materials.get(key);}
    function box(x,y,z,w,h,d,m){if(!batches.has(m))batches.set(m,[]);batches.get(m).push([x,y,z,w,h,d]);}
    function mesh(geo,m,x,y,z){const o=new T.Mesh(geo,m);o.position.set(x,y,z);o.castShadow=o.receiveShadow=true;group.add(o);return o;}
    function rod(p,q,radius,m){const v=new T.Vector3(...q).sub(new T.Vector3(...p)),o=mesh(new T.CylinderGeometry(radius,radius,v.length(),12),m,0,0,0);o.position.fromArray(p).addScaledVector(v,.5);o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),v.normalize());return o;}
    const cream=mat('#b9bcb1',.2),dark=mat('#252c2c'),metal=mat('#959e9b',.6),paper=mat('#e0dfd5'),blue=mat('#477b91'),grey=mat('#8c9698'),tan=mat('#a38b62');
    if(r.fixture==='ductunit'){
      // Wheeled cream cabinet, dark top fascia, yellow duct plenum.
      box(0,1.65,0,1.7,2.9,1.55,cream);box(0,3.01,.01,1.72,.17,1.57,dark);box(0,3.16,0,1.72,.18,1.56,cream);
      box(.27,3.33,-.06,1.12,.2,1.25,mat('#bd9d37'));box(.27,3.45,-.06,1.13,.06,1.25,mat('#ddbd5c'));
      box(-.23,1.65,.784,.7,1.32,.018,paper);for(let y=1.1;y<2.18;y+=.13)box(-.23,y,.797,.44,.009,.008,mat('#a3aaa5'));
      for(const x of [-.64,.64])for(const z of [-.56,.56]){rod([x,.13,z],[x,.3,z],.055,metal);const wheel=mesh(new T.CylinderGeometry(.13,.13,.11,12),dark,x,.13,z);wheel.rotation.z=Math.PI/2;}
      // Exhaust panel and ribbed flexible duct travel with this equipment, not the warehouse wall.
      box(0,5.88,-.82,1.8,1.64,.1,tan);box(0,5.88,-.75,1.61,1.48,.045,dark);
      const fan=mesh(new T.CylinderGeometry(.58,.58,.13,32),grey,0,5.9,-.64);fan.rotation.x=Math.PI/2;
      for(let t=-.72;t<=.73;t+=.12){box(t,5.88,-.67,.009,1.44,.012,metal);box(0,5.88+t,-.66,1.55,.009,.012,metal);}
      const curve=new T.CatmullRomCurve3([new T.Vector3(.27,3.48,-.06),new T.Vector3(.29,4.05,.1),new T.Vector3(.14,4.92,-.1),new T.Vector3(0,5.9,-.52)]);
      mesh(new T.TubeGeometry(curve,42,.29,14,false),grey,0,0,0);
      const rings=new T.InstancedMesh(new T.TorusGeometry(.297,.017,5,18),metal,68);
      for(let i=0;i<68;i++){const t=i/67;dummy.position.copy(curve.getPoint(t));dummy.scale.set(1,1,1);dummy.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),curve.getTangent(t).normalize());dummy.updateMatrix();rings.setMatrixAt(i,dummy.matrix);}rings.frustumCulled=false;group.add(rings);
      rod([-.6,3.22,.1],[-.69,3.62,.39],.22,grey);const mouth=mesh(new T.CircleGeometry(.19,20),dark,-.69,3.64,.57);mouth.rotation.x=-.35;
    } else if(r.fixture==='printerstand'){
      // Open cream stand with blue tray, translucent drawers and black printer.
      box(0,.1,0,1.6,.12,1.7,cream);for(const x of [-.75,.75])box(x,.99,0,.09,1.85,1.68,cream);box(0,1.91,0,1.65,.12,1.8,cream);box(0,.95,-.8,1.5,1.7,.07,cream);
      for(let i=0;i<4;i++){const y=.31+i*.34;box(0,y,.18,1.31,.27,1.18,dark);box(0,y,.79,1.28,.24,.04,mat('#606666'));box(0,y+.02,.816,.41,.055,.014,paper);box(0,y+.16,.05,1.42,.045,1.52,cream);}
      box(0,1.69,.12,1.35,.15,1.36,blue);box(0,1.78,.15,1.14,.028,1.07,tan);
      box(0,2.21,0,1.56,.51,1.49,dark);box(0,2.5,-.05,1.57,.1,1.5,mat('#383d3d'));box(0,2.1,.76,1.1,.15,.04,mat('#111819'));box(0,2.02,.86,.87,.04,.05,dark);
      box(0,2.67,-.65,.96,.51,.08,dark);box(0,2.75,-.58,.8,.38,.015,paper);box(.57,2.55,.24,.2,.018,.47,mat('#505a59'));for(let i=0;i<3;i++)box(.58,2.566,.07+i*.11,.04,.015,.04,paper);
    } else if(r.fixture==='materialshelf'){
      // One empty, five-level grey steel rack. Adjacent racks remain independent map objects.
      const painted=mat('#b8bdb6',.32),board=mat('#adb5b0',.26),holes=mat('#59645f'),bolt=mat('#9da8a2',.65);
      for(const x of [-2.78,2.78])for(const z of [-.84,.84]){
        // Punched angle uprights and flat feet, rather than round wire-cart pipes.
        box(x,3.6,z,.105,7.2,.105,painted);
        box(x+(x<0?.053:-.053),3.6,z,.11,7.2,.036,painted);
        box(x,.055,z,.2,.11,.2,painted);
        for(let y=.52;y<7.08;y+=.23)box(x,y,z+(z>0?.055:-.055),.031,.07,.009,holes);
      }
      for(const y of [.32,2.01,3.7,5.39,7.08]){
        box(0,y,0,5.55,.065,1.68,board);
        for(const z of [-.845,.845])box(0,y-.085,z,5.6,.19,.055,painted);
        for(const x of [-2.765,2.765])box(x,y-.085,0,.065,.19,1.68,painted);
        for(const x of [-1.5,0,1.5])box(x,y-.06,0,.07,.12,1.59,painted);
        for(const x of [-2.78,2.78])for(const z of [-.901,.901])box(x,y-.035,z,.055,.055,.015,bolt);
      }
      // Slender rear braces establish the back; the front stays fully open.
      rod([-2.7,.47,-.88],[2.7,3.55,-.88],.025,painted);
      rod([2.7,.47,-.88],[-2.7,3.55,-.88],.025,painted);
    } else {
      // Open document slots over a closed lower cabinet. A3/A4/B4 labels are legible up close.
      for(const x of [-.88,.88])box(x,1.41,0,.12,2.78,1.79,cream);box(0,1.41,-.84,1.78,2.78,.1,cream);box(0,.08,0,1.88,.13,1.9,cream);box(0,2.86,0,1.9,.15,1.9,metal);
      box(0,.71,.81,1.7,1.18,.07,cream);box(0,1.06,.862,.61,.055,.06,metal);
      box(0,1.36,0,1.72,.09,1.72,cream);
      for(let i=0;i<4;i++){const y=1.54+i*.29;box(0,y-.11,0,1.72,.065,1.73,cream);box(.06,y,.03,1.25,.052,1.48,i===0?blue:tan);for(let j=0;j<3;j++)box(-.05+j*.04,y+.04+j*.018,.13,1.12,.014,1.25,paper);}
      box(-.3,2.95,.12,.87,.025,1.3,paper);box(.38,2.956,-.2,.69,.025,.92,blue);
      const cv=document.createElement('canvas');cv.width=128;cv.height=512;const g=cv.getContext('2d');g.fillStyle='#eeeeea';g.fillRect(0,0,128,512);g.fillStyle='#4a5555';g.font='48px sans-serif';g.textAlign='center';['A3','A4','B4',''].forEach((s,i)=>g.fillText(s,64,82+i*128));const tex=new T.CanvasTexture(cv);tex.encoding=T.sRGBEncoding;mesh(new T.PlaneGeometry(.23,1.16),new T.MeshStandardMaterial({map:tex,roughness:.85}),-.79,2.06,.91);
    }
    for(const [m,items] of batches){const inst=new T.InstancedMesh(boxGeo,m,items.length);items.forEach((v,i)=>{dummy.position.set(v[0],v[1],v[2]);dummy.scale.set(v[3],v[4],v[5]);dummy.quaternion.identity();dummy.updateMatrix();inst.setMatrixAt(i,dummy.matrix);});inst.frustumCulled=false;inst.castShadow=inst.receiveShadow=true;group.add(inst);}
    group.position.set(a.x,0,a.z);group.rotation.y=a.angle;group.scale.set(a.scale,1,a.scale);return group;
  }
  root.WarehouseOfficeFixtures={specs,layout,create};
})(window);
