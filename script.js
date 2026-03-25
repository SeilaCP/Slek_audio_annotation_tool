// ═══ STATE ═══
let AC=null, buf=null, src=null, gn=null;
let playing=false, t0=0, off=0, dur=0;
let looping=false, pass=1, playId=0;
let tiers=[{name:'speech',type:'interval',ivs:[]}];
let selTier=0, selIdx=-1;
let vStart=0, vEnd=10;
let fname='', freg={}, fkey='';
let drag=null;

// ═══ FILE I/O ═══
document.getElementById('wav-in').addEventListener('change',e=>{Array.from(e.target.files).forEach(loadWav);e.target.value='';});
document.getElementById('tg-in').addEventListener('change',e=>{if(e.target.files[0])loadTG(e.target.files[0]);e.target.value='';});
document.getElementById('json-in').addEventListener('change',e=>{if(e.target.files[0])loadJSONFile(e.target.files[0]);e.target.value='';});

const dz=document.getElementById('dropzone');
dz.addEventListener('click',()=>document.getElementById('wav-in').click());
dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('over')});
dz.addEventListener('dragleave',()=>dz.classList.remove('over'));
dz.addEventListener('drop',e=>{
  e.preventDefault();dz.classList.remove('over');
  Array.from(e.dataTransfer.files).forEach(f=>{
    if(/\.(wav|mp3|ogg|flac)$/i.test(f.name)) loadWav(f);
    else if(/\.(textgrid|txt)$/i.test(f.name)) loadTG(f);
  });
});

function loadWav(file){
  const k=file.name;
  if(!freg[k]) freg[k]={name:file.name,tiers:[{name:'speech',type:'interval',ivs:[]}],duration:0};
  const r=new FileReader();
  r.onload=ev=>{
    if(!AC) AC=new(window.AudioContext||window.webkitAudioContext)();
    AC.decodeAudioData(ev.target.result,b=>{
      freg[k].buf=b; freg[k].duration=b.duration;
      updateFL();
      if(!buf) activateFile(k);
      toast('Loaded: '+file.name);
    },()=>toast('Cannot decode: '+file.name));
  };
  r.readAsArrayBuffer(file);
}

function loadTG(file){
  const r=new FileReader();
  r.onload=ev=>{
    const parsed=parseTG(ev.target.result);
    if(!parsed){toast('Cannot parse TextGrid');return;}
    const base=file.name.replace(/\.[^.]+$/,'');
    let k=fkey;
    for(const kk of Object.keys(freg)){if(kk.replace(/\.[^.]+$/,'')=== base){k=kk;break;}}
    if(!freg[k]) freg[k]={name:base+'.wav',tiers:parsed,duration:0};
    else freg[k].tiers=parsed;
    if(k===fkey){tiers=cpTiers(parsed);drawAll();renderAll();}
    updateFL();
    const total=parsed.reduce((s,t)=>s+t.ivs.length,0);
    toast('TextGrid: '+parsed.length+' tier(s), '+total+' intervals');
  };
  r.readAsText(file);
}

function loadJSONFile(file){
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const d=JSON.parse(ev.target.result);
      const anns=d.annotations||d;
      if(!tiers[0]) tiers=[{name:'speech',type:'interval',ivs:[]}];
      if(Array.isArray(d.tiers)){
        tiers=d.tiers.map(t=>({name:t.name,type:'interval',ivs:(t.intervals||[]).map(i=>({start:pts(i.time),end:pts(i.time_end||i.time),speaker:i.speaker||'',text:i.text||''}))}));
      } else {
        tiers[0].ivs=anns.map(a=>({start:pts(a.time),end:pts(a.time_end||a.time),speaker:a.speaker||'',text:a.text||''})).sort((a,b)=>a.start-b.start);
      }
      syncReg(); drawAll(); renderAll();
      toast('Imported JSON');
    }catch(e){toast('Invalid JSON');}
  };
  r.readAsText(file);
}

function activateFile(k){
  if(fkey) freg[fkey].tiers=cpTiers(tiers);
  fkey=k;
  const e=freg[k];
  buf=e.buf; dur=e.duration||0;
  tiers=e.tiers?cpTiers(e.tiers):[{name:'speech',type:'interval',ivs:[]}];
  selIdx=-1; selTier=0;
  fname=e.name.replace(/\.[^.]+$/,'');
  document.getElementById('tbfile').textContent=e.name;
  off=0; if(playing) pause();
  vStart=0; vEnd=Math.min(10,dur||10);
  drawAll(); renderAll(); updateFL(); updateStats();
}

