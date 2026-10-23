'use strict';
// ===== 基本 =====
const WD=['日','月','火','水','木','金','土'];
const VCOLORS=['v1','v2','v3','v4','v5','v6','v7','v8'];
const DEF={facilityName:'',closeTime:'17:00',holidayStart:'10:00',holidayEnd:'16:00',escortMode:'always',escortMin:4,minStay:1,waitTol:10,carWait:10,schoolHop:5,houseHop:3,areaHop:10,mixAreas:false,buffer:5,maxRide:60,areas:[]};
const TABS=[['plan','送迎表'],['record','記録'],['children','児童'],['schools','学校'],['vehicles','車両'],['staff','スタッフ'],['import','取り込み'],['settings','設定']];
const S={db:null,dbState:'loading',canWrite:true,downloads:null,settings:{...DEF},sample:false,schools:[],children:[],vehicles:[],staff:[],
  date:todayStr(),day:emptyDay(),tab:'plan',view:'board',bulk:null,recMonth:'',logs:[],edit:null,confirm:null,imp:{target:'children',rows:null,header:true,map:{},dateDefault:'',offOthers:true,nick:true,addr:false,msg:''}};
let dayUnsub=null,dayTimer=null,dayDirty=false;

function todayStr(){const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function emptyDay(){return {dayType:'',attend:{},staff:{},schoolTimes:{},plan:null}}
function uid(p){return (p||'x')+Date.now().toString(36)+Math.random().toString(36).slice(2,6)}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function tm(s){if(!s)return null;const m=String(s).match(/^(\d{1,2}):(\d{2})/);return m?(+m[1])*60+(+m[2]):null}
function hm(n){if(n==null||isNaN(n))return '--:--';n=Math.round(n);return String(Math.floor(n/60)).padStart(2,'0')+':'+String(((n%60)+60)%60).padStart(2,'0')}
function wdOf(d){return new Date(d+'T00:00:00').getDay()}
function addDays(d,n){const x=new Date(d+'T00:00:00');x.setDate(x.getDate()+n);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0')}
function byId(a){const m={};for(const x of a)m[x.id]=x;return m}
function normName(s){return String(s||'').replace(/[\s　]/g,'').replace(/（例）|\(例\)/g,'')}
const KANA_INI={'あ':'A','い':'I','う':'U','え':'E','お':'O','し':'S','じ':'J','ち':'C','ぢ':'J','つ':'T','づ':'Z','ふ':'F','ゔ':'V'};
const ROWS=[['かきくけこ','K'],['がぎぐげご','G'],['さすせそ','S'],['ざずぜぞ','Z'],['たてと','T'],['だでど','D'],['なにぬねの','N'],['はひへほ','H'],['ばびぶべぼ','B'],['ぱぴぷぺぽ','P'],['まみむめも','M'],['やゆよ','Y'],['らりるれろ','R'],['わを','W']];
function kanaIni(ch){ch=String.fromCharCode(ch.charCodeAt(0)>=0x30A1&&ch.charCodeAt(0)<=0x30F6?ch.charCodeAt(0)-0x60:ch.charCodeAt(0));if(KANA_INI[ch])return KANA_INI[ch];for(const [r,c] of ROWS)if(r.includes(ch))return c;return ''}
function toHira(s){return String(s||'').replace(/[\u30A1-\u30F6]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60))}
// ふりがな「さとう はると」→「さとうH」
function nickFromKana(k){const parts=toHira(k).trim().split(/[\s　]+/);if(parts.length<2||!parts[0])return '';const ini=kanaIni(parts[1][0]||'');return ini?parts[0]+ini:''}
// 本名は保存せず、照合用の暗号（ハッシュ）だけを持つ
async function nameKey(real){const n=normName(real);if(!n||!crypto?.subtle)return '';const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('sougei:'+n));return [...new Uint8Array(b)].slice(0,10).map(x=>x.toString(16).padStart(2,'0')).join('')}
function gradeLabel(g){g=+g;if(!g)return '';if(g<=6)return '小'+g;if(g<=9)return '中'+(g-6);return '高'+(g-9)}
function toast(t){const el=document.getElementById('toast');el.textContent=t;el.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>el.hidden=true,2200)}
function st(){return {...DEF,...S.settings}}
function isHoliday(){const t=S.day.dayType;if(t)return t==='holiday';const w=wdOf(S.date);return w===0||w===6}

// ===== 計算の土台 =====
function L(){const s=st();return {s,sch:byId(S.schools),ch:byId(S.children),veh:byId(S.vehicles),stf:byId(S.staff),ar:byId(s.areas||[])}}
function childMin(c,l){return +c.min||+(l.ar[c.areaId]?.min)||15}
function schoolMin(sc,l){return +sc?.min||+(l.ar[sc?.areaId]?.min)||10}
// 車で送迎しない子：保護者の送迎・自走（自分で来る・帰る）
const OTHER={parent:'保護者',self:'自走'};
const pickSel=a=>a.pickup?placeOf(a):(a.pickOther||'none');
const dropSel=a=>a.drop?'car':(a.dropOther||'none');
function attendance(){
  const w=wdOf(S.date),out=[];
  for(const c of S.children){
    const base={on:(c.days||[]).includes(w),pickup:c.pickup!==false,drop:c.drop!==false,pickPlace:c.pickPlace||'school',pickOther:c.pickOther||'',dropOther:c.dropOther||'',pickTime:'',arriveBy:'',dropTime:''};
    out.push({c,...base,...(S.day.attend?.[c.id]||{})});
  }
  return out;
}
function pickTimeFor(a,l){
  if(a.pickTime)return a.pickTime;
  if(isHoliday())return null;
  if(placeOf(a)==='home')return deadlineOf(a,l)!=null?null:(a.c.homePickTime||null);
  const o=S.day.schoolTimes?.[a.c.schoolId];if(o)return o;
  const sc=l.sch[a.c.schoolId];if(!sc)return null;
  const t=sc.times?.[String(wdOf(S.date))]||{};
  return (+a.c.grade>=4&&t.hi)?t.hi:(t.lo||t.hi||null);
}
// 事業所に着いていたい時刻（HUGの入室時間）
function deadlineOf(a,l){if(a.arriveBy)return tm(a.arriveBy);if(a.c.arriveBy&&!isHoliday())return tm(a.c.arriveBy);if(isHoliday())return tm(l.s.holidayStart);return null}
function attMap(){const m={};for(const a of attendance())m[a.c.id]=a;return m}
function placeOf(a){return isHoliday()?'home':(a.pickPlace||a.c.pickPlace||'school')}
function dropTimeFor(a,l){
  if(a.dropTime)return a.dropTime;
  if(isHoliday())return l.s.holidayEnd;
  return a.c.dropTime||l.s.closeTime;
}
function staffAvail(){
  const w=wdOf(S.date),m={};
  for(const p of S.staff){
    const r={on:(p.days||[]).includes(w),start:p.start||'13:00',end:p.end||'19:00',...(S.day.staff?.[p.id]||{})};
    m[p.id]=r.on?{start:tm(r.start),end:tm(r.end)}:null;
  }
  return m;
}
function hop(a,b,l,same){return Math.abs(a.min-b.min)+(a.areaId===b.areaId?same:l.s.areaHop)}
function stopMin(stop,l){
  if(stop.kind==='school')return schoolMin(l.sch[stop.schoolId],l);
  const c=l.ch[stop.childIds[0]];return c?childMin(c,l):15;
}
function stopArea(stop,l){return stop.kind==='school'?l.sch[stop.schoolId]?.areaId:l.ch[stop.childIds[0]]?.areaId}
// 1便の時刻を計算
function computeTrip(trip,l){
  const s=l.s;
  const stops=trip.stops.map(x=>({...x,min:stopMin(x,l),areaId:stopArea(x,l)}));
  let dep=null,ret=null,ride=0;
  if(!stops.length)return {stops,dep:null,ret:null,ride:0};
  if(trip.mode==='school'){ // お迎え：学校の下校時刻・自宅の約束時刻と、入室時間（着く時刻）
    const am=l.att||attMap();const dls=tripKids(trip).map(c=>am[c]?deadlineOf(am[c],l):null).filter(x=>x!=null);
    const dl=dls.length?Math.min(...dls):null;
    const key=x=>x.sched?tm(x.sched):(dl!=null?dl-x.min-5:0);
    stops.sort((a,b)=>key(a)-key(b)||b.min-a.min);
    const k=stops.findIndex(x=>x.sched);
    if(k<0){ // 時刻の決まった場所が無い → 入室時間から逆算
      stops.forEach((x,i)=>{x.rel=i===0?0:stops[i-1].rel+hop(stops[i-1],x,l,s.houseHop);x.late=0});
      const last=stops[stops.length-1],end=dl!=null?dl:tm('15:00'),first=end-(last.rel+last.min);
      stops.forEach(x=>x.time=first+x.rel);
    }else{
      stops[k].time=tm(stops[k].sched);stops[k].late=0;
      for(let i=k-1;i>=0;i--){stops[i].time=stops[i+1].time-hop(stops[i],stops[i+1],l,s.houseHop);stops[i].late=0}
      for(let i=k+1;i<stops.length;i++){const x=stops[i],arr=stops[i-1].time+hop(stops[i-1],x,l,x.kind==='school'&&stops[i-1].kind==='school'?s.schoolHop:s.houseHop);
        if(x.sched){const sc=tm(x.sched);x.time=Math.max(arr,sc);x.early=Math.max(0,sc-arr);x.late=x.time-sc}else{x.time=arr;x.late=0}}
    }
    dep=stops[0].time-stops[0].min;const last=stops[stops.length-1];ret=last.time+last.min;ride=ret-stops[0].time;
    return {stops,dep,ret,ride,dl,arrLate:dl!=null?ret-dl:0};
  }else if(trip.mode==='homeOut'){
    stops.sort((a,b)=>a.min-b.min);
    dep=tm(trip.anchor);
    stops.forEach((x,i)=>{x.time=i===0?dep+x.min:stops[i-1].time+hop(stops[i-1],x,l,s.houseHop);x.late=0});
    const last=stops[stops.length-1];ret=last.time+last.min;ride=last.time-dep;
  }else{ // homeIn 休日の自宅お迎え
    stops.sort((a,b)=>b.min-a.min);
    let t=0;stops.forEach((x,i)=>{x.rel=i===0?0:stops[i-1].rel+hop(stops[i-1],x,l,s.houseHop);x.late=0});
    const last=stops[stops.length-1];const arrRel=last.rel+last.min;
    ret=tm(trip.anchor);const first=ret-arrRel;dep=first-stops[0].min;
    stops.forEach(x=>x.time=first+x.rel);ride=ret-stops[0].time;
  }
  return {stops,dep,ret,ride};
}
function tripKids(trip){return trip.stops.flatMap(x=>x.childIds)}
function needsSeat(cid,l){return !!l.ch[cid]?.seat}
function vehicleFree(plan,vid,dep,ret,ignore,l){
  for(const t of plan){if(t.id===ignore||t.vehicleId!==vid)continue;const r=computeTrip(t,l);if(r.dep==null)continue;
    if(dep<r.ret+l.s.buffer&&r.dep<ret+l.s.buffer)return false}
  return true;
}
function fitKids(list,cap,seats,l){const out=[];let sUsed=0;for(const cid of list){if(out.length>=cap)break;const n=needsSeat(cid,l);if(n&&sUsed>=seats)continue;if(n)sUsed++;out.push(cid)}return out}

