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
  function kit(){
    const T=root.THREE,cache=new Map();
    function texture(key,rx=1,ry=1,color=true){
      const name=[key,rx,ry,color].join(':');if(cache.has(name))return cache.get(name);
      let image=images[key];
      if(!image){image=document.createElement('canvas');image.width=image.height=32;const g=image.getContext('2d');g.fillStyle=key==='floor'?'#426858':'#b3b0a4';g.fillRect(0,0,32,32);}
      const t=new T.Texture(image);t.needsUpdate=true;t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(rx,ry);t.anisotropy=4;t.encoding=color?T.sRGBEncoding:T.LinearEncoding;cache.set(name,t);return t;
    }
    function painted(rx=1,ry=1,tint='#ffffff'){
      return new T.MeshStandardMaterial({map:texture('paint',rx,ry),bumpMap:texture('paint',rx,ry,false),bumpScale:.008,color:new T.Color(tint).convertSRGBToLinear(),roughness:.78});
    }
    function floor(W,D,mode){
      const m=new T.MeshStandardMaterial({map:texture('floor',W/12,D/12),bumpMap:texture('floor',W/12,D/12,false),bumpScale:.009,roughness:.48,metalness:.06});
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