function updateFL(){
  const list=document.getElementById('flist');
  list.innerHTML='';
  document.getElementById('s-files').textContent=Object.keys(freg).length;
  Object.entries(freg).forEach(([k,e])=>{
    const total=e.tiers?e.tiers.reduce((s,t)=>s+t.ivs.length,0):0;
    const filled=e.tiers?e.tiers.reduce((s,t)=>s+t.ivs.filter(i=>i.text).length,0):0;
    const cls=total===0?'':(filled===total?'done':'partial');
    const d=document.createElement('div');
    d.className='fitem'+(k===fkey?' on':'');
    d.innerHTML=`<span class="fdot ${cls}"></span><span class="fname" title="${e.name}">${e.name}</span><span class="fcnt">${total}</span>`;
    d.addEventListener('click',()=>activateFile(k));
    list.appendChild(d);
  });
}

function updateStats(){
  const t=Object.values(freg).reduce((s,e)=>s+(e.tiers?e.tiers.reduce((ss,tt)=>ss+tt.ivs.length,0):0),0);
  const d=Object.values(freg).reduce((s,e)=>s+(e.duration||0),0);
  document.getElementById('s-segs').textContent=t;
  document.getElementById('s-dur').textContent=d>0?fmtS(d):'—';
}

function cpTiers(t){return JSON.parse(JSON.stringify(t));}
function syncReg(){if(fkey)freg[fkey].tiers=cpTiers(tiers);}

// ═══ TEXTGRID PARSER ═══
function parseTG(src){
  try{
    const out=[];
    const parts=src.split(/item\s*\[(\d+)\]/g);
    for(let i=1;i<parts.length;i+=2){
      const blk=parts[i+1]||'';
      const nm=(blk.match(/name\s*=\s*"([^"]*)"/))||['','tier'];
      const cl=(blk.match(/class\s*=\s*"([^"]*)"/))||['','IntervalTier'];
      if(!cl) continue;
      const ivs=[];
      const ivParts=blk.split(/intervals\s*\[(\d+)\]/g);
      for(let j=1;j<ivParts.length;j+=2){
        const iv=ivParts[j+1]||'';
        const xm=iv.match(/xmin\s*=\s*([\d.eE+\-]+)/);
        const xM=iv.match(/xmax\s*=\s*([\d.eE+\-]+)/);
        const tx=iv.match(/text\s*=\s*"((?:[^"]|"")*)"/);
        if(xm&&xM) ivs.push({start:parseFloat(xm[1]),end:parseFloat(xM[1]),speaker:'',text:(tx?tx[1]:'').replace(/""/g,'"').trim()});
      }
      out.push({name:nm[1],type:'interval',ivs});
    }
    return out.length?out:null;
  }catch(e){return null;}
}

// ═══ DRAWING ═══
function drawAll(){
  resizeCvs();
  drawOv(); drawDt();
  drawRuler(document.getElementById('ov-ruler'),0,dur||10);
  drawRuler(document.getElementById('dt-ruler'),vStart,vEnd);
  drawTiers();
  updVP(); updPH();
}

function resizeCvs(){
  ['ov-canvas','dt-canvas','ov-ruler','dt-ruler'].forEach(id=>{
    const c=document.getElementById(id);
    const pw=c.parentElement.clientWidth, ph=c.parentElement.clientHeight;
    if(c.width!==pw||c.height!==ph){c.width=pw;c.height=ph;}
  });
}

function drawWave(cvs,s0sec,s1sec,col1,col2){
  const ctx=cvs.getContext('2d');
  const W=cvs.width,H=cvs.height;
  ctx.clearRect(0,0,W,H);
  if(!buf) return;
  const data=buf.getChannelData(0);
  const sr=buf.sampleRate;
  const sa=Math.floor(s0sec*sr), sb=Math.floor(s1sec*sr);
  const total=sb-sa; if(total<=0) return;
  const mid=H/2;
  const step=Math.max(1,Math.floor(total/W));
  for(let i=0;i<W;i++){
    const from=sa+Math.floor(i/W*total);
    const to=Math.min(sb,from+step);
    let mx=0,rms=0,cnt=0;
    for(let j=from;j<to;j++){const v=data[j]||0;if(Math.abs(v)>mx)mx=Math.abs(v);rms+=v*v;cnt++;}
    rms=cnt?Math.sqrt(rms/cnt):0;
    ctx.fillStyle=col2; ctx.fillRect(i,mid-mx*mid*.98,1,mx*mid*1.96);
    ctx.fillStyle=col1; ctx.fillRect(i,mid-rms*mid*2.4,1,rms*mid*4.8);
  }
  ctx.strokeStyle='rgba(255,255,255,0.04)';
  ctx.beginPath();ctx.moveTo(0,mid);ctx.lineTo(W,mid);ctx.stroke();
}