// ===== 自動作成 =====
function autoPlan(){
  const l=L(),s=l.s,trips=[],holiday=isHoliday();
  const vehicles=S.vehicles.filter(v=>v.active!==false&&+v.cap>0);
  const att=attendance().filter(a=>a.on);
  const maxCap=Math.max(1,...vehicles.map(v=>+v.cap));
  // --- お迎え（学校） ---
  l.att=attMap();
  {
    const groups={};
    for(const a of att){if(!a.pickup)continue;const t=pickTimeFor(a,l)||'',d=deadlineOf(a,l);if(!t&&d==null)continue;
      const home=placeOf(a)==='home';if(!home&&!l.sch[a.c.schoolId])continue;
      const key=(home?homeKey(a.c):a.c.schoolId)+'|'+t;
      const g=(groups[key]=groups[key]||(home?{kind:'home',key,sched:t,kids:[],childIds:[a.c.id]}:{kind:'school',key,schoolId:a.c.schoolId,sched:t,kids:[],childIds:[a.c.id]}));
      g.kids.push(a.c.id);if(d!=null)g.dl=Math.min(g.dl??9e9,d)}
    for(const g of Object.values(groups)){g.min=stopMin(g,l);g.areaId=stopArea(g,l);g.ord=g.sched?tm(g.sched):(g.dl-g.min-5)}
    const order=Object.values(groups).sort((a,b)=>a.ord-b.ord||a.min-b.min);
    for(const g of order){
      let rem=g.kids.slice().sort((a,b)=>needsSeat(b,l)-needsSeat(a,l));
      let guard=0;
      while(rem.length&&guard++<50){
        let best=null;
        for(const t of trips){
          if(t.mode!=='school')continue;const v=l.veh[t.vehicleId];if(!v)continue;
          if(!s.mixAreas){const a0=stopArea(t.stops[0],l);if(a0!==g.areaId)continue}
          const ks=tripKids(t);const capLeft=+v.cap-ks.length;const seatLeft=(+v.seats||0)-ks.filter(c=>needsSeat(c,l)).length;
          if(capLeft<=0)continue;const take=fitKids(rem,capLeft,seatLeft,l);if(!take.length)continue;
          const test=addToSchoolTrip(t,g,take);const r=computeTrip(test,l);
          const before=computeTrip(t,l);
          if(r.stops.some(x=>x.late>s.waitTol||(x.early||0)>s.carWait)||r.ride>s.maxRide)continue;
          if(r.arrLate>Math.max(0,before.arrLate))continue; // 入室時間に遅れる組み合わせはしない
          if(!vehicleFree(trips,t.vehicleId,r.dep,r.ret,t.id,l))continue;
          const score=(r.ret-before.ret)-take.length*3;
          if(!best||score<best.score)best={t,test,take,score};
        }
        if(best){Object.assign(best.t,{stops:best.test.stops});rem=rem.filter(c=>!best.take.includes(c));continue}
        const r1=computeTrip({mode:'school',stops:[groupStop(g,rem)]},l),dep=r1.dep,ret=r1.ret;
        const seatNeed=rem.filter(c=>needsSeat(c,l)).length;
        const free=vehicles.filter(v=>vehicleFree(trips,v.id,dep,ret,null,l));
        if(!free.length)break;
        const fits=free.filter(v=>+v.cap>=rem.length&&(+v.seats||0)>=seatNeed).sort((a,b)=>a.cap-b.cap);
        const cands=fits.length?fits:free.sort((a,b)=>b.cap-a.cap);
        let made=false;
        for(const v of cands){const take=fitKids(rem,+v.cap,+v.seats||0,l);if(!take.length)continue;
          trips.push({id:uid('t'),kind:'pickup',mode:'school',vehicleId:v.id,driverId:'',escortId:'',stops:[groupStop(g,take)]});
          rem=rem.filter(c=>!take.includes(c));made=true;break}
        if(!made)break;
      }
    }
  }
  // --- 送り（自宅） ---
  const byTime={};
  for(const a of att){if(!a.drop)continue;const t=dropTimeFor(a,l);(byTime[t]=byTime[t]||[]).push(a.c)}
  for(const t of Object.keys(byTime).sort((a,b)=>tm(a)-tm(b)))buildHome(byTime[t],t,'homeOut','drop',trips,vehicles,l,maxCap);
  assignStaff(trips,l);delete l.att;
  return trips;
}
function groupStop(g,kids){return g.kind==='school'?{key:g.key,kind:'school',schoolId:g.schoolId,sched:g.sched,childIds:kids.slice()}:{key:g.key,kind:'home',sched:g.sched,childIds:kids.slice()}}
function addToSchoolTrip(t,g,kids){
  const stops=t.stops.map(x=>({...x,childIds:x.childIds.slice()}));
  const ex=stops.find(x=>x.key===g.key&&x.sched===g.sched);
  if(ex)ex.childIds.push(...kids);else stops.push(groupStop(g,kids));
  return {...t,stops};
}
function homeKey(c){const a=normName(c.address);return a?'a:'+a:'c:'+c.id}
function buildHome(kids,anchor,mode,kind,trips,vehicles,l,maxCap){
  const s=l.s,maxSeats=Math.max(0,...vehicles.map(v=>+v.seats||0));
  // 同じ住所（きょうだい）は1か所にまとめる
  const stopMap={};
  for(const c of kids){const k=homeKey(c);(stopMap[k]=stopMap[k]||{key:k,kind:'home',childIds:[]}).childIds.push(c.id)}
  let stops=Object.values(stopMap).map(x=>({...x,min:stopMin(x,l),areaId:stopArea(x,l)}));
  const seatsOf=list=>list.reduce((n,x)=>n+x.childIds.filter(c=>needsSeat(c,l)).length,0);
  const countOf=list=>list.reduce((n,x)=>n+x.childIds.length,0);
  const rideOk=list=>computeTrip({mode,anchor,stops:list},l).ride<=s.maxRide;
  // 地区ごとにまとめて、定員ごとに区切る
  const areaGroups={};for(const x of stops)(areaGroups[x.areaId||'-']=areaGroups[x.areaId||'-']||[]).push(x);
  let chunks=[];
  for(const g of Object.values(areaGroups).sort((a,b)=>a[0].min-b[0].min)){
    g.sort((a,b)=>a.min-b.min);let cur=[];
    for(const x of g){const nx=[...cur,x];
      if(cur.length&&(countOf(nx)>maxCap||seatsOf(nx)>maxSeats||!rideOk(nx))){chunks.push(cur);cur=[x]}else cur=nx}
    if(cur.length)chunks.push(cur);
  }
  if(s.mixAreas){ // 少人数の便を隣の地区とまとめる
    chunks.sort((a,b)=>a[0].min-b[0].min);let merged=true;
    while(merged){merged=false;for(let i=0;i<chunks.length-1;i++){const nx=[...chunks[i],...chunks[i+1]];
      if(countOf(nx)<=maxCap&&seatsOf(nx)<=maxSeats&&rideOk(nx)){chunks.splice(i,2,nx);merged=true;break}}}
  }
  chunks.sort((a,b)=>countOf(b)-countOf(a));
  let guard=0;
  while(chunks.length&&guard++<200){
    const ch=chunks.shift();const r=computeTrip({mode,anchor,stops:ch},l);
    const n=countOf(ch),sn=seatsOf(ch);
    const free=vehicles.filter(v=>vehicleFree(trips,v.id,r.dep,r.ret,null,l));
    if(!free.length)continue; // 割り当てできず→未割当として表示される
    const fits=free.filter(v=>+v.cap>=n&&(+v.seats||0)>=sn).sort((a,b)=>a.cap-b.cap);
    if(fits.length){trips.push({id:uid('t'),kind,mode,anchor,vehicleId:fits[0].id,driverId:'',escortId:'',stops:ch.map(x=>({key:x.key,kind:'home',childIds:x.childIds.slice()}))});continue}
    // 入りきらない→大きい車から詰めて残りは次へ
    const v=free.sort((a,b)=>b.cap-a.cap)[0];let cap=+v.cap,seats=+v.seats||0;const take=[],rest=[];
    for(const x of ch.sort((a,b)=>a.min-b.min)){const ns=x.childIds.filter(c=>needsSeat(c,l)).length;
      if(x.childIds.length<=cap&&ns<=seats){take.push(x);cap-=x.childIds.length;seats-=ns}else rest.push(x)}
    if(!take.length){ // 1か所の人数が多すぎる場合は児童単位で分ける
      const x=ch[0];const k=fitKids(x.childIds,+v.cap,+v.seats||0,l);if(!k.length)continue;
      take.push({...x,childIds:k});rest.push({...x,childIds:x.childIds.filter(c=>!k.includes(c))},...ch.slice(1));
    }
    trips.push({id:uid('t'),kind,mode,anchor,vehicleId:v.id,driverId:'',escortId:'',stops:take.map(x=>({key:x.key,kind:'home',childIds:x.childIds.slice()}))});
    if(rest.length)chunks.unshift(rest.filter(x=>x.childIds.length));
  }
}
function needEscort(trip,l){
  const s=l.s,ks=tripKids(trip);
  if(ks.some(c=>l.ch[c]?.needEscort))return true;
  if(s.escortMode==='always')return true;
  if(s.escortMode==='min')return ks.length>=+s.escortMin;
  return false;
}
function overlap(a0,a1,b0,b1,buf){return a0<b1+buf&&b0<a1+buf}
function assignStaff(trips,l){
  const av=staffAvail(),busy={},count={};
  const rs=trips.map(t=>({t,r:computeTrip(t,l)})).sort((a,b)=>a.r.dep-b.r.dep);
  const isFree=(id,r)=>(busy[id]||[]).every(b=>!overlap(r.dep,r.ret,b[0],b[1],l.s.buffer));
  const covers=(id,r)=>av[id]&&av[id].start<=r.dep&&av[id].end>=r.ret;
  const stayOk=(r,extra)=>{ // 事業所に残る人数
    let n=0;for(const p of S.staff){const a=av[p.id];if(!a||a.start>r.dep||a.end<r.ret)continue;if(extra.includes(p.id))continue;if(!isFree(p.id,r))continue;n++}
    return n>=+l.s.minStay;
  };
  const pick=(cands,r,extra)=>{cands.sort((a,b)=>(count[a.id]||0)-(count[b.id]||0));return cands.find(p=>stayOk(r,[...extra,p.id]))||null};
  for(const {t,r} of rs){ // 先に全便の運転手を決める
    if(r.dep==null)continue;
    const drivers=S.staff.filter(p=>p.canDrive&&covers(p.id,r)&&isFree(p.id,r));
    const d=pick(drivers,r,[])||drivers.sort((a,b)=>(count[a.id]||0)-(count[b.id]||0))[0];
    if(d){t.driverId=d.id;(busy[d.id]=busy[d.id]||[]).push([r.dep,r.ret]);count[d.id]=(count[d.id]||0)+1}
  }
  for(const {t,r} of rs){ // 添乗員は運転しない人を優先
    if(r.dep==null||!needEscort(t,l))continue;
    const es=S.staff.filter(p=>p.id!==t.driverId&&covers(p.id,r)&&isFree(p.id,r));
    es.sort((a,b)=>(a.canDrive?1:0)-(b.canDrive?1:0)||(count[a.id]||0)-(count[b.id]||0));
    const e=es.find(p=>stayOk(r,[p.id]));
    if(e){t.escortId=e.id;(busy[e.id]=busy[e.id]||[]).push([r.dep,r.ret]);count[e.id]=(count[e.id]||0)+1}
  }
}

// ===== チェック =====
function validate(trips,l){
  const iss=[],s=l.s,att=attendance().filter(a=>a.on);
  const inPick={},inDrop={};
  const computed=trips.map(t=>({t,r:computeTrip(t,l)}));
  for(const {t} of computed)for(const c of tripKids(t))(t.kind==='pickup'?inPick:inDrop)[c]=((t.kind==='pickup'?inPick:inDrop)[c]||0)+1;
  for(const a of att){
    if(a.pickup){
      if(!pickTimeFor(a,l)&&deadlineOf(a,l)==null)iss.push({lv:'warn',txt:placeOf(a)==='home'?`${a.c.name}：自宅へ迎えに行く時刻が決まっていません（児童の登録か、今日の迎え時刻に入れてください）`:`${a.c.name}：下校時刻が決まっていません（学校の時刻表か、今日の迎え時刻を入れてください）`});
      if(!inPick[a.c.id])iss.push({lv:'bad',txt:`${a.c.name}：お迎えの便が決まっていません`,cid:a.c.id,kind:'pickup'});
    }
    if(a.drop&&!inDrop[a.c.id])iss.push({lv:'bad',txt:`${a.c.name}：送りの便が決まっていません`,cid:a.c.id,kind:'drop'});
  }
  for(const c in inPick){if(inPick[c]>1)iss.push({lv:'bad',txt:`${l.ch[c]?.name||'?'}：お迎えが2つの便に入っています`})}
  for(const c in inDrop){if(inDrop[c]>1)iss.push({lv:'bad',txt:`${l.ch[c]?.name||'?'}：送りが2つの便に入っています`})}
  const attOn=new Set(att.map(a=>a.c.id));
  const av=staffAvail();
  computed.forEach(({t,r})=>{
    const name=t.label,v=l.veh[t.vehicleId],ks=tripKids(t);t._bad=false;
    const add=(lv,txt)=>{iss.push({lv,txt:`${name}：${txt}`,tid:t.id});if(lv==='bad')t._bad=true};
    for(const c of ks)if(!attOn.has(c))add('warn',`${l.ch[c]?.name||'?'}は今日お休みです`);
    if(!v)add('bad','車両が決まっていません');
    else{
      if(ks.length>+v.cap)add('bad',`定員オーバー（${ks.length}人／定員${v.cap}人）`);
      const sn=ks.filter(c=>needsSeat(c,l)).length;if(sn>(+v.seats||0))add('bad',`チャイルドシートが足りません（${sn}人／${+v.seats||0}台）`);
      for(const o of computed){if(o.t===t||o.t.vehicleId!==t.vehicleId||o.r.dep==null||r.dep==null)continue;
        if(o.t.id>t.id&&overlap(r.dep,r.ret,o.r.dep,o.r.ret,s.buffer))add('bad',`${v.name}が${o.t.label}と時間が重なっています`)}
    }
    if(!t.driverId)add('bad','運転手が決まっていません');
    else{const d=l.stf[t.driverId];if(d&&!d.canDrive)add('warn',`${d.name}さんは運転手として登録されていません`);
      const a=av[t.driverId];if(!a)add('warn',`${d?.name||'運転手'}さんは今日出勤になっていません`);else if(r.dep!=null&&(a.start>r.dep||a.end<r.ret))add('warn',`${d?.name}さんの勤務時間外です`)}
    if(needEscort(t,l)&&!t.escortId)add('warn','添乗員がいません');
    for(const x of r.stops)if(x.late>s.waitTol)add('warn',`${x.kind==='school'?l.sch[x.schoolId]?.name:(l.ch[x.childIds[0]]?.name+'の家')}に${x.late}分遅れて着きます`);
    if(r.ride>s.maxRide)add('warn',`乗車時間が${r.ride}分になります（上限${s.maxRide}分）`);
    if(r.arrLate>0)add('bad',`事業所に${r.arrLate}分遅れて着きます（入室 ${hm(r.dl)}）`);
  });
  // スタッフの重複
  const sb={};computed.forEach(({t,r})=>{for(const id of [t.driverId,t.escortId])if(id&&r.dep!=null)(sb[id]=sb[id]||[]).push({t,r})});
  for(const id in sb){const a=sb[id];for(let i=0;i<a.length;i++)for(let j=i+1;j<a.length;j++)if(overlap(a[i].r.dep,a[i].r.ret,a[j].r.dep,a[j].r.ret,0))
    iss.push({lv:'bad',txt:`${l.stf[id]?.name||'?'}さんが${a[i].t.label}と${a[j].t.label}に同時に入っています`,tid:a[i].t.id})}
  return iss;
}
function labelTrips(trips,l){
  const c=trips.map(t=>({t,r:computeTrip(t,l)}));
  const pk=c.filter(x=>x.t.kind==='pickup').sort((a,b)=>(a.r.dep??9e9)-(b.r.dep??9e9));
  const dr=c.filter(x=>x.t.kind==='drop').sort((a,b)=>(a.r.dep??9e9)-(b.r.dep??9e9));
  pk.forEach((x,i)=>x.t.label='迎'+(i+1));dr.forEach((x,i)=>x.t.label='送'+(i+1));
  return [...pk,...dr];
}

// ===== データ保存 =====
const COLS=['schools','children','vehicles','staff','logs'];
// claude.ai の外（GitHub Pages など）では、このブラウザの localStorage に保存する
const LS_KEY='sougei-maker-v1';
const LOCAL={days:{}};

// ===== 読み込んだデータの検査 =====
// 保存データ・バックアップファイル・共有データは書き換えられている可能性があるので、
// 画面に出す前に、決まった形・決まった文字だけを通す。
const ID_RE=/^[A-Za-z0-9_-]{1,80}$/,TIME_RE=/^\d{2}:\d{2}$/,DATE_RE=/^\d{4}-\d{2}-\d{2}$/;
const isId=v=>typeof v==='string'&&ID_RE.test(v);
const idOr=v=>isId(v)?v:'';
const timeOr=v=>typeof v==='string'&&TIME_RE.test(v)?v:'';
const numOr=v=>v===''||v==null?'':(Number.isFinite(+v)?+v:'');
const objOr=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const strOr=v=>v==null?'':String(v).slice(0,500);
const NUM_K=new Set(['cap','seats','min','grade','order']);
const REF_K=new Set(['schoolId','areaId','vehicleId','driverId','escortId','tripId']);
const TIME_K=new Set(['pickTime','dropTime','arriveBy','homePickTime','start','end','dep','ret','plannedDep','plannedRet']);
function cleanRec(x){
  if(!x||typeof x!=='object'||!isId(x.id))return null;
  const o={};
  for(const [k,v] of Object.entries(x)){
    if(k==='__proto__'||k==='constructor'||k==='prototype')continue;
    if(NUM_K.has(k))o[k]=numOr(v);
    else if(REF_K.has(k))o[k]=idOr(v);
    else if(TIME_K.has(k))o[k]=timeOr(v);
    else if(k==='days')o[k]=(Array.isArray(v)?v:[]).map(Number).filter(d=>Number.isInteger(d)&&d>=0&&d<=6);
    else if(k==='color')o[k]=VCOLORS.includes(v)?v:'v1';
    else if(k==='pickPlace')o[k]=v==='home'?'home':'school';
    else if(k==='pickOther'||k==='dropOther')o[k]=v==='parent'||v==='self'?v:'';
    else if(k==='kind')o[k]=v==='drop'?'drop':'pickup';
    else if(k==='date')o[k]=typeof v==='string'&&DATE_RE.test(v)?v:'';
    else if(k==='times'){const t={};for(const [d,tt] of Object.entries(objOr(v)))if(/^[0-6]$/.test(d))t[d]={lo:timeOr(objOr(tt).lo),hi:timeOr(objOr(tt).hi)};o[k]=t}
    else if(k==='kids')o[k]=(Array.isArray(v)?v:[]).filter(isId);
    else if(k==='rode'){const r={};for(const [c,b] of Object.entries(objOr(v)))if(isId(c))r[c]=b===true;o[k]=r}
    else if(k==='kidNames'){const r={};for(const [c,n] of Object.entries(objOr(v)))if(isId(c))r[c]=strOr(n);o[k]=r}
    else if(typeof v==='string')o[k]=strOr(v);
    else if(typeof v==='boolean'||(typeof v==='number'&&Number.isFinite(v)))o[k]=v;
  }
  return o;
}
function cleanList(a){return (Array.isArray(a)?a:[]).map(cleanRec).filter(Boolean)}
function cleanSettings(x){
  x=objOr(x);const o={...DEF};
  for(const k of Object.keys(DEF)){
    if(!(k in x))continue;const v=x[k],d=DEF[k];
    if(k==='areas')o.areas=(Array.isArray(v)?v:[]).filter(a=>a&&isId(a.id)).map(a=>({id:a.id,name:strOr(a.name),min:numOr(a.min)}));
    else if(typeof d==='number')o[k]=Number.isFinite(+v)?+v:d;
    else if(typeof d==='boolean')o[k]=v===true;
    else if(['closeTime','holidayStart','holidayEnd'].includes(k))o[k]=timeOr(v)||d;
    else if(k==='escortMode')o[k]=['always','min','none'].includes(v)?v:d;
    else o[k]=strOr(v);
  }
  o.sample=x.sample===true;
  return o;
}
function cleanDay(x){
  x=objOr(x);const o=emptyDay();
  o.dayType=['school','holiday'].includes(x.dayType)?x.dayType:'';
  for(const [c,v] of Object.entries(objOr(x.attend)))if(isId(c)){const a=objOr(v),r={};
    for(const k of ['on','pickup','drop'])if(typeof a[k]==='boolean')r[k]=a[k];
    for(const k of ['pickOther','dropOther'])if(['parent','self',''].includes(a[k]))r[k]=a[k];
    if(a.pickPlace!==undefined)r.pickPlace=a.pickPlace==='home'?'home':'school';
    for(const k of ['pickTime','arriveBy','dropTime'])if(a[k]!==undefined)r[k]=timeOr(a[k]);
    o.attend[c]=r}
  for(const [c,v] of Object.entries(objOr(x.staff)))if(isId(c)){const a=objOr(v),r={};
    if(typeof a.on==='boolean')r.on=a.on;for(const k of ['start','end'])if(a[k]!==undefined)r[k]=timeOr(a[k]);
    o.staff[c]=r}
  for(const [c,v] of Object.entries(objOr(x.schoolTimes)))if(isId(c))o.schoolTimes[c]=timeOr(v);
  if(x.plan&&typeof x.plan==='object'){
    const trips=(Array.isArray(x.plan.trips)?x.plan.trips:[]).filter(t=>t&&isId(t.id)).map(t=>({id:t.id,kind:t.kind==='drop'?'drop':'pickup',
      mode:['school','homeOut','homeIn'].includes(t.mode)?t.mode:'school',anchor:timeOr(t.anchor),vehicleId:idOr(t.vehicleId),driverId:idOr(t.driverId),escortId:idOr(t.escortId),
      stops:(Array.isArray(t.stops)?t.stops:[]).map(s0=>{const s=objOr(s0);return {key:strOr(s.key),kind:s.kind==='school'?'school':'home',schoolId:idOr(s.schoolId),sched:timeOr(s.sched),childIds:(Array.isArray(s.childIds)?s.childIds:[]).filter(isId)}})}));
    o.plan={at:strOr(x.plan.at),trips};
  }
  return o;
}
function cleanDays(x){const o={};for(const [d,v] of Object.entries(objOr(x)))if(DATE_RE.test(d))o[d]=cleanDay(v);return o}

