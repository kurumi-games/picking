// Exercise the actual walk controller with Three.js geometry and a stub renderer.
// No browser or network is required; visual rendering is not covered here.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const THREE=require('../vendor/three-r128.min.js');
class Element {
  constructor(){this.listeners=new Map();this.tagName='BUTTON';this.dataset={};this.disabled=false;}
  addEventListener(n,f){if(!this.listeners.has(n))this.listeners.set(n,new Set());this.listeners.get(n).add(f);}
  removeEventListener(n,f){this.listeners.get(n)?.delete(f);}
  emit(n,extra={}){const e={type:n,target:this,preventDefault(){this.prevented=true;},...extra};for(const f of this.listeners.get(n)||[])f(e);return e;}
  setPointerCapture(){}
  closest(s){return s==='[data-walk]'&&this.dataset.walk?this:null;}
  remove(){}
  count(){return [...this.listeners.values()].reduce((n,s)=>n+s.size,0);}
}
let now=0,sequence=0,renders=0,paused=false;
const frames=new Map(),window=new Element(),jumpButton=new Element(),control=new Element(),forward=new Element();
forward.dataset.walk='forward';control.querySelector=()=>jumpButton;
const stage=new Element();stage.clientWidth=412;stage.clientHeight=850;stage.replaceChildren=()=>{};
class Renderer {
  constructor(){this.domElement=new Element();this.shadowMap={};}
  setSize(){} render(){renders++;} dispose(){} forceContextLoss(){}
}
const db={maps:{floors:[{cols:20,rows:20,rects:[]}]},spots:{C1:{cells:[{f:0,x:3,y:3,w:2,h:2}]}}};
const saved=JSON.stringify(db);
window.THREE={...THREE,WebGLRenderer:Renderer};
window.Warehouse3D={configure(){},dispose(){},createWorld(){return {scene:new THREE.Scene(),W:40,D:40,blockers:[[18,0,20,40]],heightAt:()=>0,pickZones:[],shelfLayouts:[]};}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../warehouse-walk.js'),'utf8'),{
  window,document:{createElement:()=>({getContext:()=>({fillRect(){},fillText(){}})})},
  performance:{now:()=>now},ResizeObserver:class{observe(){}disconnect(){}},
  requestAnimationFrame:f=>{frames.set(++sequence,f);return sequence;},cancelAnimationFrame:id=>frames.delete(id)
});
function tick(n=1){for(let i=0;i<n;i++){now+=1000/60;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(f=>f(now));}}
const options={controls:control,isPaused:()=>paused,position:{x:8,z:30,yaw:0,pitch:0}};
const walk=window.WarehouseWalk.create(stage,db,0,options);tick();
const eye=walk.cam.position.y;
function key(type,key,extra={}){return window.emit(type,{key,code:key===' '?'Space':'Key'+key.toUpperCase(),target:{tagName:'BODY'},...extra});}
function finishJump(){let peak=walk.cam.position.y;for(let i=0;i<90;i++){tick();peak=Math.max(peak,walk.cam.position.y);}assert.equal(walk.cam.position.y,eye);return peak;}

// Touch/button jump rises and lands without shifting the map position.
const initial=JSON.stringify(walk.getPosition());
jumpButton.emit('pointerdown',{pointerId:2});tick(5);
assert(walk.cam.position.y>eye);assert.equal(jumpButton.disabled,true);
assert.equal(walk.jump(),false,'no second jump in mid-air');
const peak=finishJump();assert(peak>eye+1&&peak<eye+1.4);
assert.equal(JSON.stringify(walk.getPosition()),initial);assert.equal(jumpButton.disabled,false);

// Space works once per press, does not auto-repeat after landing, and ignores text input.
assert.equal(key('keydown',' ').prevented,true);tick(3);assert(walk.cam.position.y>eye);
finishJump();key('keydown',' ',{repeat:true});tick(10);assert.equal(walk.cam.position.y,eye);
key('keyup',' ');key('keydown',' ',{target:{tagName:'INPUT'}});tick(5);assert.equal(walk.cam.position.y,eye);
key('keydown',' ',{target:{tagName:'DIV',isContentEditable:true}});tick();assert.equal(walk.cam.position.y,eye);
key('keydown',' ');tick(3);assert(walk.cam.position.y>eye);key('keyup',' ');finishJump();

// A second finger can jump without releasing the direction held by the first finger.
control.emit('pointerdown',{target:forward,pointerId:1});tick(2);
jumpButton.emit('pointerdown',{pointerId:2});tick(3);assert(walk.cam.position.y>eye);
control.emit('pointerup',{target:jumpButton,pointerId:2});const moving=walk.getPosition().z;
tick(5);assert(walk.getPosition().z<moving,'jump pointer release must not stop walking');
control.emit('pointerup',{target:forward,pointerId:1});const stopped=walk.getPosition().z;
tick(5);assert.equal(walk.getPosition().z,stopped);finishJump();
// Releasing a long press must not trigger an extra jump through a compatibility click.
jumpButton.emit('click',{detail:1});tick();assert.equal(walk.cam.position.y,eye);
jumpButton.emit('click',{detail:0});tick(3);assert(walk.cam.position.y>eye);finishJump();

// Dialogs, placement and blur reset vertical motion; they cannot leave a stuck jump.
walk.jump();tick(3);paused=true;tick();assert.equal(walk.cam.position.y,eye);assert.equal(walk.jump(),false);
paused=false;tick();walk.setPlacing(true);assert.equal(walk.jump(),false);tick();assert.equal(jumpButton.disabled,true);
walk.setPlacing(false);tick();assert.equal(walk.jump(),true);tick(3);window.emit('blur');tick();assert.equal(walk.cam.position.y,eye);
assert.equal(walk.jump(),true);tick(3);walk.focus(null);tick();assert.equal(walk.cam.position.y,eye);

walk.destroy();assert.equal(walk.jump(),false);const rendered=renders;tick(5);assert.equal(renders,rendered);
assert.equal(window.count()+control.count()+jumpButton.count()+stage.count(),0,'dispose input listeners');

// Moving and jumping toward a sealed wall cannot cross it or enter its clearance.
const next=window.WarehouseWalk.create(stage,db,0,{...options,position:{x:16,z:30,yaw:-Math.PI/2,pitch:0}});tick();
key('keydown','w');key('keydown',' ');
let airborne=false;
for(let i=0;i<90;i++){tick();airborne ||= next.cam.position.y>eye;const p=next.getPosition();assert(!next.nav.blocked(p.x,p.z));assert(p.x<18);}
assert(airborne);assert(next.getPosition().x>16.25);assert.equal(next.cam.position.y,eye);
key('keyup','w');key('keyup',' ');next.destroy();
assert.equal(JSON.stringify(db),saved,'jumping never writes saved map or parts');
console.log('PASS: button/Space jump, landing, held-key and double-jump limits, two-finger walking, input guards, pause/blur, wall collision, cleanup, saved data');