function drawOv(){
  const cvs=document.getElementById('ov-canvas');
  drawWave(cvs,0,dur||10,'rgba(91,155,213,.55)','rgba(91,155,213,.14)');
  const ctx=cvs.getContext('2d');
  const W=cvs.width, H=cvs.height, D=dur||10;
  tiers.forEach(tier=>{
    tier.ivs.forEach(iv=>{
      if(!iv.text) return;
      ctx.fillStyle='rgba(91,155,213,.1)';
      ctx.fillRect(iv.start/D*W,0,(iv.end-iv.start)/D*W,H);
    });
  });
}

function drawDt(){
  drawWave(document.getElementById('dt-canvas'),vStart,vEnd,'rgba(74,222,128,.65)','rgba(74,222,128,.13)');
}

function drawRuler(cvs,s,e){
  const ctx=cvs.getContext('2d');
  const W=cvs.width, H=cvs.height;
  ctx.clearRect(0,0,W,H);
  ctx.fillStyle='rgba(255,255,255,.03)'; ctx.fillRect(0,0,W,H);
  const span=e-s; if(span<=0) return;
  const targets=[.001,.002,.005,.01,.025,.05,.1,.25,.5,1,2,5,10,30,60,120,300,600];
  const ppx=W/span;
  const tick=targets.find(t=>t*ppx>=48)||600;
  let t=Math.ceil(s/tick)*tick;
  ctx.font='9px '+getComputedStyle(document.body).fontFamily;
  ctx.textBaseline='middle';
  while(t<=e){
    const x=(t-s)/span*W;
    ctx.fillStyle='rgba(255,255,255,.12)'; ctx.fillRect(x,H-5,1,5);
    ctx.fillStyle='rgba(139,145,158,.8)'; ctx.fillText(tickFmt(t),x+2,H/2-1);
    t=+(t+tick).toFixed(6);
  }
}

function tickFmt(s){return s<60?s.toFixed(s<1?.3:s<10?2:1)+'s':Math.floor(s/60)+':'+(s%60).toFixed(0).padStart(2,'0');}

function drawTiers(){
  const inner=document.getElementById('tiers-inner');
  const frag=document.createDocumentFragment();
  const vspan=vEnd-vStart;
  const palBg=['rgba(91,155,213,.16)','rgba(74,222,128,.13)','rgba(245,158,11,.13)','rgba(248,113,113,.13)','rgba(167,139,250,.13)'];
  const palBd=['#5b9bd5','#4ade80','#f59e0b','#f87171','#a78bfa'];

  tiers.forEach((tier,ti)=>{
    const lane=document.createElement('div');
    lane.className='tier-lane';

    const lbl=document.createElement('div');
    lbl.className='tier-lbl';
    lbl.textContent=tier.name;
    lane.appendChild(lbl);

    const body=document.createElement('div');
    body.className='tier-body';
    body.dataset.tier=ti;

    const cursor=document.createElement('div'); cursor.className='tcursor'; cursor.id='tc'+ti; body.appendChild(cursor);
    const prev=document.createElement('div'); prev.className='drag-prev'; prev.id='dp'+ti; body.appendChild(prev);

    tier.ivs.forEach((iv,ii)=>{
      if(iv.end<=vStart||iv.start>=vEnd) return;
      const x1=Math.max(0,(iv.start-vStart)/vspan*100);
      const x2=Math.min(100,(iv.end-vStart)/vspan*100);
      const blk=document.createElement('div');
      blk.className='iblock'+(ti===selTier&&ii===selIdx?' sel':'');
      blk.style.cssText=`left:${x1}%;width:${x2-x1}%;background:${palBg[ti%5]};border-color:${palBd[ti%5]}`;
      const lbl2=document.createElement('span');
      lbl2.className='iblbl'; lbl2.style.color=palBd[ti%5];
      lbl2.textContent=(iv.speaker?iv.speaker+': ':'')+iv.text;
      blk.appendChild(lbl2);
      blk.addEventListener('click',ev=>{
        ev.stopPropagation();
        selTier=ti; selIdx=ii;
        seekTo(iv.start);
        drawTiers(); renderTranscript(); renderInlineTrans(); focusSel();
      });
      body.appendChild(blk);
    });

    body.addEventListener('mousedown',ev=>{
      if(ev.target.classList.contains('iblock')) return;
      if(pass<2) return;
      const rect=body.getBoundingClientRect();
      const sec=vStart+(ev.clientX-rect.left)/rect.width*vspan;
      drag={ti,startSec:sec,body,prev};
      prev.style.cssText=`display:block;left:${(sec-vStart)/vspan*100}%;width:0`;
    });

    lane.appendChild(body);
    frag.appendChild(lane);
  });

  inner.textContent='';
  inner.appendChild(frag);

  updTierCursors(playing?AC.currentTime-t0:off);
}