// ===== パスコード（この端末に保存するデータの暗号化） =====
// パスコードから PBKDF2（60万回）で鍵を作り、AES-GCM で暗号化して保存する。パスコード自体は保存しない。
const CRYPT={key:null,salt:null};
const LOCK_MIN=15;
let saveChain=Promise.resolve(),lastActive=Date.now();
function b64(buf){const u=buf instanceof Uint8Array?buf:new Uint8Array(buf);let s='';for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s)}
function unb64(s){const b=atob(s),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u}
const canCrypt=()=>!!(window.crypto&&crypto.subtle);
const isBox=d=>!!d&&typeof d==='object'&&typeof d.enc==='string'&&typeof d.ct==='string'&&typeof d.iv==='string'&&typeof d.salt==='string';
async function deriveKey(pass,salt){
  const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:600000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function encryptJSON(data,key,salt){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify(data)));
  return {app:'sougei',v:1,enc:'AES-GCM/PBKDF2-SHA256-600000',salt:b64(salt),iv:b64(iv),ct:b64(ct)};
}
async function decryptJSON(box,key){
  const pt=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(box.iv)},key,unb64(box.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
function lsLoad(){
  let d=null;try{d=JSON.parse(localStorage.getItem(LS_KEY)||'null')}catch(e){console.warn(e)}
  if(isBox(d)){S.locked=true;S.lockBox=d;return}
  applyBackup(d||{});
}
function applyBackup(d){
  d=objOr(d);
  S.settings=cleanSettings(d.settings);S.sample=S.settings.sample;
  for(const c of COLS)S[c]=cleanList(d[c]);
  LOCAL.days=cleanDays(d.days);
  S.day=LOCAL.days[S.date]?cleanDay(LOCAL.days[S.date]):emptyDay();
}
function lsSave(){
  if(S.db||S.locked)return;
  const data=JSON.parse(JSON.stringify(backupData()));
  saveChain=saveChain.then(async()=>{
    try{localStorage.setItem(LS_KEY,JSON.stringify(CRYPT.key?await encryptJSON(data,CRYPT.key,CRYPT.salt):data))}
    catch(e){console.warn(e);toast('このブラウザに保存できませんでした')}
  });
}
async function unlock(){
  const pass=document.getElementById('lock-pass')?.value||'';
  if(!pass||(S.lockWait||0)>Date.now())return;
  S.lockMsg='確認しています…';render();
  try{
    const salt=unb64(S.lockBox.salt),key=await deriveKey(pass,salt),d=await decryptJSON(S.lockBox,key);
    CRYPT.key=key;CRYPT.salt=salt;S.locked=false;S.lockBox=null;S.lockMsg='';S.lockFails=0;lastActive=Date.now();
    applyBackup(d);render();
  }catch(e){
    S.lockFails=(S.lockFails||0)+1;const wait=S.lockFails>=5?30:0;S.lockWait=Date.now()+wait*1000;
    S.lockMsg=wait?`パスコードが違います。${wait}秒待ってからもう一度入れてください。`:'パスコードが違います。';render();
    if(wait)setTimeout(()=>{S.lockMsg='';render()},wait*1000);
  }
}
// 入力途中の保存を済ませてから読み直し、画面とメモリ上のデータを消す
async function lockNow(){S.locking=true;await new Promise(r=>setTimeout(r,700));await saveChain;location.reload()}
['pointerdown','keydown','touchstart'].forEach(ev=>document.addEventListener(ev,()=>{lastActive=Date.now()},{passive:true}));
setInterval(()=>{if(CRYPT.key&&!S.locked&&!S.locking&&Date.now()-lastActive>LOCK_MIN*60000)lockNow()},30000);
document.addEventListener('submit',e=>{if(e.target.id==='lock-form'){e.preventDefault();unlock()}});
function vLock(){
  const waiting=(S.lockWait||0)>Date.now();
  return `<div class="panel" style="max-width:440px;margin:40px auto"><h2>ロック中</h2><p class="muted small">この端末のデータはパスコードで保護されています。</p>
   <form id="lock-form" class="actions" style="margin-top:10px"><input type="password" id="lock-pass" autocomplete="current-password" aria-label="パスコード" style="flex:1"${waiting?' disabled':''}><button class="btn primary" id="lock-go"${waiting?' disabled':''}>開く</button></form>
   ${S.lockMsg?`<p class="small" style="color:var(--bad)">${esc(S.lockMsg)}</p>`:''}
   <details style="margin-top:18px"><summary class="small muted">パスコードを忘れたとき</summary>
   <p class="small muted">パスコードが分からないと、データは誰にも取り出せません。この端末のデータを全部消して、最初からやり直すことはできます（バックアップファイルがあれば、そこから戻せます）。</p>
   <button class="btn sm danger" id="lock-erase" data-act="lock-erase">この端末のデータをすべて消す</button></details></div>`;
}
function csvCell(v){let s=String(v??'');if(/^[=+@\t\r]/.test(s)||(s[0]==='-'&&!/^-[-\d:.\/]*$/.test(s)))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'}
function backupData(){return {settings:S.settings,schools:S.schools,children:S.children,vehicles:S.vehicles,staff:S.staff,logs:S.logs,days:LOCAL.days}}
async function boot(){
  // 他のサイトの中に埋め込まれて、気づかないうちに操作させられるのを防ぐ
  if(window.top!==window.self&&!window.claude){document.getElementById('main').innerHTML='<div class="empty">このページは、他のサイトの中では開けません。<a href="" target="_top" rel="noopener">ここを押して直接開いてください</a></div>';document.getElementById('main').querySelector('a').href=location.href;return}
  if(!window.claude?.use){S.dbState='local';lsLoad();render();return}
  render();
  try{
    const [db,user,dl]=await Promise.all([claude.use('db'),claude.use('user'),claude.use('downloads')]);
    S.downloads=dl;
    if(user){const c=await user.can('data.write');if(c===false)S.canWrite=false}
    if(!db){S.dbState='local';lsLoad();render();return}
    S.db=db;S.dbState='ok';
    db.doc('settings/main').onSnapshot(sn=>{S.settings=cleanSettings(sn.data());S.sample=S.settings.sample;render()},e=>console.warn(e));
    for(const c of COLS)db.collection(c).onSnapshot(sn=>{S[c]=cleanList(sn.docs.map(d=>({...d.data(),id:d.id}))).sort((a,b)=>(a.order??0)-(b.order??0)||String(a.kana||a.name).localeCompare(String(b.kana||b.name),'ja'));render()},e=>console.warn(e));
    subDay();
  }catch(e){console.warn(e);S.dbState='local';lsLoad();render()}
}
function subDay(){
  if(dayUnsub)dayUnsub();S.day=emptyDay();
  if(!S.db){S.day=cleanDay(LOCAL.days[S.date]);render();return}
  dayUnsub=S.db.doc('days/'+S.date).onSnapshot(sn=>{if(sn.metadata.hasPendingWrites||dayDirty)return;S.day=cleanDay(sn.data());render()},e=>console.warn(e));
}
function saveDay(){
  dayDirty=true;clearTimeout(dayTimer);
  const date=S.date,data=JSON.parse(JSON.stringify(S.day,(k,v)=>k.startsWith('_')?undefined:v));
  dayTimer=setTimeout(async()=>{
    if(!S.db){LOCAL.days[date]=data;lsSave();dayDirty=false;return}
    try{await S.db.doc('days/'+date).set(data)}catch(e){writeErr(e)}finally{dayDirty=false}
  },500);
}
function writeErr(e){
  if(e?.code==='invalid_argument'&&S.canWrite){S.canWrite=false;render();toast('この画面では保存できません（閲覧のみ）');return}
  toast(e?.code==='quota_exceeded'?'保存できる件数の上限です。不要なデータを削除してください':'保存できませんでした。もう一度お試しください');
}
async function saveDoc(col,obj){
  const id=obj.id||uid(col[0]);const data={...obj};delete data.id;
  if(!S.db){const arr=S[col];const i=arr.findIndex(x=>x.id===id);if(i>=0)arr[i]={...data,id};else arr.push({...data,id});lsSave();render();return id}
  try{await S.db.doc(col+'/'+id).set(data)}catch(e){writeErr(e)}return id;
}
async function delDoc(col,id){if(!S.db){S[col]=S[col].filter(x=>x.id!==id);lsSave();render();return}try{await S.db.doc(col+'/'+id).delete()}catch(e){writeErr(e)}}
async function saveSettings(patch){
  S.settings={...st(),...patch};render();
  if(!S.db){lsSave();return}try{await S.db.doc('settings/main').set({...S.settings,sample:S.sample})}catch(e){writeErr(e)}
}

// ===== 描画 =====
function render(){
  const ae=document.activeElement,fid=ae&&ae.id,sel=fid&&ae.selectionStart!=null?[ae.selectionStart,ae.selectionEnd]:null;
  const sx=window.scrollX,sy=window.scrollY;
  if(S.edit&&document.querySelector('#main [data-fld]'))try{S.edit.obj=collectForm()}catch(e){}
  document.getElementById('facTitle').textContent=st().facilityName?st().facilityName+' 送迎表':'送迎表メーカー';
  if(S.locked){document.getElementById('tabs').innerHTML='';document.getElementById('banners').innerHTML='';document.getElementById('main').innerHTML=vLock();
    const el=document.getElementById('lock-pass');if(el&&!el.disabled)el.focus();return}
  document.getElementById('tabs').innerHTML=TABS.map(([k,n])=>`<button role="tab" id="tab-${k}" data-act="tab" data-k="${k}" aria-selected="${S.tab===k}">${n}</button>`).join('')
    +(CRYPT.key?`<button id="tab-lock" data-act="lock-now" style="margin-left:auto">ロックする</button>`:'');
  let b='';
  if(S.dbState==='local'&&!CRYPT.key&&S.children.length&&S.tab!=='settings')b+=`<div class="banner info">児童の情報がこの端末に暗号化されずに保存されています。他の人も使う端末なら、「設定」タブでパスコードを設定してください。</div>`;
  if(S.dbState==='local'&&!S.children.length&&!S.vehicles.length)b+=`<div class="banner info">データはこの端末のブラウザに保存されます（他の端末とは共有されません）。別の端末へ移すときやバックアップは「設定」タブの「データのバックアップ」を使ってください。</div>`;
  if(!S.canWrite)b+=`<div class="banner warn">閲覧のみの権限です。編集するには、作成者に「編集できる」権限をもらってください。</div>`;
  if(S.sample)b+=`<div class="banner info"><span>いま入っているのは <b>動作確認用のサンプルデータ</b> です（名前に「例」が付いています）。自分の事業所のデータに入れ替えて使ってください。</span>${S.confirm==='wipe'?`<span class="actions"><b>サンプルを全て消しますか？</b><button class="btn sm danger" id="wipe-yes" data-act="wipe-yes">消す</button><button class="btn sm" id="wipe-no" data-act="confirm-no">やめる</button></span>`:`<button class="btn sm" id="wipe" data-act="wipe">サンプルを全て消す</button>`}</div>`;
  document.getElementById('banners').innerHTML=b;
  const m=document.getElementById('main');
  m.innerHTML=({plan:vPlan,record:vRecord,children:vChildren,schools:vSchools,vehicles:vVehicles,staff:vStaff,import:vImport,settings:vSettings}[S.tab])();
  if(fid){const el=document.getElementById(fid);if(el){el.focus({preventScroll:true});if(sel&&el.setSelectionRange)try{el.setSelectionRange(sel[0],sel[1])}catch(e){}}}
  window.scrollTo(sx,sy);
}
function opt(v,t,cur){return `<option value="${esc(v)}"${String(cur)===String(v)?' selected':''}>${esc(t)}</option>`}

// ---- 送迎表タブ ----
function vPlan(){
  const l=L(),s=l.s,w=wdOf(S.date),hol=isHoliday();
  if(S.dbState==='loading')return `<div class="empty">読み込んでいます…</div>`;
  if(!S.children.length||!S.vehicles.length||!S.staff.length)return `<div class="panel"><h2>はじめに登録してください</h2>
    <ol class="steps"><li>「設定」で事業所名と地区（方面）を登録</li><li>「学校」で学校と曜日ごとの下校時刻を登録</li><li>「車両」で車と定員・チャイルドシート数を登録</li><li>「スタッフ」で運転できる人と勤務時間を登録</li><li>「児童」を登録（HUGなどのCSV・Excelは「取り込み」から読み込めます）</li></ol>
    <p class="muted small">現在：児童 ${S.children.length}人・車両 ${S.vehicles.length}台・スタッフ ${S.staff.length}人</p></div>`;
  const att=attendance(),av=staffAvail();
  const dt=new Date(S.date+'T00:00:00');
  let h=`<div class="daybar">
    <button class="btn sm" id="d-prev" data-act="day" data-n="-1" aria-label="前の日">‹</button>
    <span class="date">${dt.getMonth()+1}月${dt.getDate()}日（${WD[w]}）</span>
    <button class="btn sm" id="d-next" data-act="day" data-n="1" aria-label="次の日">›</button>
    <input type="date" id="d-pick" value="${S.date}" data-act="date">
    <button class="btn sm" id="d-today" data-act="today">今日</button>
    <span class="seg" role="group" aria-label="日の種類">
      <button id="dt-s" data-act="daytype" data-v="school" aria-pressed="${!hol}">学校がある日</button>
      <button id="dt-h" data-act="daytype" data-v="holiday" aria-pressed="${hol}">休日・長期休暇</button>
    </span>
    <span style="flex:1"></span>
    ${S.confirm==='regen'?`<span class="actions"><b>手で直した内容は上書きされます。${S.logs.some(x=>x.date===S.date)?'送迎の記録は残りますが、作り直した便とはつながらなくなります。':''}</b><button class="btn primary" id="regen-yes" data-act="gen-yes">作り直す</button><button class="btn" id="regen-no" data-act="confirm-no">やめる</button></span>`
      :`<button class="btn" id="bulk-open" data-act="bulk-open" aria-expanded="${!!S.bulk}"${S.canWrite?'':' disabled'}>1週間・1か月をまとめて作成</button><button class="btn primary" id="gen" data-act="gen"${S.canWrite?'':' disabled'}>${S.day.plan?'送迎表を作り直す':'送迎表を自動で作る'}</button>`}
  </div>`;
  if(S.bulk)h+=vBulk();
  const onN=att.filter(a=>a.on).length;
  h+=`<div class="layout"><div>`;
  // 利用予定
  h+=`<div class="panel"><div class="panel-h"><h3>今日の利用（${onN}人）</h3><span class="muted small">${hol?'休日は自宅へお迎え（'+esc(s.holidayStart)+'着）':'入室時間までに事業所へ着くように組みます。迎えの場所は学校か自宅。迎え時刻が空欄なら、学校は下校時刻、自宅は入室時間から逆算'}</span></div>
   <div class="scroll"><table class="att"><thead><tr><th>利用</th><th>呼び名</th><th class="c">迎</th><th>入室・迎え</th><th class="c">送</th><th>退室（送り）</th></tr></thead><tbody>`;
  for(const a of att.sort((x,y)=>(y.on-x.on))){
    const c=a.c,pt=pickTimeFor({...a,pickTime:''},l),dtm=dropTimeFor({...a,dropTime:''},l);
    h+=`<tr class="${a.on?'':'off'}"><td class="c"><input type="checkbox" id="at-on-${c.id}" data-act="att" data-c="${c.id}" data-f="on"${a.on?' checked':''} aria-label="${esc(c.name)} 利用"></td>
      <td><div>${esc(c.name)}</div><div class="muted small">${esc(l.sch[c.schoolId]?.name||'学校未設定')} ${gradeLabel(c.grade)}${c.seat?' <span class="tag">シート</span>':''}${c.needEscort?' <span class="tag">添乗</span>':''}</div></td>
      <td class="c"><select id="at-pk-${c.id}" data-act="att" data-c="${c.id}" data-f="pickSel" aria-label="お迎え" style="padding:2px;font-size:12px"${a.on?'':' disabled'}>${hol?'':opt('school','学校',pickSel(a))}${opt('home','自宅',pickSel(a))}${opt('parent','保護者',pickSel(a))}${opt('self','自走',pickSel(a))}${opt('none','なし',pickSel(a))}</select></td>
      <td><label class="muted small" for="at-ab-${c.id}">入室</label><input type="time" id="at-ab-${c.id}" data-act="att" data-c="${c.id}" data-f="arriveBy" value="${esc(a.arriveBy||'')}"${a.on?'':' disabled'}>
        <label class="muted small" for="at-pt-${c.id}">迎え</label><input type="time" id="at-pt-${c.id}" data-act="att" data-c="${c.id}" data-f="pickTime" value="${esc(a.pickTime)}" title="通常：${esc(pt||'未設定')}"${a.on&&a.pickup?'':' disabled'}><div class="muted small num">${a.pickTime?'迎え時刻を変更':pt?(placeOf(a)==='home'?'家 ':'下校 ')+pt:(deadlineOf(a,l)!=null?'入室から逆算':'未設定')}</div></td>
      <td class="c"><select id="at-dr-${c.id}" data-act="att" data-c="${c.id}" data-f="dropSel" aria-label="送り" style="padding:2px;font-size:12px"${a.on?'':' disabled'}>${opt('car','車',dropSel(a))}${opt('parent','保護者',dropSel(a))}${opt('self','自走',dropSel(a))}${opt('none','なし',dropSel(a))}</select></td>
      <td><input type="time" id="at-dt-${c.id}" data-act="att" data-c="${c.id}" data-f="dropTime" value="${esc(a.dropTime)}"${a.on&&(a.drop||a.dropOther)?'':' disabled'}><div class="muted small num">${a.dropTime?'変更':dtm}</div></td></tr>`;
  }
  h+=`</tbody></table></div></div>`;
  // 学校の時刻変更
  if(!hol&&S.schools.length){
    h+=`<details class="panel"><summary>今日だけ下校時刻が違う学校</summary><p class="muted small">短縮授業や行事のときに入れてください。その学校の全員に反映されます。</p><table><tbody>`;
    for(const sc of S.schools){const t=sc.times?.[String(w)]||{};
      h+=`<tr><td>${esc(sc.name)}<div class="muted small num">通常 ${esc(t.lo||'-')}${t.hi&&t.hi!==t.lo?' / 高学年 '+esc(t.hi):''}</div></td><td><input type="time" id="st-${sc.id}" data-act="schooltime" data-s="${sc.id}" value="${esc(S.day.schoolTimes?.[sc.id]||'')}"></td></tr>`}
    h+=`</tbody></table></details>`;
  }
  // 出勤
  h+=`<details class="panel" open><summary>今日の出勤（${Object.values(av).filter(Boolean).length}人）</summary><table class="att"><tbody>`;
  for(const p of S.staff){const base={on:(p.days||[]).includes(w),start:p.start||'13:00',end:p.end||'19:00',...(S.day.staff?.[p.id]||{})};
    h+=`<tr class="${base.on?'':'off'}"><td class="c"><input type="checkbox" id="sf-on-${p.id}" data-act="sf" data-p="${p.id}" data-f="on"${base.on?' checked':''} aria-label="${esc(p.name)} 出勤"></td>
     <td>${esc(p.name)} ${p.canDrive?'<span class="tag">運転</span>':''}</td>
     <td><input type="time" id="sf-st-${p.id}" data-act="sf" data-p="${p.id}" data-f="start" value="${esc(base.start)}"${base.on?'':' disabled'}></td>
     <td><input type="time" id="sf-en-${p.id}" data-act="sf" data-p="${p.id}" data-f="end" value="${esc(base.end)}"${base.on?'':' disabled'}></td></tr>`}
  h+=`</tbody></table></details></div><div>`;
  // 結果
  h+=vResult(l);
  h+=`</div></div>`;
  return h;
}
function vResult(l){
  const plan=S.day.plan;
  if(!plan||!plan.trips)return `<div class="panel"><h2>送迎表はまだありません</h2><p class="muted">左で今日の利用と出勤を確認して、「送迎表を自動で作る」を押してください。学校の下校時刻・車の定員とチャイルドシート・運転手の勤務時間をもとに便を組みます。</p></div>`;
  const trips=plan.trips,c=labelTrips(trips,l),iss=validate(trips,l);
  const bad=iss.filter(i=>i.lv==='bad').length,warn=iss.length-bad;
  const pk=trips.filter(t=>t.kind==='pickup').length,dr=trips.length-pk;
  let h=`<div class="stats"><span class="chip">お迎え <b>${pk}</b>便</span><span class="chip">送り <b>${dr}</b>便</span><span class="chip">使用車両 <b>${new Set(trips.map(t=>t.vehicleId).filter(Boolean)).size}</b>台</span>
    ${bad?`<span class="chip bad">要対応 <b>${bad}</b></span>`:''}${warn?`<span class="chip warn">注意 <b>${warn}</b></span>`:''}${!bad&&!warn?'<span class="chip ok">問題なし</span>':''}
    <span style="flex:1"></span>
    <span class="seg"><button id="vw-b" data-act="view" data-v="board" aria-pressed="${S.view==='board'}">ボード</button><button id="vw-v" data-act="view" data-v="vehicle" aria-pressed="${S.view==='vehicle'}">便ごと</button><button id="vw-c" data-act="view" data-v="child" aria-pressed="${S.view==='child'}">児童ごと</button><button id="vw-s" data-act="view" data-v="staff" aria-pressed="${S.view==='staff'}">スタッフごと</button></span></div>`;
  if(iss.length)h+=`<ul class="issues">${iss.slice(0,40).map(i=>`<li class="${i.lv}"><span>${i.lv==='bad'?'●':'▲'}</span><span>${esc(i.txt)}</span></li>`).join('')}${iss.length>40?`<li class="warn">ほか ${iss.length-40}件</li>`:''}</ul>`;
  h+=`<div class="panel${S.view==='board'?' no-print':''}"><div class="panel-h"><h3>運行タイムライン</h3><span class="muted small">棒を押すとその便に移動します</span></div><div class="scroll">${gantt(c,l)}</div>
    <div class="legend"><span><i></i>お迎え（学校など→事業所）</span><span><i class="d"></i>送り（事業所→自宅）</span></div></div>`;
  h+=`<div class="actions" style="margin:14px 0">
    <button class="btn" id="copy-text" data-act="copytext">連絡用テキストをコピー</button>
    <button class="btn" id="csv" data-act="csv">CSVで保存（Excel用）</button>
    <span class="muted small">作成：${plan.at?new Date(plan.at).toLocaleString('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):''}　便の車・運転手・児童は下で直せます</span></div>`;
  if(S.copyText)h+=`<textarea id="copy-area" readonly style="margin-bottom:14px">${esc(S.copyText)}</textarea>`;
  const un=iss.filter(i=>i.cid);
  if(un.length)h+=`<div class="panel" style="margin-bottom:14px"><h3>便が決まっていない児童</h3><div class="kids" style="margin-top:8px">${un.map(i=>kidChip(i.cid,i.kind,null,trips,l)).join('')}</div></div>`;
  if(S.view==='board')return h+boardView(c,l);
  if(S.view==='child')return h+childTable(c,l);
  if(S.view==='staff')return h+staffTable(c,l);
  for(const kind of ['pickup','drop']){
    const list=c.filter(x=>x.t.kind===kind);
    h+=`<div class="section-h"><h2>${kind==='pickup'?'お迎え':'送り'}</h2><span class="muted small">${list.length}便・${list.reduce((n,x)=>n+tripKids(x.t).length,0)}人</span></div>`;
    h+=list.length?`<div class="trips">${list.map(x=>tripCard(x.t,x.r,l,trips)).join('')}</div>`:`<div class="empty">この日の${kind==='pickup'?'お迎え':'送り'}はありません</div>`;
  }
  return h;
}
function vColor(v){return v?`var(--${v.color||'v1'})`:'var(--muted)'}
function gantt(c,l){
  const deps=c.map(x=>x.r.dep).filter(x=>x!=null),rets=c.map(x=>x.r.ret).filter(x=>x!=null);
  if(!deps.length)return '<div class="empty">便がありません</div>';
  const t0=Math.floor(Math.min(...deps)/60)*60,t1=Math.ceil(Math.max(...rets)/60)*60,span=Math.max(60,t1-t0);
  const pct=t=>((t-t0)/span*100).toFixed(2)+'%';
  let ruler='',grid='';for(let t=t0;t<=t1;t+=30){if(t%60===0)ruler+=`<span style="left:${pct(t)}">${t/60}:00</span>`;grid+=`<div class="g-grid" style="left:${pct(t)}"></div>`}
  const rows=[...S.vehicles];if(c.some(x=>!l.veh[x.t.vehicleId]))rows.push({id:'',name:'車両未定'});
  let h=`<div class="gantt"><div class="g-ruler">${ruler}</div>`;
  for(const v of rows){
    const items=c.filter(x=>(x.t.vehicleId||'')===v.id&&(v.id||!l.veh[x.t.vehicleId])&&x.r.dep!=null);
    if(v.id&&!items.length&&v.active===false)continue;
    h+=`<div class="g-row"><div class="g-label">${v.id?`<span class="swatch" style="--vc:${vColor(v)}"></span>`:''}${esc(v.name)}${v.id?`<div class="num">定員${+v.cap||0}・シート${+v.seats||0}</div>`:''}</div><div class="g-track">${grid}`;
    for(const {t,r} of items){
      const d=l.stf[t.driverId];
      h+=`<div class="g-bar ${t.kind}${t._bad?' bad':''}" style="--vc:${vColor(l.veh[t.vehicleId])};left:${pct(r.dep)};width:calc(${((r.ret-r.dep)/span*100).toFixed(2)}% - 2px)" data-act="jump" data-t="${t.id}" tabindex="0" role="button" title="${esc(t.label)} ${hm(r.dep)}〜${hm(r.ret)} ${esc(d?.name||'運転手未定')}"><b>${esc(t.label)}</b> ${tripKids(t).length}人<br>${esc(d?.name||'運転手未定')}</div>`;
    }
    h+=`</div></div>`;
  }
  return h+'</div>';
}
function tripCard(t,r,l,trips){
  const v=l.veh[t.vehicleId],ks=tripKids(t),sn=ks.filter(c=>needsSeat(c,l)).length;
  const sel=(f,list,cur,none)=>`<select id="tc-${f}-${t.id}" data-act="tripset" data-t="${t.id}" data-f="${f}">${opt('',none,cur)}${list.map(x=>opt(x.id,x.name+(x.extra||''),cur)).join('')}</select>`;
  const av=staffAvail();
  const staffList=S.staff.map(p=>({...p,extra:av[p.id]?'':'（休み）'}));
  let h=`<article class="trip${t._bad?' bad':''}" id="trip-${t.id}" style="--vc:${vColor(v)}">
   <div class="trip-h"><span class="t">${esc(t.label)}　${t.mode==='school'?(t.stops.every(x=>x.kind==='school')?'学校→事業所':t.stops.every(x=>x.kind==='home')?'自宅→事業所':'学校・自宅→事業所'):t.mode==='homeIn'?'自宅→事業所':'事業所→自宅'}</span><span class="tm">${hm(r.dep)} 発 → <span style="${r.arrLate>0?'color:var(--bad);font-weight:700':''}">${hm(r.ret)} 着</span></span></div>
   <div class="trip-crew"><span class="muted">車両</span>${sel('vehicleId',S.vehicles.map(x=>({...x,extra:`（${x.cap}人）`})),t.vehicleId,'未定')}
     <span class="muted">運転</span>${sel('driverId',staffList.filter(p=>p.canDrive||p.id===t.driverId),t.driverId,'未定')}
     <span class="muted">添乗</span>${sel('escortId',staffList,t.escortId,needEscort(t,l)?'未定（必要）':'なし')}</div><ol class="stops">`;
  if(t.mode!=='homeIn')h+=`<li class="stop"><span class="tm">${hm(r.dep)}</span><span class="where muted">事業所 発</span></li>`;
  for(const x of r.stops){
    const where=x.kind==='school'?(l.sch[x.schoolId]?.name||'学校'):(l.ch[x.childIds[0]]?.address||'自宅');
    h+=`<li class="stop"><span class="tm${x.late>l.s.waitTol?' late':''}">${hm(x.time)}</span><div><div class="where">${esc(where)}${x.kind==='home'&&t.kind==='pickup'?' <span class="tag">自宅</span>':''}${x.kind==='home'&&!x.sched&&t.kind==='pickup'?'<span class="muted small">（入室時間から逆算）</span>':''}${x.late>0&&x.sched?`<span class="muted small">（${x.kind==='school'?'下校':'約束'}${esc(x.sched)}・${x.late}分待たせる）</span>`:''}</div>
      <div class="kids">${x.childIds.map(cid=>kidChip(cid,t.kind,t.id,trips,l)).join('')}</div></div></li>`;
  }
  h+=`<li class="stop"><span class="tm"${r.arrLate>0?' style="color:var(--bad)"':''}>${hm(r.ret)}</span><span class="where muted">事業所 着${r.dl!=null?`（入室 ${hm(r.dl)}${r.arrLate>0?'・'+r.arrLate+'分遅れ':'に間に合う'}）`:''}</span></li></ol>
   <div class="trip-f"><span>${ks.length}人${v?`／定員${v.cap}`:''}・シート${sn}${v?`／${+v.seats||0}`:''}</span><span>乗車 最長${r.ride}分</span></div></article>`;
  return h;
}
function kidChip(cid,kind,tid,trips,l){
  const c=l.ch[cid];if(!c)return '';
  const others=labelTrips(trips,l).filter(x=>x.t.kind===kind&&x.t.id!==tid);
  return `<span class="kid">${esc(c.name)}${c.seat?' <span class="tag">シ</span>':''}<select id="mv-${kind}-${cid}" data-act="move" data-c="${cid}" data-k="${kind}" data-from="${tid||''}" aria-label="${esc(c.name)}を別の便へ" title="別の便へ移す">
    <option value="">⇄</option>${others.map(x=>`<option value="${x.t.id}">${esc(x.t.label)}（${esc(l.veh[x.t.vehicleId]?.name||'車未定')} ${hm(x.r.dep)}発）へ</option>`).join('')}<option value="__new">新しい便をつくる</option>${tid?'<option value="__none">便から外す</option>':''}</select></span>`;
}
function childTable(c,l){
  const att=attendance().filter(a=>a.on);
  const find=(cid,kind)=>{for(const {t,r} of c){if(t.kind!==kind)continue;const s=r.stops.find(x=>x.childIds.includes(cid));if(s)return {t,s}}return null};
  let h=`<div class="panel"><div class="scroll"><table><thead><tr><th>名前</th><th>学校</th><th>お迎え</th><th>送り</th></tr></thead><tbody>`;
  for(const a of att){
    const p=find(a.c.id,'pickup'),d=find(a.c.id,'drop');
    const cell=(x,want,other)=>!want?(other?`<span class="tag">${OTHER[other]}</span>`:'<span class="muted">なし</span>'):x?`<span class="num">${hm(x.s.time)}</span> ${esc(x.t.label)}・${esc(l.veh[x.t.vehicleId]?.name||'車未定')}<div class="muted small">運転 ${esc(l.stf[x.t.driverId]?.name||'未定')}${x.t.escortId?'／添乗 '+esc(l.stf[x.t.escortId]?.name):''}</div>`:'<span class="chip bad">未定</span>';
    h+=`<tr><td>${esc(a.c.name)}</td><td>${esc(l.sch[a.c.schoolId]?.name||'')} ${gradeLabel(a.c.grade)}</td><td>${cell(p,a.pickup,a.pickOther)}</td><td>${cell(d,a.drop,a.dropOther)}</td></tr>`;
  }
  return h+'</tbody></table></div></div>';
}

// ---- ボード表示（事業所のホワイトボードと同じ並び） ----
function boardView(c,l){
  const att=attendance().filter(a=>a.on),dt=new Date(S.date+'T00:00:00');
  const car=v=>`<span class="mg-car" style="--vc:${vColor(v)}">${esc(v?.name||'車未定')}</span>`;
  const drv=t=>`<span class="mg-drv">${esc(l.stf[t.driverId]?.name||'運転手未定')}</span>${t.escortId?`<div class="mg-sub">添乗 ${esc(l.stf[t.escortId]?.name||'')}</div>`:''}`;
  const kids=ids=>ids.map(id=>{const k=l.ch[id];return k?`<span class="mg-kid">${k.kana?`<small>${esc(k.kana)}</small>`:''}${esc(k.name)}</span>`:''}).join('');
  const section=(kind,title,timeHead)=>{
    const rows=[];
    for(const {t,r} of c.filter(x=>x.t.kind===kind)){
      const n=r.stops.length||1;
      const html=r.stops.map((x,i)=>`<tr${i===0?' class="mg-first"':''}>${i===0?`<td rowspan="${n}">${car(l.veh[t.vehicleId])}</td><td rowspan="${n}">${drv(t)}</td>`:''}<td>${kids(x.childIds)}</td>${i===0?`<td rowspan="${n}" class="mg-tm">${hm(r.dep)}</td>`:''}<td class="mg-tm">${hm(x.time)}</td></tr>`).join('');
      rows.push({tm:r.dep??0,html});
    }
    // 保護者・自走は、同じ時刻の子をまとめて1行に
    const groups={};
    for(const a of att){
      const other=kind==='pickup'?(!a.pickup&&a.pickOther):(!a.drop&&a.dropOther);if(!other)continue;
      const time=kind==='pickup'?(a.arriveBy||a.pickTime||(isHoliday()?l.s.holidayStart:a.c.arriveBy)||''):dropTimeFor(a,l);
      const g=(groups[other+'|'+time]=groups[other+'|'+time]||{other,time,ids:[]});g.ids.push(a.c.id);
    }
    for(const g of Object.values(groups))rows.push({tm:tm(g.time)??9e9,html:`<tr class="mg-first"><td colspan="2"><span class="mg-label">${OTHER[g.other]}</span></td><td>${kids(g.ids)}</td><td></td><td class="mg-tm">${esc(g.time||'--:--')}</td></tr>`});
    rows.sort((a,b)=>a.tm-b.tm);
    return `<div class="board-h"><span class="kind ${kind}">${title}</span></div>
      <div class="scroll"><table class="mg"><thead><tr><th>配車</th><th>運転手</th><th>利用者</th><th>出発時間</th><th>${timeHead}</th></tr></thead>
      <tbody>${rows.map(x=>x.html).join('')||'<tr><td colspan="5" class="muted">なし</td></tr>'}</tbody></table></div>`;
  };
  return `<div class="board-sheet">
    <div class="board-top"><h2>${dt.getMonth()+1}月${dt.getDate()}日（${WD[dt.getDay()]}）</h2><button class="btn sm no-print" id="board-print" data-act="print">印刷</button></div>
    ${section('pickup','迎え','迎え時間')}${section('drop','送り','送り時間')}</div>`;
}

// ---- スタッフ別の予定表 ----
function staffTrips(c,id){return c.filter(x=>x.t.driverId===id||x.t.escortId===id).sort((a,b)=>(a.r.dep??0)-(b.r.dep??0))}
function stopWhere(x,l){return x.kind==='school'?(l.sch[x.schoolId]?.name||'学校'):(l.ch[x.childIds[0]]?.address||'自宅')}
function staffText(p,c,l){
  const dt=new Date(S.date+'T00:00:00');
  let s=`【${p.name}さんの担当 ${dt.getMonth()+1}/${dt.getDate()}（${WD[dt.getDay()]}）】\n`;
  const list=staffTrips(c,p.id);if(!list.length)return s+'担当の便はありません\n';
  for(const {t,r} of list){
    s+=`\n■${t.label} ${t.driverId===p.id?'運転':'添乗'} ${l.veh[t.vehicleId]?.name||'車未定'}  ${hm(r.dep)}発→${hm(r.ret)}着\n`;
    const other=t.driverId===p.id?l.stf[t.escortId]:l.stf[t.driverId];if(other)s+=` ${t.driverId===p.id?'添乗':'運転'}：${other.name}\n`;
    for(const x of r.stops)s+=` ${hm(x.time)} ${stopWhere(x,l)}：${x.childIds.map(id=>l.ch[id]?.name).join('、')}\n`;
  }
  return s;
}
function staffTable(c,l){
  const av=staffAvail();
  let h='<div class="trips">';
  for(const p of S.staff){
    const list=staffTrips(c,p.id);if(!list.length&&!av[p.id])continue;
    const nd=list.filter(x=>x.t.driverId===p.id).length,ne=list.length-nd;
    h+=`<article class="trip"><div class="trip-h"><span class="t">${esc(p.name)}</span><span class="tm">${av[p.id]?`${hm(av[p.id].start)}〜${hm(av[p.id].end)}`:'休み'}</span></div>
      <div class="trip-crew"><span class="muted">担当</span><span>運転 ${nd}便・添乗 ${ne}便</span></div><ol class="stops">`;
    if(!list.length)h+=`<li class="stop"><span class="tm">-</span><span class="muted">担当の便はありません</span></li>`;
    for(const {t,r} of list){
      const me=t.driverId===p.id?'運転':'添乗',other=t.driverId===p.id?l.stf[t.escortId]:l.stf[t.driverId];
      h+=`<li class="stop"><span class="tm">${hm(r.dep)}</span><div><div class="where">${esc(t.label)} <span class="tag">${me}</span> ${esc(l.veh[t.vehicleId]?.name||'車未定')}　<span class="num muted small">〜${hm(r.ret)}着</span></div>
        <div class="muted small">${other?`${t.driverId===p.id?'添乗':'運転'}：${esc(other.name)}　`:''}${r.stops.map(x=>`${hm(x.time)} ${esc(stopWhere(x,l))}（${x.childIds.map(id=>esc(l.ch[id]?.name||'?')).join('・')}）`).join(' → ')}</div></div></li>`;
    }
    h+=`</ol><div class="trip-f"><span></span><button class="btn sm" id="cps-${p.id}" data-act="copystaff" data-p="${p.id}">この人の予定をコピー</button></div></article>`;
  }
  return h+'</div>';
}
async function copyText(t){
  try{await navigator.clipboard.writeText(t);toast('コピーしました。LINEなどに貼り付けられます')}
  catch(err){S.copyText=t;render();const ta=document.getElementById('copy-area');if(ta){ta.focus();ta.select()}toast('下の枠の文字をコピーしてください')}
}

// ---- 1週間・1か月をまとめて作成 ----
function weekRange(d){const w=wdOf(d),mon=addDays(d,w===0?-6:1-w);return [mon,addDays(mon,6)]}
function monthRange(d){const y=+d.slice(0,4),m=+d.slice(5,7),last=new Date(y,m,0).getDate();return [d.slice(0,8)+'01',d.slice(0,8)+String(last).padStart(2,'0')]}
function md(d){return +d.slice(5,7)+'/'+ +d.slice(8)+'（'+WD[wdOf(d)]+'）'}
function vBulk(){
  const b=S.bulk;
  let h=`<div class="panel" style="margin-bottom:14px"><div class="panel-h"><h3>1週間・1か月をまとめて作成</h3><button class="btn sm" id="bulk-close" data-act="bulk-open">閉じる</button></div>
   <p class="muted small">期間内の毎日について、その日の利用（児童の曜日、またはHUGから取り込んだ利用予定）と出勤をもとに送迎表を作ります。利用する児童がいない日は作りません。</p>
   <div class="actions" style="margin:8px 0"><button class="btn sm" id="bulk-week" data-act="bulk-range" data-v="week">この週</button><button class="btn sm" id="bulk-month" data-act="bulk-range" data-v="month">この月</button></div>
   <div class="form">
    <label for="b-from">開始日<input type="date" id="b-from" data-act="bulk-f" data-f="from" value="${esc(b.from)}"></label>
    <label for="b-to">終了日<input type="date" id="b-to" data-act="bulk-f" data-f="to" value="${esc(b.to)}"></label>
    <label for="b-type">日の種類<select id="b-type" data-act="bulk-f" data-f="type">${opt('auto','そのまま（土日は休日）',b.type)}${opt('school','すべて学校がある日',b.type)}${opt('holiday','すべて休日・長期休暇',b.type)}</select></label>
    <label class="cb"><input type="checkbox" id="b-over" data-act="bulk-f" data-f="over"${b.over?' checked':''}>作成済みの日も作り直す</label>
   </div>
   <div class="actions"><button class="btn primary" id="bulk-go" data-act="bulk-go"${b.busy?' disabled':''}>${b.busy?'作成しています…':'この期間の送迎表を作る'}</button></div>`;
  if(b.result){const r=b.result;
    h+=`<div class="banner info" style="margin:12px 0 0">${r.made}日分を作成しました。${r.skip?`作成済みの${r.skip}日はそのままにしました。`:''}${r.none?`利用する児童がいない日が${r.none}日ありました。`:''}</div>`;
    if(r.days.length)h+=`<div class="bulk-days">${r.days.map(x=>`<button class="btn sm" id="bd-${x.d}" data-act="goto" data-d="${x.d}">${md(x.d)} ${x.bad?`<span class="chip bad">要対応 ${x.bad}</span>`:x.warn?`<span class="chip warn">注意 ${x.warn}</span>`:'<span class="chip ok">問題なし</span>'}</button>`).join('')}</div><p class="muted small">日付を押すと、その日の送迎表を開きます。</p>`;
  }
  return h+'</div>';
}
async function loadDay(d){
  if(d===S.date)return S.day;
  if(S.db){try{const sn=await S.db.doc('days/'+d).get();return cleanDay(sn.exists?sn.data():{})}catch(e){return emptyDay()}}
  return cleanDay(LOCAL.days[d]);
}
async function storeDay(d,day){
  if(d===S.date){S.day=day;saveDay();return}
  const data=JSON.parse(JSON.stringify(day,(k,v)=>k.startsWith('_')?undefined:v));
  if(S.db){try{await S.db.doc('days/'+d).set(data)}catch(e){writeErr(e)}}else{LOCAL.days[d]=data;lsSave()}
}
// 計算は S.date / S.day を見るので、一時的にその日に切り替えて実行する
function withDay(d,day,fn){const sd=S.date,sday=S.day;S.date=d;S.day=day;try{return fn()}finally{S.date=sd;S.day=sday}}
async function bulkGen(){
  const b=S.bulk;
  if(!b.from||!b.to||b.from>b.to){toast('期間を正しく選んでください');return}
  let n=0;for(let d=b.from;d<=b.to;d=addDays(d,1))n++;
  if(n>62){toast('一度に作れるのは62日までです');return}
  b.busy=true;b.result=null;render();
  const r={made:0,skip:0,none:0,days:[]};
  for(let d=b.from;d<=b.to;d=addDays(d,1)){
    let day=await loadDay(d);
    if(day.plan?.trips?.length&&!b.over){r.skip++;continue}
    if(b.type!=='auto')day={...day,dayType:b.type};
    const res=withDay(d,day,()=>{if(!attendance().some(a=>a.on))return null;const trips=autoPlan();labelTrips(trips,L());const iss=validate(trips,L());return {trips,bad:iss.filter(i=>i.lv==='bad').length,warn:iss.filter(i=>i.lv!=='bad').length}});
    if(!res||!res.trips.length){r.none++;continue}
    await storeDay(d,{...day,plan:{at:new Date().toISOString(),trips:res.trips}});
    r.made++;r.days.push({d,bad:res.bad,warn:res.warn});
  }
  b.busy=false;b.result=r;render();toast(`${r.made}日分の送迎表を作成しました`);
}

// ---- 送迎の記録 ----
function nowHM(){const d=new Date();return hm(d.getHours()*60+d.getMinutes())}
function logId(tid){return S.date+'__'+tid}
function logOf(tid){return S.logs.find(x=>x.id===logId(tid))}
async function saveLog(tid,patch){
  if(!S.canWrite){toast('閲覧のみの権限です');return}
  const l=L(),c=labelTrips(planTrips(),l),x=c.find(y=>y.t.id===tid);if(!x)return;
  const t=x.t,ks=tripKids(t);
  const cur=logOf(tid)||{id:logId(tid),date:S.date,tripId:tid,dep:'',ret:'',note:'',rode:{}};
  await saveDoc('logs',{...cur,...patch,label:t.label,kind:t.kind,vehicleId:t.vehicleId,driverId:t.driverId,escortId:t.escortId,
    vehicleName:l.veh[t.vehicleId]?.name||'',driverName:l.stf[t.driverId]?.name||'',escortName:l.stf[t.escortId]?.name||'',
    kids:ks,kidNames:Object.fromEntries(ks.map(id=>[id,l.ch[id]?.name||''])),plannedDep:hm(x.r.dep),plannedRet:hm(x.r.ret),updatedAt:new Date().toISOString()});
}
function vRecord(){
  const l=L(),dt=new Date(S.date+'T00:00:00');
  let h=`<div class="daybar">
    <button class="btn sm" id="rd-prev" data-act="day" data-n="-1" aria-label="前の日">‹</button>
    <span class="date">${dt.getMonth()+1}月${dt.getDate()}日（${WD[dt.getDay()]}）</span>
    <button class="btn sm" id="rd-next" data-act="day" data-n="1" aria-label="次の日">›</button>
    <input type="date" id="rd-pick" value="${S.date}" data-act="date">
    <button class="btn sm" id="rd-today" data-act="today">今日</button></div>
   <p class="muted small" style="margin-top:0">出発・到着は「今」を押すとその時刻が入ります。実際に乗った児童にチェックを付けてください（送迎加算の記録に使えます）。</p>`;
  const trips=planTrips();
  if(!trips.length)h+=`<div class="empty">この日の送迎表がありません。「送迎表」タブで作成してください。</div>`;
  else{
    h+=`<div class="rec-list">`;
    for(const {t,r} of labelTrips(trips,l)){
      const lg=logOf(t.id)||{},rode=lg.rode||{},ks=tripKids(t),n=ks.filter(c=>rode[c]).length;
      const stt=lg.dep&&lg.ret?'<span class="chip ok">完了</span>':lg.dep?'<span class="chip warn">運行中</span>':'<span class="chip">未記録</span>';
      h+=`<article class="trip" style="--vc:${vColor(l.veh[t.vehicleId])}"><div class="trip-h"><span class="t">${esc(t.label)} ${t.kind==='pickup'?'お迎え':'送り'}　${esc(l.veh[t.vehicleId]?.name||'車未定')}</span>${stt}</div>
        <div class="trip-crew"><span class="muted">予定</span><span class="num">${hm(r.dep)} 発 → ${hm(r.ret)} 着</span><span class="muted">担当</span><span>運転 ${esc(l.stf[t.driverId]?.name||'未定')}${t.escortId?'／添乗 '+esc(l.stf[t.escortId]?.name||''):''}</span></div>
        <div class="rec-row"><span class="lab">出発</span><input type="time" id="rc-dep-${t.id}" data-act="rec" data-t="${t.id}" data-f="dep" value="${esc(lg.dep||'')}"><button class="btn" id="rn-dep-${t.id}" data-act="rec-now" data-t="${t.id}" data-f="dep">今</button></div>`;
      for(const x of r.stops)h+=`<div class="rec-stop"><div class="small"><span class="num">${hm(x.time)}</span> <b>${esc(stopWhere(x,l))}</b></div>${x.childIds.map(cid=>`<label class="rec-kid"><input type="checkbox" id="rk-${t.id}-${cid}" data-act="rec-ride" data-t="${t.id}" data-c="${cid}"${rode[cid]?' checked':''}>${esc(l.ch[cid]?.name||'?')}</label>`).join('')}</div>`;
      h+=`<div class="rec-row"><span class="muted small">乗車 ${n}／${ks.length}人</span><button class="btn sm" id="ra-${t.id}" data-act="rec-all" data-t="${t.id}">全員乗車</button></div>
        <div class="rec-row"><span class="lab">到着</span><input type="time" id="rc-ret-${t.id}" data-act="rec" data-t="${t.id}" data-f="ret" value="${esc(lg.ret||'')}"><button class="btn" id="rn-ret-${t.id}" data-act="rec-now" data-t="${t.id}" data-f="ret">今</button></div>
        <div class="rec-row"><input class="rec-note" id="rc-note-${t.id}" data-act="rec" data-t="${t.id}" data-f="note" value="${esc(lg.note||'')}" placeholder="メモ（遅れ・欠席の連絡など）"></div></article>`;
    }
    h+=`</div>`;
    const ids=new Set(trips.map(t=>t.id)),orphan=S.logs.filter(x=>x.date===S.date&&!ids.has(x.tripId));
    if(orphan.length)h+=`<p class="muted small">送迎表を作り直す前の記録が${orphan.length}件あります（月の集計とCSVには含まれます）。</p>`;
  }
  // 月の集計
  const m=S.recMonth||S.date.slice(0,7),logs=monthLogs(m),cnt={};
  for(const lg of logs)for(const cid of lg.kids||[])if(lg.rode?.[cid]){const o=(cnt[cid]=cnt[cid]||{name:l.ch[cid]?.name||lg.kidNames?.[cid]||'?',pickup:0,drop:0});o[lg.kind==='pickup'?'pickup':'drop']++}
  const rows=Object.values(cnt).sort((a,b)=>a.name.localeCompare(b.name,'ja'));
  h+=`<div class="panel" style="margin-top:18px"><div class="panel-h"><h3>月の集計（送迎加算の確認用）</h3><div class="actions"><input type="month" id="rec-month" data-act="rec-month" value="${esc(m)}"><button class="btn" id="rec-csv" data-act="rec-csv"${logs.length?'':' disabled'}>記録をCSVで保存</button></div></div>
    <p class="muted small">「乗車」にチェックが付いた回数（片道ごと）を数えています。記録した便 ${logs.length}件。</p>
    ${rows.length?`<div class="scroll"><table><thead><tr><th>児童</th><th>お迎え</th><th>送り</th><th>合計（片道）</th></tr></thead><tbody>${rows.map(o=>`<tr><td>${esc(o.name)}</td><td class="num">${o.pickup}</td><td class="num">${o.drop}</td><td class="num"><b>${o.pickup+o.drop}</b></td></tr>`).join('')}</tbody></table></div>`:'<div class="empty">この月の乗車記録はまだありません</div>'}</div>`;
  return h;
}
function monthLogs(m){return S.logs.filter(x=>String(x.date||'').startsWith(m)).sort((a,b)=>a.date.localeCompare(b.date)||String(a.plannedDep).localeCompare(String(b.plannedDep)))}
function recordCSV(m){
  const l=L(),q=csvCell;
  const rows=[['日付','便','種類','車両','運転','添乗','予定発','出発','到着','児童','乗車','メモ']];
  for(const lg of monthLogs(m))for(const cid of lg.kids||[])rows.push([lg.date,lg.label,lg.kind==='pickup'?'お迎え':'送り',lg.vehicleName,lg.driverName,lg.escortName,lg.plannedDep,lg.dep,lg.ret,l.ch[cid]?.name||lg.kidNames?.[cid]||'',lg.rode?.[cid]?'○':'×',lg.note]);
  return '﻿'+rows.map(r=>r.map(q).join(',')).join('\r\n');
}
async function saveFile(name,blob){
  if(!S.downloads){downloadBlob(name,blob);return}
  try{await S.downloads.save({filename:name,data:blob});toast('保存しました')}catch(err){if(err?.code!=='declined')toast('保存できませんでした')}
}

// ---- マスタ ----
function masterList(col,cols,rowFn,formFn,title,addLabel){
  const ed=S.edit&&S.edit.col===col?S.edit:null;
  let h=`<div class="panel"><div class="panel-h"><h2>${title}（${S[col].length}）</h2>${S.canWrite?`<button class="btn primary" id="add-${col}" data-act="add" data-col="${col}">${addLabel}</button>`:''}</div>`;
  if(ed)h+=`<div class="panel" style="background:var(--sunken)">${formFn(ed.obj)}<div class="actions"><button class="btn primary" id="save-${col}" data-act="save">保存</button><button class="btn" id="cancel-${col}" data-act="cancel">やめる</button>
    ${ed.obj.id&&S[col].some(x=>x.id===ed.obj.id)?(S.confirm==='del'?`<b>削除しますか？</b><button class="btn danger" id="del-yes" data-act="del-yes">削除する</button><button class="btn" id="del-no" data-act="confirm-no">やめる</button>`:`<button class="btn danger" id="del-${col}" data-act="del">削除</button>`):''}</div></div>`;
  if(!S[col].length)return h+`<div class="empty">まだ登録がありません</div></div>`;
  h+=`<div class="scroll"><table><thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}<th></th></tr></thead><tbody>`;
  for(const x of S[col])h+=`<tr>${rowFn(x).map(v=>`<td>${v}</td>`).join('')}<td>${S.canWrite?`<button class="btn sm" id="ed-${x.id}" data-act="edit" data-col="${col}" data-id="${x.id}">編集</button>`:''}</td></tr>`;
  return h+'</tbody></table></div></div>';
}
function f(id,label,val,type='text',extra=''){return `<label for="${id}">${label}<input id="${id}" data-fld="${id.slice(2)}" type="${type}" value="${esc(val??'')}" ${extra}></label>`}
function fsel(id,label,val,opts){return `<label for="${id}">${label}<select id="${id}" data-fld="${id.slice(2)}">${opts.map(o=>opt(o[0],o[1],val)).join('')}</select></label>`}
function fcb(id,label,val){return `<label class="cb"><input type="checkbox" id="${id}" data-fld="${id.slice(2)}"${val?' checked':''}>${label}</label>`}
function fdays(val){return `<div class="wide"><div class="muted small">利用する曜日</div><div class="days">${[1,2,3,4,5,6,0].map(d=>`<label><input type="checkbox" id="f-day${d}" data-day="${d}"${(val||[]).includes(d)?' checked':''}>${WD[d]}</label>`).join('')}</div></div>`}
const areaOpts=()=>[['','（未設定）'],...(st().areas||[]).map(a=>[a.id,`${a.name}（${a.min}分）`])];
function vChildren(){
  const l=L();
  return masterList('children',['呼び名','学校・学年','地区','曜日','迎/送','メモ'],x=>[
    esc(x.name)+(x.seat?' <span class="tag">シート</span>':'')+(x.needEscort?' <span class="tag">添乗</span>':''),
    esc(l.sch[x.schoolId]?.name||'<未設定>')+' '+gradeLabel(x.grade),
    esc(l.ar[x.areaId]?.name||'')+(x.min?` <span class="num muted">${x.min}分</span>`:''),
    (x.days||[]).slice().sort((a,b)=>(a||7)-(b||7)).map(d=>WD[d]).join(''),
    (x.pickup!==false?(x.pickPlace==='home'?'迎(家'+(x.homePickTime?' '+esc(x.homePickTime):'')+')':'迎(学校)'):(OTHER[x.pickOther]||'－'))+'/'+(x.drop!==false?'送':(OTHER[x.dropOther]||'－'))+(x.dropTime?` <span class="num muted">${esc(x.dropTime)}</span>`:''),
    `<span class="small muted">${esc(x.note||'')}</span>`],
  o=>`<p class="muted small">本名は入れず、職員が分かる呼び方にしてください（例：さとうH、はる（佐））。</p><div class="form">${f('f-name','呼び名',o.name,'text','placeholder="例：さとうH"')}${f('f-kana','ふりがな（ボードで名前の上に出ます・任意）',o.kana)}
    ${fsel('f-schoolId','学校',o.schoolId,[['','（未設定）'],...S.schools.map(s=>[s.id,s.name])])}
    ${fsel('f-grade','学年',o.grade,[['',''],...[1,2,3,4,5,6,7,8,9,10,11,12].map(g=>[g,gradeLabel(g)])])}
    ${f('f-address','自宅の目印（住所は書かなくてOK）',o.address,'text','placeholder="例：中央町・コンビニ横"')}
    ${fsel('f-areaId','自宅の地区（方面）',o.areaId,areaOpts())}
    ${f('f-min','事業所から自宅まで（分）',o.min,'number','min="1" max="120" placeholder="空欄なら地区の時間"')}
    ${f('f-dropTime','いつもの退室（送り）時刻',o.dropTime,'time')}
    ${fdays(o.days)}
    ${fsel('f-pickPlace','いつもの迎えの場所',o.pickPlace||'school',[['school','学校'],['home','自宅']])}${f('f-homePickTime','自宅へ迎えに行く時刻（任意）',o.homePickTime,'time')}${f('f-arriveBy','いつもの入室時間（任意）',o.arriveBy,'time')}${fcb('f-pickup','お迎えあり（車）',o.pickup!==false)}${fcb('f-drop','送りあり（車）',o.drop!==false)}
    ${fsel('f-pickOther','車で迎えないときの来所',o.pickOther||'',[['','—'],['parent','保護者'],['self','自走']])}${fsel('f-dropOther','車で送らないときの帰り',o.dropOther||'',[['','—'],['parent','保護者'],['self','自走']])}
    ${fcb('f-seat','チャイルド／ジュニアシートが必要',o.seat)}${fcb('f-needEscort','添乗員が必要',o.needEscort)}
    <div class="wide">${f('f-note','メモ',o.note)}</div>
    <div class="wide"><label for="f-realName">HUG照合用の本名（任意・本名そのものは保存されません）<input id="f-realName" data-fld="realName" type="text" value="" placeholder="${o.nameKey?'登録済み（変えるときだけ入力）':'HUGの利用予定を取り込むときの照合に使います'}" autocomplete="off"></label></div></div>
    <p class="muted small">同じ目印を入れたきょうだいは、送迎で1か所の停車にまとまります。</p>`,'児童','児童を追加');
}
function vSchools(){
  return masterList('schools',['学校名','地区','所要','下校時刻（低学年／高学年）'],x=>[esc(x.name),esc(L().ar[x.areaId]?.name||''),`<span class="num">${x.min||''}分</span>`,
    `<span class="small num">${[1,2,3,4,5].map(d=>{const t=x.times?.[d]||{};return WD[d]+' '+(t.lo||'-')+(t.hi&&t.hi!==t.lo?'/'+t.hi:'')}).join('　')}</span>`],
  o=>`<div class="form">${f('f-name','学校名',o.name)}${fsel('f-areaId','地区（方面）',o.areaId,areaOpts())}${f('f-min','事業所から（分）',o.min,'number','min="1" max="120"')}</div>
   <div class="scroll"><table class="timegrid"><thead><tr><th>曜日</th><th>低学年（1〜3年）</th><th>高学年（4年〜）・中高</th></tr></thead><tbody>
   ${[1,2,3,4,5,6].map(d=>{const t=o.times?.[d]||{};return `<tr><td>${WD[d]}</td><td><input type="time" id="f-lo${d}" data-tlo="${d}" value="${esc(t.lo||'')}"></td><td><input type="time" id="f-hi${d}" data-thi="${d}" value="${esc(t.hi||'')}"></td></tr>`}).join('')}
   </tbody></table></div><p class="muted small">高学年の欄が空なら、全学年で低学年の時刻を使います。中学・高校・支援学校は低学年の欄だけで大丈夫です。</p>`,'学校','学校を追加');
}
function vVehicles(){
  return masterList('vehicles',['車両','定員（児童）','シート','使用'],x=>[`<span class="swatch" style="--vc:${vColor(x)}"></span>${esc(x.name)}`,`<span class="num">${x.cap||0}</span>`,`<span class="num">${x.seats||0}</span>`,x.active===false?'使わない':'使う'],
  o=>`<div class="form">${f('f-name','車両名',o.name)}${f('f-cap','乗せられる児童の人数',o.cap,'number','min="1" max="20"')}${f('f-seats','チャイルド／ジュニアシートの数',o.seats,'number','min="0" max="10"')}
    ${fsel('f-color','色',o.color||'v1',VCOLORS.map((c,i)=>[c,'色'+(i+1)]))}${fcb('f-active','送迎に使う',o.active!==false)}</div>
    <p class="muted small">定員は運転手・添乗員を除いた、児童が座れる席の数です。</p>`,'車両','車両を追加');
}
function vStaff(){
  return masterList('staff',['名前','運転','出勤曜日','勤務時間'],x=>[esc(x.name),x.canDrive?'できる':'－',(x.days||[]).slice().sort((a,b)=>(a||7)-(b||7)).map(d=>WD[d]).join(''),`<span class="num">${esc(x.start||'')}〜${esc(x.end||'')}</span>`],
  o=>`<div class="form">${f('f-name','名前',o.name)}${fcb('f-canDrive','運転できる',o.canDrive)}${f('f-start','勤務開始',o.start||'13:00','time')}${f('f-end','勤務終了',o.end||'19:00','time')}${fdays(o.days).replace('利用する曜日','出勤する曜日')}</div>
   <p class="muted small">日ごとの休みや時間の変更は「送迎表」タブの「今日の出勤」で直せます。</p>`,'スタッフ','スタッフを追加');
}
function vSettings(){
  const s=st();
  return `<div class="panel"><h2>事業所と送迎のルール</h2><div class="form" style="margin-top:12px">
   ${f('s-facilityName','事業所名',s.facilityName)}
   ${f('s-closeTime','送り出発（学校がある日）',s.closeTime,'time')}${f('s-holidayStart','休日の到着時刻（自宅お迎え）',s.holidayStart,'time')}${f('s-holidayEnd','休日の送り出発',s.holidayEnd,'time')}
   ${fsel('s-escortMode','添乗員',s.escortMode,[['always','全部の便に付ける'],['min','人数が多い便だけ'],['none','付けない']])}
   ${f('s-escortMin','「人数が多い」とは（人以上）',s.escortMin,'number','min="1"')}
   ${f('s-minStay','事業所に残す最低人数',s.minStay,'number','min="0"')}
   ${f('s-waitTol','学校で待たせてよい時間（分）',s.waitTol,'number','min="0"')}${f('s-carWait','乗せたまま次の学校で待つ上限（分）',s.carWait,'number','min="0"')}
   ${f('s-maxRide','乗車時間の上限（分）',s.maxRide,'number','min="10"')}
   ${f('s-schoolHop','同じ地区の学校から学校へ（分）',s.schoolHop,'number','min="0"')}
   ${f('s-houseHop','同じ地区の家から家へ（分）',s.houseHop,'number','min="0"')}
   ${f('s-buffer','便と便のあいだの余裕（分）',s.buffer,'number','min="0"')}
   ${fcb('s-mixAreas','別の地区どうしを1台にまとめてよい',s.mixAreas)}
   ${f('s-areaHop','別の地区への移動に足す時間（分）',s.areaHop,'number','min="0"')}
   </div><button class="btn primary" id="save-settings" data-act="save-settings"${S.canWrite?'':' disabled'}>保存</button></div>
   <div class="panel"><div class="panel-h"><h2>地区（方面）</h2>${S.canWrite?'<button class="btn" id="area-add" data-act="area-add">地区を追加</button>':''}</div>
   <p class="muted small">同じ方面の学校・家を同じ車にまとめます。「事業所から何分か」を入れてください（学校や家ごとに別の時間を入れることもできます）。</p>
   <table><thead><tr><th>地区名</th><th>事業所からの時間（分）</th><th></th></tr></thead><tbody>
   ${(s.areas||[]).map(a=>`<tr><td><input id="ar-n-${a.id}" data-act="area" data-a="${a.id}" data-f="name" value="${esc(a.name)}"></td><td><input id="ar-m-${a.id}" type="number" min="1" data-act="area" data-a="${a.id}" data-f="min" value="${esc(a.min)}" style="width:90px"></td><td><button class="btn sm danger" id="ar-d-${a.id}" data-act="area-del" data-a="${a.id}">削除</button></td></tr>`).join('')}
   </tbody></table>${(s.areas||[]).length?'':'<div class="empty">地区がまだありません</div>'}</div>
   ${S.db?'':vPasscode()}
   ${S.db?'':`<div class="panel"><h2>データのバックアップ</h2>
   <p class="muted small">データはこの端末のブラウザに保存されています。ブラウザの履歴やサイトデータを消すと消えるので、ときどきファイルに書き出してください。別の端末で使うときは、書き出したファイルをその端末で読み込みます。</p>
   <div class="actions"><button class="btn" id="bk-export" data-act="backup-export">ファイルに書き出す</button>
   <label class="btn" for="bk-import">ファイルを読み込む</label><input type="file" id="bk-import" accept=".json,application/json" data-act="backup-import" hidden></div>
   <p class="muted small" style="margin-top:8px">${CRYPT.key?'書き出すファイルは、いまのパスコードで暗号化されます。':'パスコードを設定すると、書き出すファイルも暗号化されます。'}暗号化されたファイルを読み込むときは、先にそのファイルのパスコードを入れてください。</p>
   <label for="bk-pass" class="muted small">読み込むファイルのパスコード（暗号化されている場合）<input type="password" id="bk-pass" autocomplete="off" style="display:block;margin-top:2px"></label></div>`}`;
}
function vPasscode(){
  if(!canCrypt())return `<div class="panel"><h2>パスコード</h2><p class="muted small">この開き方ではパスコードを使えません。https のページ（GitHub Pages など）で開いてください。</p></div>`;
  const pwForm=`<div class="form" style="margin-top:8px"><label for="pw-new">${CRYPT.key?'新しいパスコード':'パスコード'}（8文字以上）<input type="password" id="pw-new" autocomplete="new-password"></label><label for="pw-new2">もう一度<input type="password" id="pw-new2" autocomplete="new-password"></label></div>`;
  return CRYPT.key
   ?`<div class="panel"><h2>パスコード（設定済み）</h2><p class="muted small">この端末に保存するデータは暗号化されています。${LOCK_MIN}分間操作がないと自動でロックされます。</p>${pwForm}
     <div class="actions"><button class="btn" id="pw-set" data-act="pass-set">パスコードを変更</button><button class="btn danger" id="pw-off" data-act="pass-off">パスコードをやめる</button></div></div>`
   :`<div class="panel"><h2>パスコード</h2><p class="muted small">設定すると、この端末に保存する児童・スタッフ・送迎の記録などが暗号化され、開くたびにパスコードが必要になります。${LOCK_MIN}分間操作がないと自動でロックします。<b>パスコードを忘れるとデータは取り出せません。</b>必ず控えておき、バックアップも書き出しておいてください。</p>${pwForm}
     <div class="actions"><button class="btn primary" id="pw-set" data-act="pass-set">パスコードを設定する</button></div></div>`;
}

// ---- 取り込み（HUGなど） ----
const IMP_FIELDS={
  children:[['name','氏名（必須）',/氏名|名前|児童名|利用者名|お子様|^名$/],['kana','ふりがな（呼び名に使います）',/ふりがな|フリガナ|カナ|かな/],['school','学校',/学校|所属/],['grade','学年',/学年/],
    ['address','住所・目印',/住所|自宅|送迎先|目印/],['area','地区',/地区|地域|方面|エリア/],['days','利用曜日',/曜日/],['seat','チャイルドシート',/シート/],['pickPlace','迎えの場所',/迎.*場所|送迎場所|乗車場所|迎え先/],['service','サービス（児発は自宅迎え）',/サービス/],['note','メモ',/^備考$|メモ|特記/]],
  schedule:[['name','氏名か呼び名（必須）',/氏名|名前|児童名|利用者名|呼び名/],['date','日付',/日付|利用日|年月日|^日$/],['pickup','お迎え',/迎え|迎|行き/],['drop','送り',/送り|送|帰り/],
    ['pickPlace','迎えの場所',/迎.*場所|送迎場所|乗車場所|迎え先/],['arriveBy','入室時間',/入室|来所|到着|開始時/],['pickTime','迎え時刻',/迎.*時刻|迎.*時間/],['dropTime','退室・送り時刻',/退室|退所|送.*時|終了時/],['absent','欠席',/欠席|キャンセル|休み/]]
};
function vImport(){
  const I=S.imp;
  let h=`<div class="panel"><h2>HUGなどからデータを取り込む</h2>
   <p class="muted">HUG（ハグ）などの管理ソフトから書き出した <b>CSV・Excelファイル</b> を選ぶか、Excelの表をコピーして下の欄に貼り付けてください。列の並びが違っても、どの列を使うかを選べます。</p>
   <div class="actions" style="margin:10px 0"><span class="seg"><button id="it-c" data-act="imp-target" data-v="children" aria-pressed="${I.target==='children'}">児童の一覧</button><button id="it-s" data-act="imp-target" data-v="schedule" aria-pressed="${I.target==='schedule'}">利用予定</button></span></div>
   <p class="small muted">${I.target==='children'?'「呼び名に変換」にすると、ふりがなから「さとうH」のような呼び名を作り、本名とふりがなはツールに保存しません（あとで利用予定を照合するための暗号だけを残します）。同じ児童は上書き、新しい児童は追加します。学校名・地区名がまだ無ければ自動で登録します。':'HUGの利用予定を本名のまま読み込めます。本名は保存せず、児童一覧を取り込んだときの暗号と照らし合わせます。日付の列が無いときは下で日付を選んでください。「欠席」列に何か入っている行はお休みにします。'}</p>
   <div class="form"><label for="imp-file">ファイル（.csv .xlsx .xls）<input type="file" id="imp-file" accept=".csv,.tsv,.txt,.xlsx,.xls" data-act="imp-file"></label>
   ${I.target==='schedule'?f('i-dateDefault','日付（日付の列が無いとき）',I.dateDefault||S.date,'date'):''}
   ${fcb('i-header','1行目は見出し',I.header)}${I.target==='children'?fcb('i-nick','呼び名に変換して取り込む（本名を保存しない）',I.nick)+fcb('i-addr','住所の列も取り込む',I.addr):''}
   ${I.target==='schedule'?fcb('i-offOthers','取り込んだ日の、名前が無い児童はお休みにする',I.offOthers):''}</div>
   <label for="imp-paste" class="muted small">または貼り付け</label><textarea id="imp-paste" placeholder="Excelで範囲を選んでコピーし、ここに貼り付け"></textarea>
   <div class="actions" style="margin-top:8px"><button class="btn" id="imp-read" data-act="imp-paste">貼り付けた内容を読む</button></div></div>`;
  if(I.msg)h+=`<div class="banner info">${esc(I.msg)}${I.target==='schedule'&&I.lastRange?`<button class="btn sm primary" id="imp-bulk" data-act="imp-bulk">この期間の送迎表をまとめて作る</button>`:''}</div>`;
  if(I.rows&&I.rows.length){
    const head=I.header?I.rows[0]:I.rows[0].map((_,i)=>'列'+(i+1));const body=I.header?I.rows.slice(1):I.rows;
    const fields=IMP_FIELDS[I.target];
    h+=`<div class="panel"><h3>列の対応（${body.length}行）</h3><div class="form" style="margin-top:10px">${fields.map(([k,lab])=>`<label for="im-${k}">${lab}<select id="im-${k}" data-act="imp-map" data-k="${k}">${opt('','使わない',I.map[k]??'')}${head.map((hd,i)=>opt(i,`${hd||'列'+(i+1)}`,I.map[k]??'')).join('')}</select></label>`).join('')}</div>
     <h3>確認（最初の5行）</h3><div class="scroll"><table><thead><tr>${fields.filter(([k])=>I.map[k]!==''&&I.map[k]!=null).map(([,lab])=>`<th>${lab.replace('（必須）','')}</th>`).join('')}</tr></thead><tbody>
     ${body.slice(0,5).map(r=>`<tr>${fields.filter(([k])=>I.map[k]!==''&&I.map[k]!=null).map(([k])=>`<td>${esc(r[I.map[k]])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
     <div class="actions" style="margin-top:10px"><button class="btn primary" id="imp-go" data-act="imp-go"${S.canWrite&&I.map.name!==''&&I.map.name!=null?'':' disabled'}>${body.length}行を取り込む</button>${I.map.name===''||I.map.name==null?'<span class="muted small">名前の列を選んでください</span>':''}</div></div>`;
  }
  return h;
}
function parseCSV(text){
  const delim=text.split('\n')[0].includes('\t')?'\t':',';const rows=[];let row=[],cur='',q=false;
  for(let i=0;i<text.length;i++){const ch=text[i];
    if(q){if(ch==='"'){if(text[i+1]==='"'){cur+='"';i++}else q=false}else cur+=ch}
    else if(ch==='"')q=true;else if(ch===delim){row.push(cur);cur=''}else if(ch==='\n'){row.push(cur);rows.push(row);row=[];cur=''}else if(ch!=='\r')cur+=ch}
  if(cur||row.length){row.push(cur);rows.push(row)}
  return rows.filter(r=>r.some(c=>String(c).trim()));
}
function setImpRows(rows){
  const I=S.imp;rows=rows.map(r=>r.map(c=>String(c??'').trim()));I.map={};I.msg='';
  // HUGの出席表：上にタイトル行がある。見出し行を探し、タイトルの日付を使う
  const hi=rows.slice(0,10).findIndex(r=>r.some(c=>/氏名|名前|児童名|利用者名/.test(c))&&r.filter(Boolean).length>=2);
  if(hi>0){for(const r of rows.slice(0,hi)){const d=parseDate(r.join(' '));if(d){I.dateDefault=d;break}}rows=rows.slice(hi);I.header=true}
  I.rows=rows;
  if(I.header&&I.rows.length){const head=I.rows[0];for(const [k,,re] of IMP_FIELDS[I.target]){const i=head.findIndex(hd=>re.test(hd));if(i>=0)I.map[k]=i}}
  if(I.map.name==null&&I.rows.length)I.map.name=0;
  render();
}
function parseXlsx(buf){
  return new Promise((res,rej)=>{
    let w;try{w=new Worker('js/xlsx-worker.js')}catch(e){rej(e);return}
    const tm=setTimeout(()=>{w.terminate();rej(new Error('timeout'))},20000);
    w.onmessage=e=>{clearTimeout(tm);w.terminate();e.data&&e.data.ok?res(e.data.sheets):rej(new Error(e.data?.msg||'error'))};
    w.onerror=()=>{clearTimeout(tm);w.terminate();rej(new Error('worker'))};
    w.postMessage(buf,[buf]);
  });
}
async function readFile(file){
  if(file.size>10*1024*1024){S.imp.msg='ファイルが大きすぎます（10MBまで）。';render();return}
  const buf=await file.arrayBuffer();
  if(/\.(xlsx|xls)$/i.test(file.name)){
    let sheets;try{sheets=await parseXlsx(buf)}catch(e){console.warn(e);S.imp.msg='Excelファイルを読めませんでした。CSVで書き出すか、表をコピーして貼り付けてください。';render();return}
    if(sheets.length>1){ // 1日1シートの出席表をまとめて読む
      let out=null;
      for(const rows of sheets){const hi=rows.slice(0,10).findIndex(r=>r.some(c=>/氏名|名前|児童名|利用者名/.test(String(c))));if(hi<0)continue;
        let d='';for(const r of rows.slice(0,hi)){d=parseDate(r.join(' '));if(d)break}
        if(!out)out=[['日付',...rows[hi]]];for(const r of rows.slice(hi+1))if(r.some(c=>String(c).trim()))out.push([d,...r])}
      if(out){setImpRows(out);return}
    }
    setImpRows(sheets[0]);return;
  }
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buf)}catch(e){text=new TextDecoder('shift_jis').decode(buf)}
  setImpRows(parseCSV(text.replace(/^﻿/,'')));
}
function splitHugName(cell,kanaCol){
  const lines=String(cell||'').split(/\n/).map(x=>x.trim()).filter(Boolean);
  let real=lines[lines.length-1]||'',kana=kanaCol||'';
  if(lines.length>1&&/^[ぁ-ゖァ-ヺー\s　]+$/.test(lines[0])){kana=kana||lines[0]}
  real=real.replace(/\s*(さん|くん|ちゃん|様)$/,'');
  return {real,kana};
}
function parseGrade(s){s=String(s||'').replace(/[０-９]/g,d=>'０１２３４５６７８９'.indexOf(d));const n=+(s.match(/\d+/)||[])[0];if(!n)return '';
  if(/中/.test(s))return n+6;if(/高/.test(s))return n+9;return n}
function parseDays(s){const out=[];for(let i=0;i<7;i++)if(String(s||'').includes(WD[i]))out.push(i);return out}
function parsePlace(s){s=String(s||'');if(/自宅|家|ご自宅/.test(s))return 'home';if(/学校|校|学童/.test(s))return 'school';return ''}
function truthy(s){s=String(s||'').trim();return !!s&&!/^(無|なし|×|✕|-|－|0|false|不要|いいえ)$/i.test(s)}
function parseDate(s){
  s=String(s||'').trim().replace(/[０-９]/g,d=>'０１２３４５６７８９'.indexOf(d));if(!s)return '';
  if(/^\d{5}$/.test(s)){const d=new Date(Date.UTC(1899,11,30)+(+s)*864e5);return d.toISOString().slice(0,10)}
  let m=s.match(/(\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})/);if(m)return m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
  m=s.match(/(\d{1,2})[\/月](\d{1,2})/);if(m)return S.date.slice(0,4)+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0');
  return '';
}
function parseTime(s){const m=String(s||'').replace(/[０-９：]/g,d=>d==='：'?':':'０１２３４５６７８９'.indexOf(d)).match(/(\d{1,2})[:時](\d{2})?/);return m?m[1].padStart(2,'0')+':'+(m[2]||'00'):''}
async function runImport(){
  const I=S.imp,body=I.header?I.rows.slice(1):I.rows,g=(r,k)=>I.map[k]===''||I.map[k]==null?undefined:r[I.map[k]];
  if(I.target==='children'){
    let add=0,upd=0,noKana=0;const s=st();let areas=[...(s.areas||[])],areaChanged=false;
    const schools=[...S.schools],taken=new Set(S.children.map(c=>c.name));
    for(const r of body){
      const sp=splitHugName(g(r,'name'),g(r,'kana'));const real=sp.real;if(!real)continue;
      const key=await nameKey(real);
      const ex=S.children.find(c=>key&&c.nameKey===key)||S.children.find(c=>normName(c.name)===normName(real));
      let name=real;
      if(I.nick){name=nickFromKana(sp.kana);if(!name){noKana++;name='要変更'}}
      if(!ex){let n=name,i=2;while(taken.has(n))n=name+i++;name=n;taken.add(name)}
      const o=ex?{...ex}:{name,days:[],pickup:true,drop:true};
      if(key)o.nameKey=key;
      if(!I.nick&&sp.kana)o.kana=sp.kana
      const sn=g(r,'school');if(sn){let sc=schools.find(x=>normName(x.name)===normName(sn));
        if(!sc){sc={id:uid('s'),name:sn,min:'',areaId:'',times:{}};schools.push(sc);await saveDoc('schools',sc)}o.schoolId=sc.id}
      const gr=g(r,'grade');if(gr){const p=parseGrade(gr);if(p)o.grade=p}
      const ad=I.addr?g(r,'address'):'';if(ad)o.address=ad;
      const an=g(r,'area');if(an){let a=areas.find(x=>x.name===an);if(!a){a={id:uid('a'),name:an,min:15};areas.push(a);areaChanged=true}o.areaId=a.id}
      const dy=g(r,'days');if(dy){const p=parseDays(dy);if(p.length)o.days=p}
      const se=g(r,'seat');if(se!==undefined)o.seat=truthy(se);
      const pp=parsePlace(g(r,'pickPlace'));if(pp)o.pickPlace=pp;else if(!ex&&/児発|児童発達/.test(g(r,'service')||''))o.pickPlace='home';
      const nt=g(r,'note');if(nt)o.note=nt;
      await saveDoc('children',o);ex?upd++:add++;
    }
    if(areaChanged)await saveSettings({areas});
    I.msg=`児童を ${add}人追加、${upd}人更新しました。`+(noKana?`　ふりがなが無かった${noKana}人は呼び名を「要変更」にしました。「児童」タブで直してください。`:'')+(S.schools.some(s=>!s.times||!Object.keys(s.times).length)?'　新しく登録した学校は「学校」タブで下校時刻を入れてください。':'');
  }else{
    const byDate={},miss=new Set();
    for(const r of body){
      const name=splitHugName(g(r,'name')).real;if(!name)continue;
      const key=await nameKey(name);
      const c=S.children.find(x=>key&&x.nameKey===key)||S.children.find(x=>normName(x.name)===normName(name));if(!c){miss.add(name.slice(0,1)+'…');continue}
      const d=parseDate(g(r,'date'))||I.dateDefault||S.date;
      const e={on:!truthy(g(r,'absent'))};
      if(g(r,'pickup')!==undefined)e.pickup=truthy(g(r,'pickup'));
      if(g(r,'drop')!==undefined)e.drop=truthy(g(r,'drop'));
      const pp=parsePlace(g(r,'pickPlace'));if(pp)e.pickPlace=pp;
      const pt=parseTime(g(r,'pickTime'));if(pt)e.pickTime=pt;const dt=parseTime(g(r,'dropTime'));if(dt)e.dropTime=dt;const ab=parseTime(g(r,'arriveBy'));if(ab)e.arriveBy=ab;
      (byDate[d]=byDate[d]||{})[c.id]=e;
    }
    const dates=Object.keys(byDate).sort();
    for(const d of dates){
      let day=emptyDay();
      if(S.db){try{const sn=await S.db.doc('days/'+d).get();if(sn.exists)day=cleanDay(sn.data())}catch(e){}}else day={...day,...(d===S.date?S.day:(LOCAL.days[d]||{}))};
      const attend={...(day.attend||{})};
      if(I.offOthers)for(const c of S.children)if(!byDate[d][c.id])attend[c.id]={...(attend[c.id]||{}),on:false};
      for(const id in byDate[d])attend[id]={...(attend[id]||{}),...byDate[d][id]};
      day.attend=attend;
      if(d===S.date){S.day=day;saveDay()}else if(S.db){try{await S.db.doc('days/'+d).set(day)}catch(e){writeErr(e)}}else{LOCAL.days[d]=day;lsSave()}
    }
    I.lastRange=dates.length?[dates[0],dates[dates.length-1]]:null;
    I.msg=`${dates.length}日分の利用予定を取り込みました（${dates.map(d=>+d.slice(5,7)+'/'+ +d.slice(8)).slice(0,10).join('、')}${dates.length>10?' ほか':''}）。`+(miss.size?`　照合できなかった行が${miss.size}件あります。その児童は「児童」タブの「HUG照合用の本名」に入れると次から照合できます。`:'');
  }
  I.rows=null;render();
}

// ===== 操作 =====
function collectForm(){
  const o={...S.edit.obj};
  document.querySelectorAll('#main [data-fld]').forEach(el=>{const k=el.dataset.fld;o[k]=el.type==='checkbox'?el.checked:(el.type==='number'?(el.value===''?'':+el.value):el.value)});
  const dayEls=document.querySelectorAll('#main [data-day]');if(dayEls.length)o.days=[...dayEls].filter(e=>e.checked).map(e=>+e.dataset.day);
  const lo=document.querySelectorAll('#main [data-tlo]');if(lo.length){o.times={};lo.forEach(e=>{const d=e.dataset.tlo,hi=document.querySelector(`#main [data-thi="${d}"]`).value;if(e.value||hi)o.times[d]={lo:e.value,hi}})}
  return o;
}
function planTrips(){return S.day.plan?.trips||[]}
function commitPlan(trips){const l=L();trips=trips.filter(t=>t.stops.some(s=>s.childIds.length));trips.forEach(t=>t.stops=t.stops.filter(s=>s.childIds.length));S.day.plan={...S.day.plan,trips};saveDay();render()}
function moveKid(cid,kind,from,to){
  const l=L();let trips=planTrips().map(t=>({...t,stops:t.stops.map(s=>({...s,childIds:s.childIds.slice()}))}));
  if(from)for(const t of trips)if(t.id===from)for(const s of t.stops)s.childIds=s.childIds.filter(c=>c!==cid);
  if(to==='__none'){commitPlan(trips);return}
  const c=l.ch[cid];const a=attendance().find(x=>x.c.id===cid)||{c};
  let t=trips.find(x=>x.id===to);
  if(to==='__new'||!t){const hol=isHoliday();
    t={id:uid('t'),kind,mode:kind==='drop'?'homeOut':'school',anchor:kind==='drop'?dropTimeFor(a,l):l.s.holidayStart,vehicleId:'',driverId:'',escortId:'',stops:[]};trips.push(t)}
  if(t.mode==='school'){const sched=pickTimeFor(a,l)||'';const home=placeOf(a)==='home';
    const g=home?{kind:'home',key:homeKey(c)+'|'+sched,sched}:{kind:'school',key:c.schoolId+'|'+sched,schoolId:c.schoolId,sched};
    const ex=t.stops.find(s=>s.key===g.key&&s.sched===sched);if(ex)ex.childIds.push(cid);else t.stops.push(groupStop(g,[cid]))}
  else{const k=homeKey(c);const ex=t.stops.find(s=>s.key===k);if(ex)ex.childIds.push(cid);else t.stops.push({key:k,kind:'home',childIds:[cid]})}
  commitPlan(trips);
  setTimeout(()=>{const el=document.getElementById('trip-'+t.id);if(el){el.classList.add('flash');setTimeout(()=>el.classList.remove('flash'),1200)}},50);
}
function planText(){
  const l=L(),c=labelTrips(planTrips(),l),dt=new Date(S.date+'T00:00:00');
  let s=`【送迎表 ${dt.getMonth()+1}/${dt.getDate()}（${WD[dt.getDay()]}）】\n`;
  for(const {t,r} of c){
    s+=`\n■${t.label} ${l.veh[t.vehicleId]?.name||'車未定'}  ${hm(r.dep)}発→${hm(r.ret)}着\n 運転：${l.stf[t.driverId]?.name||'未定'}${t.escortId?' ／ 添乗：'+l.stf[t.escortId]?.name:''}\n`;
    for(const x of r.stops)s+=` ${hm(x.time)} ${x.kind==='school'?(l.sch[x.schoolId]?.name||''):(l.ch[x.childIds[0]]?.address||'自宅')}：${x.childIds.map(id=>l.ch[id]?.name).join('、')}\n`;
  }
  return s;
}
function planCSV(){
  const l=L(),c=labelTrips(planTrips(),l),q=csvCell;
  const rows=[['日付','便','種類','車両','運転','添乗','事業所発','時刻','場所','児童','事業所着']];
  for(const {t,r} of c)for(const x of r.stops)for(const id of x.childIds)rows.push([S.date,t.label,t.kind==='pickup'?'お迎え':'送り',l.veh[t.vehicleId]?.name||'',l.stf[t.driverId]?.name||'',l.stf[t.escortId]?.name||'',hm(r.dep),hm(x.time),x.kind==='school'?l.sch[x.schoolId]?.name:(l.ch[id]?.address||'自宅'),l.ch[id]?.name,hm(r.ret)]);
  return '﻿'+rows.map(r=>r.map(q).join(',')).join('\r\n');
}
async function wipeSample(){
  S.confirm=null;
  if(S.db){for(const col of COLS)for(const x of S[col])try{await S.db.doc(col+'/'+x.id).delete()}catch(e){}
    try{await S.db.doc('days/'+S.date).delete()}catch(e){}
    await S.db.doc('settings/main').set({...DEF,sample:false}).catch(writeErr)}
  else{for(const col of COLS)S[col]=[];S.settings={...DEF};LOCAL.days={};lsSave()}
  S.sample=false;S.day=emptyDay();render();toast('サンプルを消しました');
}

document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act;
  if(b.tagName==='SELECT'||(b.tagName==='INPUT'&&b.type!=='button'))return;
  if(a==='tab'){S.tab=b.dataset.k;S.edit=null;S.confirm=null;render();window.scrollTo(0,0)}
  else if(a==='day'){S.date=addDays(S.date,+b.dataset.n);S.confirm=null;subDay();render()}
  else if(a==='today'){S.date=todayStr();subDay();render()}
  else if(a==='daytype'){S.day.dayType=b.dataset.v;saveDay();render()}
  else if(a==='gen'){if(S.day.plan&&S.day.plan.trips?.length){S.confirm='regen';render()}else genPlan()}
  else if(a==='gen-yes'){S.confirm=null;genPlan()}
  else if(a==='confirm-no'){S.confirm=null;render()}
  else if(a==='view'){S.view=b.dataset.v;render()}
  else if(a==='jump'){S.view='vehicle';render();const el=document.getElementById('trip-'+b.dataset.t);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.classList.add('flash');setTimeout(()=>el.classList.remove('flash'),1400)}}
  else if(a==='copytext'){await copyText(planText())}
  else if(a==='print'){window.print()}
  else if(a==='copystaff'){const l=L(),p=l.stf[b.dataset.p];if(p)await copyText(staffText(p,labelTrips(planTrips(),l),l))}
  else if(a==='copyel'){const el=document.getElementById(b.dataset.id);if(el)await copyText(el.value)}
  else if(a==='bulk-open'){if(S.bulk)S.bulk=null;else{const [from,to]=weekRange(S.date);S.bulk={from,to,type:'auto',over:false}}render()}
  else if(a==='bulk-range'){const [from,to]=(b.dataset.v==='month'?monthRange:weekRange)(S.date);Object.assign(S.bulk,{from,to,result:null});render()}
  else if(a==='bulk-go'){await bulkGen()}
  else if(a==='goto'){S.date=b.dataset.d;S.tab='plan';S.view='board';subDay();render();window.scrollTo(0,document.getElementById('gen')?.offsetTop||0)}
  else if(a==='imp-bulk'){const [from,to]=S.imp.lastRange;S.bulk={from,to,type:'auto',over:false};S.tab='plan';render();window.scrollTo(0,0)}
  else if(a==='rec-now'){await saveLog(b.dataset.t,{[b.dataset.f]:nowHM()})}
  else if(a==='rec-all'){const t=planTrips().find(x=>x.id===b.dataset.t);if(t)await saveLog(t.id,{rode:Object.fromEntries(tripKids(t).map(c=>[c,true]))})}
  else if(a==='rec-csv'){const m=S.recMonth||S.date.slice(0,7);await saveFile(`sougei_kiroku_${m}.csv`,new Blob([recordCSV(m)],{type:'text/csv'}))}
  else if(a==='csv'){if(!S.downloads){downloadBlob(`sougei_${S.date}.csv`,new Blob([planCSV()],{type:'text/csv'}));return}try{await S.downloads.save({filename:`送迎表_${S.date}.csv`,data:new Blob([planCSV()],{type:'text/csv'})});toast('保存しました')}catch(err){if(err?.code!=='declined')toast('保存できませんでした')}}
  else if(a==='add'){const col=b.dataset.col;S.edit={col,obj:col==='children'?{days:[1,2,3,4,5],pickup:true,drop:true}:col==='staff'?{days:[1,2,3,4,5],start:'13:00',end:'19:00'}:col==='vehicles'?{cap:6,seats:2,color:VCOLORS[S.vehicles.length%8]}:{times:{}}};S.confirm=null;render();window.scrollTo(0,0)}
  else if(a==='edit'){S.edit={col:b.dataset.col,obj:{...S[b.dataset.col].find(x=>x.id===b.dataset.id)}};S.confirm=null;render();window.scrollTo(0,0)}
  else if(a==='cancel'){S.edit=null;S.confirm=null;render()}
  else if(a==='save'){const o=collectForm();if(!String(o.name||'').trim()){toast('呼び名を入れてください');return}
    if(o.realName){const k=await nameKey(o.realName);if(k)o.nameKey=k}delete o.realName;const col=S.edit.col;S.edit=null;await saveDoc(col,o);toast('保存しました');render()}
  else if(a==='del'){S.confirm='del';render()}
  else if(a==='del-yes'){const {col,obj}=S.edit;S.edit=null;S.confirm=null;await delDoc(col,obj.id);toast('削除しました')}
  else if(a==='save-settings'){const p={};document.querySelectorAll('#main [data-fld]').forEach(el=>{p[el.dataset.fld]=el.type==='checkbox'?el.checked:(el.type==='number'?+el.value:el.value)});await saveSettings(p);toast('保存しました')}
  else if(a==='area-add'){await saveSettings({areas:[...(st().areas||[]),{id:uid('a'),name:'新しい地区',min:15}]})}
  else if(a==='area-del'){await saveSettings({areas:(st().areas||[]).filter(x=>x.id!==b.dataset.a)})}
  else if(a==='imp-target'){S.imp.target=b.dataset.v;if(S.imp.rows)setImpRows(S.imp.rows);else render()}
  else if(a==='imp-paste'){const t=document.getElementById('imp-paste').value;if(!t.trim()){toast('貼り付ける内容がありません');return}setImpRows(parseCSV(t))}
  else if(a==='imp-go'){b.disabled=true;b.textContent='取り込んでいます…';await runImport()}
  else if(a==='wipe'){S.confirm='wipe';render()}
  else if(a==='wipe-yes'){await wipeSample()}
  else if(a==='backup-export'){const data=CRYPT.key?await encryptJSON(backupData(),CRYPT.key,CRYPT.salt):backupData();downloadBlob(`sougei_backup_${todayStr()}.json`,new Blob([JSON.stringify(data,null,1)],{type:'application/json'}))}
  else if(a==='lock-now'){await lockNow()}
  else if(a==='lock-erase'){if(!confirm('この端末の送迎表データをすべて消します。元に戻せません。よろしいですか？'))return;localStorage.removeItem(LS_KEY);location.reload()}
  else if(a==='pass-set'){const p1=document.getElementById('pw-new').value,p2=document.getElementById('pw-new2').value;
    if(p1.length<8){toast('パスコードは8文字以上にしてください');return}if(p1!==p2){toast('2つのパスコードが同じではありません');return}
    const had=!!CRYPT.key;b.disabled=true;const salt=crypto.getRandomValues(new Uint8Array(16));CRYPT.key=await deriveKey(p1,salt);CRYPT.salt=salt;lsSave();await saveChain;lastActive=Date.now();render();toast(had?'パスコードを変更しました':'パスコードを設定しました。データを暗号化しました')}
  else if(a==='pass-off'){if(!confirm('パスコードをやめると、データは暗号化されずに保存されます。よろしいですか？'))return;CRYPT.key=null;CRYPT.salt=null;lsSave();await saveChain;render();toast('パスコードをやめました')}
});
document.addEventListener('change',async e=>{
  const el=e.target,a=el.dataset.act;if(!a)return;
  if(a==='date'&&el.value){S.date=el.value;subDay();render()}
  else if(a==='att'){const c=el.dataset.c,fl=el.dataset.f,v=el.type==='checkbox'?el.checked:el.value;const cur=attendance().find(x=>x.c.id===c);
    const r={on:cur.on,pickup:cur.pickup,drop:cur.drop,pickPlace:cur.pickPlace,pickOther:cur.pickOther,dropOther:cur.dropOther,pickTime:cur.pickTime,arriveBy:cur.arriveBy,dropTime:cur.dropTime};
    if(fl==='pickSel'){if(v==='school'||v==='home')Object.assign(r,{pickup:true,pickPlace:v});else Object.assign(r,{pickup:false,pickOther:v==='none'?'':v})}
    else if(fl==='dropSel'){if(v==='car')r.drop=true;else Object.assign(r,{drop:false,dropOther:v==='none'?'':v})}
    else r[fl]=v;
    S.day.attend={...S.day.attend,[c]:r};saveDay();render()}
  else if(a==='sf'){const p=S.staff.find(x=>x.id===el.dataset.p),w=wdOf(S.date);const cur={on:(p.days||[]).includes(w),start:p.start||'13:00',end:p.end||'19:00',...(S.day.staff?.[p.id]||{})};
    S.day.staff={...S.day.staff,[p.id]:{...cur,[el.dataset.f]:el.type==='checkbox'?el.checked:el.value}};saveDay();render()}
  else if(a==='schooltime'){S.day.schoolTimes={...S.day.schoolTimes,[el.dataset.s]:el.value};saveDay();render()}
  else if(a==='tripset'){const trips=planTrips().map(t=>t.id===el.dataset.t?{...t,[el.dataset.f]:el.value}:t);commitPlan(trips)}
  else if(a==='move'&&el.value){moveKid(el.dataset.c,el.dataset.k,el.dataset.from,el.value)}
  else if(a==='area'){const areas=(st().areas||[]).map(x=>x.id===el.dataset.a?{...x,[el.dataset.f]:el.dataset.f==='min'?+el.value:el.value}:x);await saveSettings({areas})}
  else if(a==='imp-file'&&el.files[0]){await readFile(el.files[0])}
  else if(a==='backup-import'&&el.files[0]){const file=el.files[0];el.value='';
    if(file.size>20*1024*1024){toast('ファイルが大きすぎます');return}
    let d;try{d=JSON.parse(await file.text())}catch(err){toast('バックアップのファイルではありません');return}
    if(isBox(d)){
      if(!canCrypt()){toast('この開き方では暗号化されたファイルを読めません');return}
      try{const salt=unb64(d.salt);let key=CRYPT.salt&&b64(CRYPT.salt)===d.salt?CRYPT.key:null;
        if(!key){const pw=document.getElementById('bk-pass')?.value||'';if(!pw){toast('暗号化されたファイルです。先にそのファイルのパスコードを入れてください');return}key=await deriveKey(pw,salt)}
        d=await decryptJSON(d,key)}catch(err){toast('パスコードが違うか、ファイルが壊れています');return}
    }
    if(!d||typeof d!=='object'||!COLS.some(c=>Array.isArray(d[c]))){toast('バックアップのファイルではありません');return}
    if(!confirm('いまのデータを、読み込んだファイルの内容に置き換えます。よろしいですか？'))return;
    applyBackup(d);lsSave();render();toast('読み込みました')}
  else if(a==='imp-map'){S.imp.map[el.dataset.k]=el.value===''?'':+el.value;render()}
  else if(a==='bulk-f'&&S.bulk){S.bulk[el.dataset.f]=el.type==='checkbox'?el.checked:el.value;S.bulk.result=null;render()}
  else if(a==='rec'){await saveLog(el.dataset.t,{[el.dataset.f]:el.value})}
  else if(a==='rec-ride'){const cur=logOf(el.dataset.t);await saveLog(el.dataset.t,{rode:{...(cur?.rode||{}),[el.dataset.c]:el.checked}})}
  else if(a==='rec-month'){S.recMonth=el.value;render()}
});
document.addEventListener('change',e=>{const el=e.target;if(!el.dataset.fld)return;
  if(S.tab==='import'){const k=el.dataset.fld;if(k==='header'){S.imp.header=el.checked;if(S.imp.rows)setImpRows(S.imp.rows)}else if(k==='nick')S.imp.nick=el.checked;else if(k==='addr')S.imp.addr=el.checked;else if(k==='offOthers')S.imp.offOthers=el.checked;else if(k==='dateDefault')S.imp.dateDefault=el.value}});
function downloadBlob(name,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function genPlan(){
  const trips=autoPlan();S.day.plan={at:new Date().toISOString(),trips};S.view='board';saveDay();render();
  const iss=validate(trips,L());toast(iss.some(i=>i.lv==='bad')?'作成しました。赤い項目を確認してください':'送迎表を作成しました');
}
boot();
