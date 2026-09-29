/* Approximate tracing of the user's 6300.png. No production data is overwritten. */
(function(root){
  'use strict';
  let id=0;
  const pallet=(x,y,w,h,label='')=>({id:++id,x,y,w,h,label,pal:true,view3d:'pallet'});
  const area=(x,y,w,h,label)=>({id:++id,x,y,w,h,label,view3d:'shelf'});
  const wall=(x,y,w,h)=>({id:++id,x,y,w,h,type:'wall'});
  root.WarehouseLayout={
    source:'6300.png',approximate:true,
    note:'全体図のスクリーンショットから読み取った配置。高さ・設備の位置は近似です。',
    floor:{name:'取込マップ（全体図から再構成）',cols:35,rows:41,floor:'green',rects:[
      pallet(4,0,10,6,'PC・145電源、本体など'),pallet(14,0,10,6,'PC・145電源、本体など'),pallet(24,0,4,6,'資材'),wall(28,0,1,6),
      area(0,1,1,5,''),area(0,6,2,3,'リフト'),area(0,9,2,5,'空台車'),
      {id:++id,x:0,y:15,w:1,h:2,type:'door',label:'扉'},
      pallet(4,8,6,10),pallet(12,8,6,10),pallet(20,8,4,10),pallet(26,8,2,10),wall(28,11,1,7),area(33,16,2,2,'階段'),
      wall(0,18,2,1),wall(4,18,5,1),wall(12,18,6,1),wall(20,18,4,1),wall(26,18,9,1),
      pallet(0,19,2,4,'電源'),pallet(4,19,6,4),pallet(12,19,6,4),pallet(20,19,4,4),
      pallet(26,19,1,6),area(27,19,8,5,'資材'),pallet(27,24,8,1),
      wall(0,23,2,1),wall(4,23,5,1),wall(12,23,6,1),wall(20,23,4,1),
      pallet(4,24,6,1),pallet(12,24,6,1),pallet(20,24,4,1),
      pallet(0,25,2,16,'電源'),pallet(4,27,4,12),pallet(10,27,2,12),area(14,27,21,12,'棚番の品')
    ]},
    viewpoints:[
      {name:'左の扉',x:5.2,z:32,yaw:0,pitch:-.12},
      {name:'奥の横通路',x:22,z:14,yaw:-Math.PI/2,pitch:-.12},
      {name:'中央の縦通路',x:38,z:30,yaw:0,pitch:-.12},
      {name:'棚番の品の手前',x:26,z:52,yaw:-Math.PI/2,pitch:-.15},
      {name:'手前の横通路',x:26,z:80,yaw:0,pitch:-.12},
      {name:'右奥の通路',x:62,z:20,yaw:0,pitch:-.12}
    ]
  };
})(window);