window.addEventListener('mousemove',ev=>{
  if(!drag) return;
  const rect=drag.body.getBoundingClientRect();
  const px=Math.max(0,Math.min(1,(ev.clientX-rect.left)/rect.width));
  const sec=vStart+px*(vEnd-vStart);
  const s=Math.min(drag.startSec,sec), e2=Math.max(drag.startSec,sec);
  const vspan=vEnd-vStart;
  drag.prev.style.left=((s-vStart)/vspan*100)+'%';
  drag.prev.style.width=((e2-s)/vspan*100)+'%';
});

window.addEventListener('mouseup',ev=>{
  if(!drag) return;
  const rect=drag.body.getBoundingClientRect();
  const px=Math.max(0,Math.min(1,(ev.clientX-rect.left)/rect.width));
  const sec=vStart+px*(vEnd-vStart);
  const s=+Math.min(drag.startSec,sec).toFixed(4);
  const e2=+Math.max(drag.startSec,sec).toFixed(4);
  drag.prev.style.display='none';
  const ti=drag.ti; drag=null;
  if(e2-s<0.03) return;
  const ivArr=tiers[ti].ivs;
  let spk=ivArr.length>0?(ivArr[ivArr.length-1].speaker||'Speaker 1'):'Speaker 1';
  ivArr.push({start:s,end:e2,speaker:spk,text:''});
  ivArr.sort((a,b)=>a.start-b.start);
  selTier=ti; selIdx=ivArr.findIndex(a=>a.start===s&&a.end===e2);
  syncReg(); drawAll(); renderAll();
  if(pass>=3) setTimeout(()=>focusSel(),60);
  else renderInlineTrans();
});

// click overview to seek + re-center
document.getElementById('ov-wrap').addEventListener('click',ev=>{
  if(!buf) return;
  const rect=ev.currentTarget.getBoundingClientRect();
  const t=(ev.clientX-rect.left)/rect.width*(dur||10);
  centerView(t); seekTo(t);
});

// click detail to seek
document.getElementById('dt-wrap').addEventListener('click',ev=>{
  if(!buf) return;
  const rect=ev.currentTarget.getBoundingClientRect();
  seekTo(vStart+(ev.clientX-rect.left)/rect.width*(vEnd-vStart));
});

// drag vp-rect to scroll
let vpDrag=null;
document.getElementById('vp-rect').addEventListener('mousedown',ev=>{
  ev.stopPropagation();
  vpDrag={x:ev.clientX,vs:vStart,ve:vEnd};
});
window.addEventListener('mousemove',ev=>{
  if(!vpDrag) return;
  const ovw=document.getElementById('ov-wrap').clientWidth;
  const dt=(ev.clientX-vpDrag.x)/ovw*(dur||10);
  const span=vpDrag.ve-vpDrag.vs;
  let ns=Math.max(0,vpDrag.vs+dt);
  let ne=ns+span;
  if(ne>dur){ne=dur;ns=Math.max(0,ne-span);}
  vStart=ns; vEnd=ne;
  drawAll();
});
window.addEventListener('mouseup',()=>{vpDrag=null;});

// ═══ VIEWPORT ═══
function zoomIn(){
  const mid=(vStart+vEnd)/2, span=(vEnd-vStart)/2;
  const ns=Math.max(0,mid-span/2), ne=Math.min(dur,mid+span/2);
  if(ne-ns<0.2) return;
  vStart=ns; vEnd=ne; drawAll(); updZL();
}
function zoomOut(){
  const mid=(vStart+vEnd)/2, span=(vEnd-vStart)*2;
  vStart=Math.max(0,mid-span/2); vEnd=Math.min(dur,mid+span/2);
  if(vEnd-vStart<span){if(vStart===0) vEnd=Math.min(dur,span); else vStart=Math.max(0,vEnd-span);}
  drawAll(); updZL();
}
function zoomFit(){vStart=0;vEnd=dur||10;drawAll();updZL();}
function updZL(){const r=(dur||10)/(vEnd-vStart);document.getElementById('zval').textContent=r.toFixed(1)+'×';}
function centerView(t){
  const span=vEnd-vStart;
  vStart=Math.max(0,t-span/2); vEnd=vStart+span;
  if(vEnd>dur){vEnd=dur;vStart=Math.max(0,dur-span);}
  drawAll();
}
function scrollView(d){
  const span=vEnd-vStart;
  vStart=Math.max(0,vStart+d); vEnd=vStart+span;
  if(vEnd>dur){vEnd=dur;vStart=Math.max(0,dur-span);}
  drawAll();
}

function updVP(){
  const d=dur||10,ow=document.getElementById('ov-wrap').clientWidth;
  const r=document.getElementById('vp-rect');
  r.style.left=(vStart/d*100)+'%'; r.style.width=((vEnd-vStart)/d*100)+'%';
}

