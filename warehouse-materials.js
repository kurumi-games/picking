/* Photo-referenced materials. Decorative surfaces never change map coordinates. */
(function(root){
  'use strict';
  const sources={floor:'img/warehouse/floor-green.webp',paint:'img/warehouse/paint-panel.webp'};
  const images={};let pending=null;
  function load(){
    if(pending)return pending;
    pending=Promise.all(Object.entries(sources).map(([key,path])=>new Promise(resolve=>{
      const image=new Image();image.onload=()=>{images[key]=image;resolve();};image.onerror=()=>resolve();
      image.src=(root.WarehouseMaterials.assetURLs||{})[key]||path;
    })));return pending;
  }
  function concreteImage(){
    if(images.concrete)return images.concrete;
    const c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d'),im=g.createImageData(512,512);let seed=6337;
    const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
    for(let y=0;y<512;y++)for(let x=0;x<512;x++){const i=(y*512+x)*4,n=(rand()-.5)*17+6*Math.sin(x*.025)*Math.cos(y*.037),v=147+n;im.data[i]=v+3;im.data[i+1]=v+2;im.data[i+2]=v;im.data[i+3]=255;}g.putImageData(im,0,0);
    for(let i=0;i<650;i++){const x=rand()*512,y=rand()*512;g.fillStyle=rand()>.5?'#655e5216':'#f4f0e51c';g.beginPath();g.ellipse(x,y,.4+rand()*2,.3+rand(),rand()*3,0,Math.PI*2);g.fill();}
    g.strokeStyle='#655f541a';g.lineWidth=.6;for(let i=0;i<8;i++){let x=rand()*512,y=rand()*512;g.beginPath();g.moveTo(x,y);for(let j=0;j<7;j++){x+=(rand()-.4)*14;y+=(rand()-.5)*16;g.lineTo(x,y);}g.stroke();}
    return images.concrete=c;
  }
  function kit(){
    const T=root.THREE,cache=new Map();
    function texture(key,rx=1,ry=1,color=true){
      const name=[key,rx,ry,color].join(':');if(cache.has(name))return cache.get(name);
      let image=key==='concrete'?concreteImage():images[key];
      if(!image){image=document.createElement('canvas');image.width=image.height=32;const g=image.getContext('2d');g.fillStyle=key==='floor'?'#426858':'#b3b0a4';g.fillRect(0,0,32,32);}
      const t=new T.Texture(image);t.needsUpdate=true;t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(rx,ry);t.anisotropy=4;t.encoding=color?T.sRGBEncoding:T.LinearEncoding;cache.set(name,t);return t;
    }
    function painted(rx=1,ry=1,tint='#ffffff'){
      return new T.MeshStandardMaterial({map:texture('paint',rx,ry),bumpMap:texture('paint',rx,ry,false),bumpScale:.008,color:new T.Color(tint).convertSRGBToLinear(),roughness:.78});
    }
    function floor(W,D,mode){
      const m=new T.MeshStandardMaterial({map:texture('floor',W/12,D/12),bumpMap:texture('floor',W/12,D/12,false),bumpScale:.009,roughness:.48,metalness:.06});
      if(mode==='concrete'){m.map=texture('concrete',W/12,D/12);m.bumpMap=texture('concrete',W/12,D/12,false);m.roughness=.85;m.metalness=0;}
      if(mode==='gray'||mode==='white'){
        m.map=texture('paint',W/12,D/12);m.color.set(mode==='white'?'#d4d7ce':'#89928c').convertSRGBToLinear();m.roughness=.6;
      }
      return m;
    }
    // Soft grounding shadow: a reusable gradient around an opaque contact footprint.
    function contactMap(){
      const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');
      const im=g.createImageData(64,64);for(let y=0;y<64;y++)for(let x=0;x<64;x++){
        const d=Math.max(Math.abs(x-31.5),Math.abs(y-31.5))/31.5;im.data[(y*64+x)*4+3]=Math.round(190*Math.pow(Math.max(0,1-Math.max(0,d-.7)/.3),2));
      }g.putImageData(im,0,0);return new T.CanvasTexture(c);
    }
    function curtain(w,h){
      const c=document.createElement('canvas');c.width=c.height=64;const g=c.getContext('2d');
      g.fillStyle='#eebc28';g.fillRect(0,0,64,64);
      g.fillStyle='#bf941c';for(let i=0;i<64;i+=8){g.fillRect(i,0,1,64);g.fillRect(0,i,64,1);}
      g.fillStyle='#f9d555';for(let i=2;i<64;i+=8)g.fillRect(i,0,1,64);
      const t=new T.CanvasTexture(c);t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(w*2,h*2);t.encoding=T.sRGBEncoding;t.anisotropy=4;
      return new T.MeshStandardMaterial({map:t,emissive:'#e4a600',emissiveIntensity:.32,roughness:.66,metalness:0});
    }
    function reflection(W,D){
      if(!T.Reflector)return null;
      const shader={uniforms:{color:{value:new T.Color()},tDiffuse:{value:null},textureMatrix:{value:new T.Matrix4()},detailMap:{value:null}},
        vertexShader:`uniform mat4 textureMatrix;varying vec4 vUv;varying vec3 vWorld;void main(){vUv=textureMatrix*vec4(position,1.);vec4 p=modelMatrix*vec4(position,1.);vWorld=p.xyz;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader:`uniform sampler2D tDiffuse;uniform sampler2D detailMap;varying vec4 vUv;varying vec3 vWorld;
        void main(){vec2 uv=vUv.xy/vUv.w;vec2 grain=texture2D(detailMap,vWorld.xz/12.).rg;uv+=(grain-.35)*.003;
        vec3 c=texture2D(tDiffuse,uv).rgb*.4;
        c+=texture2D(tDiffuse,uv+vec2(.003,0.)).rgb*.15;c+=texture2D(tDiffuse,uv-vec2(.003,0.)).rgb*.15;
        c+=texture2D(tDiffuse,uv+vec2(0.,.003)).rgb*.15;c+=texture2D(tDiffuse,uv-vec2(0.,.003)).rgb*.15;
        float facing=abs(normalize(cameraPosition-vWorld).y);float strength=.045+.23*pow(1.-facing,2.);
        gl_FragColor=vec4(c,strength*(.65+grain.g));}`};
      const mirror=new T.Reflector(new T.PlaneGeometry(W,D),{textureWidth:384,textureHeight:384,clipBias:.002,shader});
      mirror.material.uniforms.detailMap.value=texture('floor',1,1,false);mirror.material.transparent=true;mirror.material.depthWrite=false;
      mirror.rotation.x=-Math.PI/2;mirror.position.set(W/2,.023,D/2);mirror.renderOrder=1;mirror.userData.dispose=()=>{mirror.getRenderTarget().dispose();mirror.material.uniforms.detailMap.value.dispose();};return mirror;
    }
    return {texture,painted,floor,contactMap,curtain,reflection};
  }
  root.WarehouseMaterials={load,kit,assetURLs:null};
})(window);