function updPH(){
  const cur=playing?Math.min(AC.currentTime-t0,dur):off;
  const d=dur||10;
  document.getElementById('curtime').textContent=fmtFull(cur);
  document.getElementById('ph-ov').style.left=(cur/d*100)+'%';
  const inView=cur>=vStart&&cur<=vEnd;
  const ph=document.getElementById('ph-dt');
  ph.style.display=inView?'block':'none';
  if(inView) ph.style.left=((cur-vStart)/(vEnd-vStart)*100)+'%';
  updTierCursors(cur);
}

function updTierCursors(cur){
  const inView=cur>=vStart&&cur<=vEnd;
  const pct=inView?((cur-vStart)/(vEnd-vStart)*100):null;
  tiers.forEach((_,ti)=>{
    const el=document.getElementById('tc'+ti);
    if(!el) return;
    if(pct!==null){el.style.display='block';el.style.left=pct+'%';}
    else el.style.display='none';
  });
}

// ═══ PLAYBACK ═══
function togglePlay(){if(!buf){toast('Load a .wav file first');return;} playing?pause():play();}
function play(){
  if(!AC) return;
  if(AC.state==='suspended') AC.resume();
  src=AC.createBufferSource(); src.buffer=buf;
  src.playbackRate.value=parseFloat(document.getElementById('spd').value);
  gn=AC.createGain(); gn.gain.value=parseFloat(document.getElementById('vol').value);
  src.connect(gn).connect(AC.destination);
  const loopS=looping&&selIdx>=0?tiers[selTier]?.ivs[selIdx]?.start:null;
  const o=Math.max(0,Math.min(off,dur-0.001));
  src.start(0,o); t0=AC.currentTime-o; playing=true;
  const pb=document.getElementById('play-btn');
  pb.textContent='⏸ Pause'; pb.classList.add('playing');
  const thisId=++playId;
  src.onended=()=>{
    if(thisId!==playId||!playing) return;
    if(looping&&loopS!=null){off=loopS;play();}
    else{playing=false;off=0;pb.textContent='▶ Play';pb.classList.remove('playing');}
  };
  requestAnimationFrame(tick);
}
function pause(){
  if(src){try{src.onended=null;src.stop();}catch(e){} src=null;}
  off=Math.min(AC?AC.currentTime-t0:off,dur);
  playing=false;
  const pb=document.getElementById('play-btn');
  pb.textContent='▶ Play'; pb.classList.remove('playing');
}
function tick(){
  if(!playing) return;
  const cur=Math.min(AC.currentTime-t0,dur);
  updPH();
  if(cur>vEnd-0.05||cur<vStart){
    const span=vEnd-vStart;
    vStart=Math.max(0,cur-span*0.05); vEnd=vStart+span;
    if(vEnd>dur){vEnd=dur;vStart=Math.max(0,dur-span);}
    drawOv(); drawDt();
    drawRuler(document.getElementById('dt-ruler'),vStart,vEnd);
    drawTiers(); updVP();
  }
  requestAnimationFrame(tick);
}
function seekTo(t){const was=playing;if(was)pause();off=Math.max(0,Math.min(t,dur));updPH();if(was)play();}
function skip(s){seekTo((playing?AC.currentTime-t0:off)+s);}
function setSpeed(v){document.getElementById('spd-v').textContent=parseFloat(v).toFixed(2)+'×';if(src)src.playbackRate.value=v;}
function setVol(v){document.getElementById('vol-v').textContent=Math.round(v*100)+'%';if(gn)gn.gain.value=v;}
function toggleLoop(){
  looping=!looping;
  const b=document.getElementById('loopbtn');
  b.style.color=looping?'var(--accent)':'';
  b.style.borderColor=looping?'var(--accent)':'';
}

// ═══ RENDER TRANSCRIPT ═══
function renderAll(){drawTiers();renderTranscript();renderInlineTrans();updTGPre();updateStats();}

function renderTranscript(){
  const tier=tiers[selTier];
  const ivs=tier?.ivs||[];
  const info=document.getElementById('seginfo');
  if(selIdx>=0&&ivs[selIdx]){
    const iv=ivs[selIdx];
    info.innerHTML=`<span style="color:var(--accent)">${fmtFull(iv.start)} → ${fmtFull(iv.end)}</span> &nbsp; <span style="color:var(--text2)">${(iv.end-iv.start).toFixed(3)}s &nbsp; #${selIdx+1}/${ivs.length}</span>`;
  } else {
    info.textContent=(tier?tier.name+': ':'')+ivs.length+' segments. Drag waveform or tier to create.';
  }
  const list=document.getElementById('tlist');
  if(ivs.length===0){list.innerHTML='<div class="empty-t">No segments yet.<br>Drag the waveform or tier lane<br>to create an interval.</div>';return;}
  list.innerHTML='';
  ivs.forEach((iv,ii)=>{
    const row=document.createElement('div');
    row.className='trow'+(ii===selIdx?' sel':'');
    const head=document.createElement('div'); head.className='trow-head';
    const ts=document.createElement('span'); ts.className='ttime';
    ts.textContent=fmtFull(iv.start)+'–'+fmtFull(iv.end);
    const spk=document.createElement('input'); spk.className='tspk';
    spk.value=iv.speaker||''; spk.placeholder='Speaker';
    spk.addEventListener('input',()=>{iv.speaker=spk.value;drawTiers();renderInlineTrans();syncReg();});
    spk.addEventListener('focus',()=>{selIdx=ii;drawTiers();renderTranscript();renderInlineTrans();});
    const del=document.createElement('button'); del.className='tdel'; del.textContent='✕';
    del.addEventListener('click',ev=>{
      ev.stopPropagation(); ivs.splice(ii,1);
      if(selIdx>=ivs.length) selIdx=ivs.length-1;
      syncReg(); drawAll(); renderAll();
    });
    head.appendChild(ts); head.appendChild(spk); head.appendChild(del);
    const txt=document.createElement('textarea'); txt.className='ttxt';
    txt.value=iv.text||''; txt.placeholder='Transcription… (?) [noise] [laughter]'; txt.rows=2;
    txt.addEventListener('input',()=>{
      iv.text=txt.value; txt.style.height='auto'; txt.style.height=txt.scrollHeight+'px';
      drawTiers(); updTGPre(); renderInlineTrans(); syncReg();
    });
    txt.addEventListener('focus',()=>{selIdx=ii;drawTiers();renderTranscript();renderInlineTrans();});
    row.appendChild(head); row.appendChild(txt);
    row.addEventListener('click',()=>{selIdx=ii;seekTo(iv.start);centerView((iv.start+iv.end)/2);drawAll();renderTranscript();renderInlineTrans();});
    list.appendChild(row);
  });
  setTimeout(()=>{
    const rows=list.querySelectorAll('.trow'),row=rows[selIdx];
    if(row){
      const c=document.getElementById('tscroll'),cR=c.getBoundingClientRect(),rR=row.getBoundingClientRect();
      if(rR.top<cR.top) c.scrollTop-=cR.top-rR.top;
      else if(rR.bottom>cR.bottom) c.scrollTop+=rR.bottom-cR.bottom;
    }
  },30);
}

function focusSel(){const t=document.getElementById('inline-trans').querySelectorAll('.it-txt');if(t[selIdx])t[selIdx].focus();}

function renderInlineTrans(){
  const wrap=document.getElementById('inline-trans');
  const tier=tiers[selTier];
  const ivs=tier?.ivs||[];
  if(ivs.length===0){wrap.innerHTML='';return;}
  const ae=document.activeElement;
  const hadFocus=wrap.contains(ae);
  let focusIdx=-1,focusCls='',cursorPos=-1;
  if(hadFocus){
    focusIdx=+ae.dataset.idx; focusCls=ae.className;
    if(typeof ae.selectionStart==='number') cursorPos=ae.selectionStart;
  }
  wrap.innerHTML='';
  ivs.forEach((iv,ii)=>{
    const row=document.createElement('div');
    row.className='it-row'+(ii===selIdx?' sel':'');
    row.addEventListener('click',()=>{
      selIdx=ii; seekTo(iv.start); centerView((iv.start+iv.end)/2);
      drawAll(); renderTranscript(); renderInlineTrans();
    });

    const meta=document.createElement('div'); meta.className='it-meta';
    const time=document.createElement('span'); time.className='it-time';
    time.textContent=fmtFull(iv.start)+' – '+fmtFull(iv.end);
    const spk=document.createElement('input'); spk.className='it-spk'; spk.dataset.idx=ii;
    spk.value=iv.speaker||''; spk.placeholder='Speaker';
    spk.addEventListener('input',()=>{iv.speaker=spk.value;drawTiers();renderTranscript();syncReg();});
    spk.addEventListener('focus',()=>{selIdx=ii;drawTiers();renderTranscript();highlightInlineRow(ii);});
    spk.addEventListener('click',e=>e.stopPropagation());
    meta.appendChild(time); meta.appendChild(spk);

    const txt=document.createElement('textarea'); txt.className='it-txt'; txt.dataset.idx=ii;
    txt.value=iv.text||''; txt.placeholder='Transcription…'; txt.rows=1;
    txt.addEventListener('input',()=>{
      iv.text=txt.value; txt.style.height='auto'; txt.style.height=txt.scrollHeight+'px';
      drawTiers(); updTGPre(); renderTranscript(); syncReg();
    });
    txt.addEventListener('focus',()=>{selIdx=ii;drawTiers();renderTranscript();highlightInlineRow(ii);});
    txt.addEventListener('click',e=>e.stopPropagation());

    const del=document.createElement('button'); del.className='it-del'; del.textContent='✕';
    del.addEventListener('click',ev=>{
      ev.stopPropagation(); ivs.splice(ii,1);
      if(selIdx>=ivs.length) selIdx=ivs.length-1;
      syncReg(); drawAll(); renderAll();
    });

    row.appendChild(meta); row.appendChild(txt); row.appendChild(del);
    wrap.appendChild(row);

    txt.style.height='auto'; txt.style.height=txt.scrollHeight+'px';
  });
  if(hadFocus&&focusIdx>=0){
    const sel=wrap.querySelector((focusCls.includes('it-txt')?'.it-txt':'.it-spk')+'[data-idx="'+focusIdx+'"]');
    if(sel){sel.focus();if(cursorPos>=0&&typeof sel.setSelectionRange==='function')sel.setSelectionRange(cursorPos,cursorPos);}
  }
}

function highlightInlineRow(idx){
  document.querySelectorAll('#inline-trans .it-row').forEach((r,i)=>r.classList.toggle('sel',i===idx));
}

// ═══ EXPORT ═══
function buildTG(){
  const d=dur||0;
  let tg='File type = "ooTextFile"\nObject class = "TextGrid"\n\nxmin = 0\nxmax = '+d.toFixed(6)+'\ntiers? <exists>\nsize = '+tiers.length+'\nitem []:\n';
  tiers.forEach((tier,ti)=>{
    tg+='    item ['+(ti+1)+']:\n        class = "IntervalTier"\n        name = "'+tier.name+'"\n        xmin = 0\n        xmax = '+d.toFixed(6)+'\n';
    const filled=fillGaps(tier.ivs,0,d);
    tg+='        intervals: size = '+filled.length+'\n';
    filled.forEach((iv,ii)=>{
      tg+='        intervals ['+(ii+1)+']:\n            xmin = '+iv.start.toFixed(6)+'\n            xmax = '+iv.end.toFixed(6)+'\n            text = "'+iv.text.replace(/"/g,'""')+'"\n';
    });
  });
  return tg;
}
function fillGaps(ivs,xmin,xmax){
  const sorted=[...ivs].sort((a,b)=>a.start-b.start);
  const out=[]; let cur=xmin;
  sorted.forEach(iv=>{if(iv.start-cur>1e-4)out.push({start:cur,end:iv.start,text:''});out.push(iv);cur=iv.end;});
  if(xmax-cur>1e-4) out.push({start:cur,end:xmax,text:''});
  return out;
}
function updTGPre(){if(document.getElementById('rt-tg').classList.contains('on'))document.getElementById('tgpre').textContent=buildTG();}
function exportTG(){
  if(!buf){toast('Load a .wav first');return;}
  dl(fname+'.TextGrid',buildTG(),'text/plain');
  toast('Saved: '+fname+'.TextGrid');
}
function copyTG(){navigator.clipboard.writeText(buildTG()).then(()=>toast('Copied TextGrid'));}
function exportJSON(){
  const data={file:fname,tiers:tiers.map(t=>({name:t.name,intervals:t.ivs.map(iv=>({time:hhmmss(iv.start),time_end:hhmmss(iv.end),duration_s:+(iv.end-iv.start).toFixed(3),speaker:iv.speaker,text:iv.text}))}))};
  dl(fname+'.json',JSON.stringify(data,null,2),'application/json');
  toast('Saved: '+fname+'.json');
}
function dl(name,content,mime){const b=new Blob([content],{type:mime}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=name;a.click();URL.revokeObjectURL(u);}

// ═══ PASS ═══
const hints={1:'Pass 1 — Listen at 1.25×+ speed. No annotating yet. Count speakers, identify difficult sections.',2:'Pass 2 — Drag waveform or tier to mark segments (2–5s). Click regions to seek.',3:'Pass 3 — Click each segment and type the transcription. Tab to move between segments.',4:'Pass 4 — Mark uncertain: (?) unknown, (word?) guess, [noise] [laughter] [silence 2s].',5:'Pass 5 — Review all. Re-listen at 1×. Fix timestamps, speakers, typos. Export when done.'};
function setPass(n){
  pass=n;
  document.querySelectorAll('.ptab').forEach(t=>{const p=+t.dataset.p;t.classList.toggle('on',p===n);t.classList.toggle('done',p<n);});
  document.getElementById('hintbox').textContent=hints[n];
}

// ═══ RIGHT TABS ═══
function showRT(id){
  const ids=['trans','tg','keys'];
  document.querySelectorAll('.rtab').forEach((t,i)=>t.classList.toggle('on',ids[i]===id));
  document.querySelectorAll('.rcontent').forEach(el=>el.classList.remove('on'));
  document.getElementById('rt-'+id).classList.add('on');
  if(id==='tg') updTGPre();
}

// ═══ KEYBOARD ═══
document.addEventListener('keydown',ev=>{
  const tag=document.activeElement.tagName.toLowerCase();
  const inp=tag==='input'||tag==='textarea';
  if(ev.code==='Space'&&!inp){ev.preventDefault();togglePlay();}
  if(ev.code==='Home'){ev.preventDefault();seekTo(0);}
  if(ev.code==='ArrowLeft'&&!inp){ev.preventDefault();skip(ev.shiftKey?-5:-1);}
  if(ev.code==='ArrowRight'&&!inp){ev.preventDefault();skip(ev.shiftKey?5:1);}
  if(ev.key==='['&&!inp){const s=document.getElementById('spd');s.value=Math.max(.5,+s.value-.25);setSpeed(s.value);}
  if(ev.key===']'&&!inp){const s=document.getElementById('spd');s.value=Math.min(2,+s.value+.25);setSpeed(s.value);}
  if((ev.key==='l'||ev.key==='L')&&!inp){ev.preventDefault();toggleLoop();}
  if((ev.key==='+'||ev.key==='=')&&!inp){ev.preventDefault();zoomIn();}
  if(ev.key==='-'&&!inp){ev.preventDefault();zoomOut();}
  if((ev.key==='f'||ev.key==='F')&&!inp){ev.preventDefault();zoomFit();}
  if((ev.key==='a'||ev.key==='A')&&!inp){ev.preventDefault();scrollView(-(vEnd-vStart)*.3);}
  if((ev.key==='d'||ev.key==='D')&&!inp){ev.preventDefault();scrollView((vEnd-vStart)*.3);}
  if((ev.key==='g'||ev.key==='G')&&!inp){ev.preventDefault();centerView(playing?AC.currentTime-t0:off);}
  const tier=tiers[selTier];
  if(ev.code==='Delete'&&!inp&&selIdx>=0&&tier){
    tier.ivs.splice(selIdx,1);
    if(selIdx>=tier.ivs.length) selIdx=tier.ivs.length-1;
    syncReg(); drawAll(); renderAll();
  }
  if(ev.code==='Enter'&&!inp&&selIdx>=0&&tier?.ivs[selIdx]) seekTo(tier.ivs[selIdx].start);
  if(ev.code==='Tab'&&tier?.ivs.length){
    ev.preventDefault();
    selIdx=ev.shiftKey?(selIdx-1+tier.ivs.length)%tier.ivs.length:(selIdx+1)%tier.ivs.length;
    const iv=tier.ivs[selIdx]; seekTo(iv.start); centerView((iv.start+iv.end)/2);
    drawAll(); renderAll(); setTimeout(()=>focusSel(),50);
  }
});

// mouse wheel zoom/scroll
document.getElementById('viewer').addEventListener('wheel',ev=>{
  ev.preventDefault();
  if(ev.ctrlKey||ev.metaKey){ev.deltaY<0?zoomIn():zoomOut();}
  else scrollView(ev.deltaY*.008*(vEnd-vStart));
},{passive:false});

// ═══ UTILS ═══
function fmtFull(s){if(!isFinite(s))return '?';const m=Math.floor(s/60);return m+':'+(s%60).toFixed(3).padStart(6,'0');}
function fmtS(s){return Math.floor(s/60)+'m'+(s%60).toFixed(0)+'s';}
function hhmmss(s){const h=Math.floor(s/3600),m=Math.floor((s%3600)/60);return h.toString().padStart(2,'0')+':'+m.toString().padStart(2,'0')+':'+(s%60).toFixed(3).padStart(6,'0');}
function pts(t){if(!t)return 0;const p=t.split(':');if(p.length===3)return +p[0]*3600+(+p[1])*60+parseFloat(p[2]);if(p.length===2)return +p[0]*60+parseFloat(p[1]);return parseFloat(t)||0;}
function clearAll(){if(!confirm('Delete all annotations for this file?'))return;tiers=[{name:'speech',type:'interval',ivs:[]}];selIdx=-1;syncReg();drawAll();renderAll();toast('Cleared');}
function toast(msg){const el=document.getElementById('toast');el.textContent=msg;el.classList.add('show');clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),2400);}

// ═══ INIT ═══
window.addEventListener('resize',()=>{if(buf)drawAll();else resizeCvs();});
resizeCvs(); drawAll();
