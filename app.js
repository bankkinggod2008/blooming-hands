/* Blooming Hands V2 — hand-tracked music player.
   Built-in audio was composed/generated specifically for this project.
   Camera video and uploaded audio never leave this browser. */
const $ = (id) => document.getElementById(id);
const ui = Object.fromEntries([
  'video','handCanvas','cameraStage','startCamera','stopCamera','flipCamera','cameraEmpty',
  'cameraBadge','cameraBadgeText','cameraRing','trackingLabel','fpsLabel','trackingPill',
  'statusText','visualizer','audioState','intensityNumber','intensityFill','activityValue',
  'previewAudio','playIcon','previousTrack','nextTrack','muteAudio','sourceLabel','genreText',
  'songTitle','songSubtitle','albumArt','albumSymbol','currentTime','durationTime','seekBar',
  'masterVolume','volumeValue','gestureMode','continuousMode','modeHelp',
  'playlist','trackCount','originalTab','myMusicTab','featuredTab','featureUpload','featuredInstructions','uploadCount','audioUpload','trimControls',
  'startSecond','endSecond','resetTrim','musicAudio'
].map(id => [id, $(id)]));
const clamp = (v,min,max) => Math.min(max,Math.max(min,v));
const SONGS = [
  {id:'garden',type:'original',name:'Blooming Garden',subtitle:'สวนดอกไม้ · ฟังสบายอบอุ่น',genre:'DREAM POP',bpm:98,icon:'✿',cover:'cover-bloom',src:'assets/tracks/01-blooming-garden.mp3'},
  {id:'neon',type:'original',name:'Neon Sunset',subtitle:'แสงเย็น · อินดี้ป๊อปสดใส',genre:'INDIE POP',bpm:116,icon:'☼',cover:'cover-neon',src:'assets/tracks/02-neon-sunset.mp3'},
  {id:'coffee',type:'original',name:'Moonlit Coffee',subtitle:'คาเฟ่กลางคืน · โลไฟละมุน',genre:'LO-FI',bpm:84,icon:'☾',cover:'cover-coffee',src:'assets/tracks/03-moonlit-coffee.mp3'},
  {id:'peach',type:'original',name:'Peach Disco',subtitle:'พีชดิสโก้ · จังหวะสนุก',genre:'NU DISCO',bpm:122,icon:'✴',cover:'cover-peach',src:'assets/tracks/04-peach-disco.mp3'},
  {id:'cloud',type:'original',name:'Cloud Nine',subtitle:'ลอยไปกับเมฆ · นุ่มนวลผ่อนคลาย',genre:'AMBIENT',bpm:76,icon:'☁',cover:'cover-cloud',src:'assets/tracks/05-cloud-nine.mp3'},
  {id:'pixels',type:'original',name:'Morning Pixels',subtitle:'เช้าสดใส · ซินธ์ป๊อป',genre:'SYNTH POP',bpm:128,icon:'✧',cover:'cover-pixels',src:'assets/tracks/06-morning-pixels.mp3'}
];
const FEATURED = [
  {id:'requested-txrbo',type:'featured',name:'ต่อยให้',subtitle:'Txrbo · R&B / Soul',genre:'R&B / SOUL',icon:'♡',cover:'cover-txrbo',src:'',youtube:'https://www.youtube.com/watch?v=SW-aUT_3a1g'},
  {id:'requested-landokmai',type:'featured',name:'เพลงรักเพลงแรก (Blooming)',subtitle:'LANDOKMAI · Indie Pop',genre:'INDIE POP',icon:'✿',cover:'cover-landokmai',src:'',youtube:'https://www.youtube.com/watch?v=N9bashij_7c'}
];
let featureToUpload = null;
let featureObjectUrls = new Set();
let featureDbPromise = null;
function openFeatureDB(){
  if(!('indexedDB' in window))return Promise.resolve(null);
  if(!featureDbPromise){
    featureDbPromise = new Promise(resolve=>{
      try{
        const request=indexedDB.open('blooming-hands-audio-v3',1);
        request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('songs'))request.result.createObjectStore('songs');};
        request.onsuccess=()=>resolve(request.result);
        request.onerror=()=>resolve(null);
        request.onblocked=()=>resolve(null);
      }catch(e){console.warn('IndexedDB unavailable',e);resolve(null);}
    });
  }
  return featureDbPromise;
}
async function storeFeatureAudio(song,file){
  const db=await openFeatureDB(); if(!db)return false;
  return new Promise(resolve=>{
    try{const tx=db.transaction('songs','readwrite');tx.objectStore('songs').put(file,song.id);
      tx.oncomplete=()=>resolve(true);tx.onerror=()=>resolve(false);tx.onabort=()=>resolve(false);
    }catch(e){resolve(false);}
  });
}
async function restoreFeatureAudio(){
  const db=await openFeatureDB();if(!db)return;
  await Promise.all(FEATURED.map(song=>new Promise(resolve=>{
    try{const req=db.transaction('songs','readonly').objectStore('songs').get(song.id);
      req.onsuccess=()=>{if(req.result instanceof Blob){song.src=URL.createObjectURL(req.result);featureObjectUrls.add(song.src);song.hasSavedAudio=true;}resolve();};
      req.onerror=()=>resolve();
    }catch(e){resolve();}
  })));
  if(active.type==='featured'&&active.src)loadTrack(active,false);
  renderPlaylist();
}
function pickFeatured(song){
  featureToUpload=song;
  ui.featureUpload.value='';
  ui.featureUpload.click();
}
async function attachFeaturedFile(file){
  const song=featureToUpload; if(!song||!file)return;
  if(!file.type.startsWith('audio/')&&!/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)){
    status('โปรดเลือกไฟล์เพลง MP3, WAV หรือ M4A');return;
  }
  if(file.size>120*1024*1024){status('ไฟล์ใหญ่เกิน 120 MB');return;}
  const old= song.src;
  song.src=URL.createObjectURL(file);featureObjectUrls.add(song.src);
  if(old&&featureObjectUrls.has(old)){URL.revokeObjectURL(old);featureObjectUrls.delete(old);}
  song.hasSavedAudio=false;
  previewActive=false;loadTrack(song,false);updatePlayUI();
  status(`เพิ่มไฟล์เพลง ${song.name} แล้ว · กด ▶ หรือเปิดกล้องเพื่อเล่น`);
  const saved=await storeFeatureAudio(song,file);
  song.hasSavedAudio=saved;
  renderPlaylist();
  if(!saved)status(`เพิ่มเพลง ${song.name} สำเร็จ · แต่เบราว์เซอร์ไม่สามารถบันทึกไฟล์ไว้หลังรีเฟรชได้`);
}
let uploads = [];
let active = SONGS[0];
let activeTab = 'original';
let fileIndex = 0;
let audioContext, analyser, musicGain, toneFilter, masterGain;
let previewActive = false, muted = false, mode = 'gesture';
let targetEnergy = 0, energy = 0, handSpeed = 0, palmHeight = .5;
let activeHandCount = 0, cameraActive = false, startupPending = false;
let stream = null, facingMode = 'user', tracker = null, modelPromise = null, HandLandmarker = null;
let token = 0, frameId = 0, lastVideoTime = -1, lastInferMs = 0;
let lastMotionAt = -Infinity, previousCenters = [];
let visualizerRatio = 1, lastVisualFrame = performance.now(), lastStatusAudio = '';
let startBusy = false, lastPlayRetry = 0;
const MEDIAPIPE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs';
const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

function status(message) { if (ui.statusText.textContent !== message) ui.statusText.textContent = message; }
function audioStatus(message) { if (lastStatusAudio !== message) {ui.audioState.textContent=message;lastStatusAudio=message;} }
function timeText(secs) { const n = Math.max(0,Math.floor(Number.isFinite(secs)?secs:0)); return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`; }
function allTracks() { return [...FEATURED,...SONGS,...uploads].filter(t=>!!t.src); }
function getDuration() { return Number.isFinite(ui.musicAudio.duration) ? ui.musicAudio.duration : 0; }
function getClip() {
  const len = getDuration();
  const start = clamp(Number(active.start) || 0,0,Math.max(0,len-.1));
  const end = Number.isFinite(active.end) && active.end > start ? clamp(active.end,start+.1,len||start+.1) : len;
  return { start, end: Math.max(end,start+.1), len };
}
function hasClip() {
  const {start,end,len}=getClip();
  return len>0 && (start>.05 || end<len-.1);
}
function updateSeek() {
  const {start,end,len} = getClip();
  const audioTime=ui.musicAudio.currentTime;
  const max = hasClip()?end:len;
  const min = hasClip()?start:0;
  ui.seekBar.value = String(Math.round(clamp((audioTime-min)/Math.max(.1,max-min),0,1)*1000));
  ui.currentTime.textContent = timeText(audioTime);
  ui.durationTime.textContent = timeText(max);
}
function loadTrack(t, shouldPlay=false) {
  if (!t) return;
  const wasPlaying = previewActive || cameraActive && !ui.musicAudio.paused;
  active = t;
  ui.musicAudio.pause();
  if(t.src)ui.musicAudio.src = t.src;
  else ui.musicAudio.removeAttribute('src');
  ui.musicAudio.load();
  ui.songTitle.textContent=t.name;
  ui.songSubtitle.textContent=t.subtitle;
  ui.genreText.textContent=t.type==='original' ? `${t.genre} · ${t.bpm} BPM` : t.type==='featured'? `${t.genre} · FEATURED` : 'YOUR MUSIC · LOCAL FILE';
  ui.sourceLabel.textContent=t.type==='original' ? 'ORIGINAL INSTRUMENTAL' : t.type==='featured' ? 'YOUR REQUESTED SONG' : 'YOUR OWN MUSIC';
  ui.albumArt.className = `album-art ${t.cover}`;
  ui.albumSymbol.textContent=t.icon;
  ui.albumArt.querySelector('.album-corner').textContent=t.type==='original' ? `BH / ${String(SONGS.indexOf(t)+1).padStart(2,'0')}` : t.type==='featured' ? 'FEATURED / ♡' : 'YOU / ♫';
  ui.currentTime.textContent='0:00';ui.durationTime.textContent='0:00';ui.seekBar.value='0';
  activeTab=t.type;
  updateTabUI();
  renderPlaylist();
  syncClipEditor();
  if (!t.src && t.type==='featured')status(`เลือก ${t.name} แล้ว · กรุณาเพิ่มไฟล์เพลงจากเครื่องก่อนเล่นด้วยมือ`);
  if ((shouldPlay || wasPlaying) && t.src) void ensurePlayback();
}
function updateTabUI(){
  ui.featuredTab.classList.toggle('active',activeTab==='featured');
  ui.featuredTab.setAttribute('aria-pressed',String(activeTab==='featured'));
  ui.originalTab.classList.toggle('active',activeTab==='original');
  ui.myMusicTab.classList.toggle('active',activeTab==='upload');
  ui.originalTab.setAttribute('aria-pressed',String(activeTab==='original'));
  ui.myMusicTab.setAttribute('aria-pressed',String(activeTab==='upload'));
  ui.uploadCount.textContent=String(uploads.length).padStart(2,'0');
  ui.trackCount.textContent=`${String(activeTab==='featured'?FEATURED.length:activeTab==='original'?SONGS.length:uploads.length).padStart(2,'0')} TRACKS`;
  ui.featuredInstructions.hidden=activeTab!=='featured';
}
function renderPlaylist(){
  const tracks = activeTab==='featured'?FEATURED:activeTab==='original'?SONGS:uploads;
  ui.playlist.replaceChildren();
  if (!tracks.length) {
    const empty=document.createElement('div');empty.className='playlist-empty';
    empty.textContent='ยังไม่มีเพลงในเครื่องที่เพิ่มไว้ กด “เพิ่มเพลงจากเครื่อง” ด้านล่างได้เลย ♪';
    ui.playlist.append(empty);return;
  }
  tracks.forEach((t,index)=>{
    const row=document.createElement('div');row.className='track-row';
    row.classList.toggle('is-current',active.id===t.id);
    const button=document.createElement('button');button.type='button';button.className='track-pick';
    button.setAttribute('aria-label',`เลือกเพลง ${t.name}`);
    const number=document.createElement('span');number.className='track-num';number.textContent=String(index+1).padStart(2,'0');
    const cover=document.createElement('span');cover.className=`track-cover ${t.cover}`;cover.textContent=t.icon;
    const label=document.createElement('span');label.className='track-label';
    const title=document.createElement('strong');title.textContent=t.name;
    const sub=document.createElement('small');sub.textContent=t.subtitle;
    label.append(title,sub);
    const marker=document.createElement('span');marker.className='track-select-icon';marker.textContent=active.id===t.id?'♪':'↗';
    button.append(number,cover,label,marker);
    button.addEventListener('click',async()=>{
      if(t.type==='featured'&&!t.src){loadTrack(t,false);pickFeatured(t);return;}
      await unlockAudio();
      previewActive=true;
      loadTrack(t,true);
      updatePlayUI();
      status(`เลือกเพลง ${t.name} แล้ว · ยกมือขึ้นเพื่อเล่นตามจังหวะ`);
    });
    row.append(button);
    if(t.type==='featured'){
      const actions=document.createElement('div');actions.className='featured-actions';
      const state=document.createElement('span');state.className='featured-state';state.textContent=t.src?'✓ พร้อมเล่น':'รอไฟล์';actions.append(state);
      const add=document.createElement('button');add.type='button';add.className='featured-file-btn';add.textContent=t.src?'เปลี่ยนไฟล์':'＋ เพิ่มไฟล์';add.addEventListener('click',()=>pickFeatured(t));actions.append(add);
      const listen=document.createElement('a');listen.className='featured-link';listen.href=t.youtube;listen.target='_blank';listen.rel='noopener noreferrer';listen.textContent='YouTube ↗';listen.setAttribute('aria-label',`ฟัง ${t.name} บน YouTube`);actions.append(listen);
      row.append(actions);
    }
    if(t.type==='upload'){
      const del=document.createElement('button');del.className='remove-track';del.title=`ลบ ${t.name} ออกจากเพลย์ลิสต์`;del.setAttribute('aria-label',del.title);del.type='button';del.textContent='×';
      del.addEventListener('click',()=>removeUpload(t));row.append(del);
    }
    ui.playlist.append(row);
  });
}
function removeUpload(t){
  const isCurrent=active.id===t.id;
  uploads=uploads.filter(u=>u.id!==t.id);
  if(isCurrent){previewActive=false;loadTrack(SONGS[0],false);updatePlayUI();}
  URL.revokeObjectURL(t.src);
  updateTabUI();renderPlaylist();
  status(`ลบ ${t.name} ออกจากเพลย์ลิสต์แล้ว`);
}
function handleFiles(files){
  if(!files?.length)return;
  const accepted=[];
  for(const file of Array.from(files)){
    if(uploads.length>=30){status('เพิ่มเพลงได้สูงสุด 30 ไฟล์ต่อครั้ง');break;}
    if(file.size>100*1024*1024){status(`ไฟล์ ${file.name} ใหญ่เกิน 100 MB`);continue;}
    if(!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name))continue;
    const item={id:`user-${++fileIndex}`,type:'upload',name:file.name.replace(/\.[^.]+$/,'').slice(0,70),subtitle:'ไฟล์เพลงจากอุปกรณ์ของคุณ',genre:'YOUR MUSIC',icon:'♫',cover:'cover-upload',src:URL.createObjectURL(file)};
    uploads.push(item);accepted.push(item);
  }
  ui.audioUpload.value='';
  if(accepted.length){
    previewActive=false;
    loadTrack(accepted[0]);
    status(`เพิ่มเพลง ${accepted.length} เพลงแล้ว · เลือกเพลงเพื่อฟังหรือเปิดกล้อง`);
  } else {status('ไม่พบไฟล์เสียงที่รองรับ · โปรดลอง MP3 หรือ WAV');}
}
function syncClipEditor(){
  ui.trimControls.hidden=active.type==='original';
  ui.startSecond.value=String(active.start||0);
  ui.endSecond.value=String(Number.isFinite(active.end)?active.end:getDuration());
  ui.startSecond.max=String(getDuration());ui.endSecond.max=String(getDuration());
}
function updateClipInputs(){
  const len=getDuration();if(!len)return;
  let s=clamp(Number(ui.startSecond.value)||0,0,Math.max(0,len-.1));
  let e=clamp(Number(ui.endSecond.value)||len,s+.1,len);
  if(e<=s){e=Math.min(len,s+.2);}
  active.start=s;active.end=e;
  ui.startSecond.value=String(Math.round(s*10)/10);
  ui.endSecond.value=String(Math.round(e*10)/10);
  if(ui.musicAudio.currentTime<s || ui.musicAudio.currentTime>=e)ui.musicAudio.currentTime=s;
  updateSeek();
}
function chooseNext(direction){
  const tracks=allTracks();
  const idx=tracks.findIndex(t=>t.id===active.id);
  const next=tracks[(idx+direction+tracks.length)%tracks.length];
  loadTrack(next,true);
}
function initAudio(){
  if(audioContext)return;
  const AudioCtx=window.AudioContext||window.webkitAudioContext;
  if(!AudioCtx)throw new Error('เบราว์เซอร์นี้ไม่รองรับ Web Audio');
  audioContext=new AudioCtx();
  const source=audioContext.createMediaElementSource(ui.musicAudio);
  toneFilter=audioContext.createBiquadFilter();toneFilter.type='lowpass';toneFilter.frequency.value=12000;toneFilter.Q.value=.2;
  musicGain=audioContext.createGain();musicGain.gain.value=0;
  analyser=audioContext.createAnalyser();analyser.fftSize=256;analyser.smoothingTimeConstant=.84;
  masterGain=audioContext.createGain();masterGain.gain.value=Number(ui.masterVolume.value)/100;
  source.connect(toneFilter);toneFilter.connect(musicGain);musicGain.connect(analyser);analyser.connect(masterGain);masterGain.connect(audioContext.destination);
  ui.musicAudio.volume=1;
}
async function unlockAudio(){
  initAudio();
  if(audioContext.state==='suspended')await audioContext.resume();
}
async function ensurePlayback(){
  if(!active?.src){status('เพลงนี้ยังไม่มีไฟล์เสียง · กรุณาเพิ่มไฟล์ MP3 ของเพลงนี้ก่อน');return false;}
  try{
    if(ui.musicAudio.readyState>=1){const {start,end}=getClip();if(ui.musicAudio.currentTime<start||ui.musicAudio.currentTime>=end-.03)ui.musicAudio.currentTime=start;}
    if(ui.musicAudio.paused)await ui.musicAudio.play();
    return true;
  }catch(e){
    console.warn('Audio playback requires interaction:',e);
    status('เบราว์เซอร์ปิดกั้นการเล่นเสียง · กรุณากดปุ่ม ▶ อีกครั้ง');return false;
  }
}
function updatePlayUI(){
  ui.playIcon.textContent=previewActive?'❚❚':'▶';
  ui.previewAudio.classList.toggle('is-playing',previewActive);
  ui.previewAudio.setAttribute('aria-label',previewActive?'หยุดฟังเพลงตัวอย่าง':'เล่นเพลงตัวอย่าง');
}
async function togglePreview(){
  try{
    await unlockAudio();
    previewActive=!previewActive;
    if(previewActive){const played=await ensurePlayback();if(played)status(`กำลังฟัง ${active.name} · เปิดกล้องเพื่อเล่นด้วยมือได้`);else previewActive=false;}
    else if(!cameraActive)ui.musicAudio.pause();
    updatePlayUI();
  }catch(e){status(`เปิดเสียงไม่ได้: ${e.message}`);}
}
function applyEnergy(e){
  energy=clamp(e,0,1);
  let amount;
  if(previewActive)amount=.76;
  else if(!cameraActive)amount=0;
  else if(mode==='continuous')amount=.40+energy*.53;
  else amount=energy;
  if(musicGain && audioContext){
    musicGain.gain.setTargetAtTime(amount,audioContext.currentTime,.09);
    const freq=previewActive?11000:(activeHandCount?1400+clamp(palmHeight,0,1)*10000:11000);
    toneFilter.frequency.setTargetAtTime(freq,audioContext.currentTime,.15);
  }
  const value=Math.round(energy*100);
  ui.intensityNumber.textContent=`${value}%`;
  ui.intensityFill.style.width=`${value}%`;
  ui.activityValue.textContent=activeHandCount?`${activeHandCount} HAND${activeHandCount>1?'S':''} DETECTED`:'AWAITING MOVEMENT';
  audioStatus(muted?'เสียงถูกปิดอยู่':previewActive?'กำลังทดลองฟังเพลง':!cameraActive?'พร้อมเล่นเมื่อคุณขยับมือ':mode==='continuous'?'กำลังเล่นเพลงต่อเนื่อง':value>12?'กำลังควบคุมเพลงด้วยมือ ✨':'ขยับมือเพื่อเพิ่มเสียง');
}

async function getTracker(){
  if(tracker)return tracker;
  if(!modelPromise){
    modelPromise=(async()=>{
      const mp=await import(MEDIAPIPE);
      HandLandmarker=mp.HandLandmarker;
      const vision=await mp.FilesetResolver.forVisionTasks(WASM);
      const options={baseOptions:{modelAssetPath:MODEL,delegate:'GPU'},runningMode:'VIDEO',numHands:2,minHandDetectionConfidence:.58,minHandPresenceConfidence:.54,minTrackingConfidence:.52};
      try{tracker=await HandLandmarker.createFromOptions(vision,options);}
      catch(e){console.warn('Switching to CPU hand detection',e);options.baseOptions.delegate='CPU';tracker=await HandLandmarker.createFromOptions(vision,options);}
      return tracker;
    })().catch(e=>{modelPromise=null;throw e;});
  }
  return modelPromise;
}
function cameraError(error){
  if(!navigator.mediaDevices?.getUserMedia||!window.isSecureContext)return 'ต้องเปิดเว็บผ่าน HTTPS หรือ http://localhost จึงจะใช้กล้องได้';
  if(['NotAllowedError','PermissionDeniedError'].includes(error?.name))return 'ยังไม่ได้รับอนุญาตกล้อง · โปรดอนุญาตกล้องใน Safari/Chrome';
  if(error?.name==='NotFoundError')return 'ไม่พบกล้องในอุปกรณ์';
  if(error?.name==='NotReadableError')return 'กล้องอาจถูกแอปอื่นใช้อยู่ · กรุณาปิดแอปนั้นก่อน';
  return `เปิดกล้องไม่สำเร็จ: ${error?.message||'ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่'}`;
}
async function startCamera(){
  if(startupPending||cameraActive)return;
  startupPending=true;const current=++token;
  ui.startCamera.disabled=true;ui.startCamera.textContent='กำลังเปิดกล้องและโหลด AI...';
  status('กำลังเตรียมระบบ AI ตรวจจับมือ และขออนุญาตกล้อง...');
  try{
    // Start media during the tap gesture; crucial for Safari on iPhone.
    initAudio();
    const resumePromise=audioContext.resume();
    previewActive=false;updatePlayUI();
    const audioStart=active?.src?ui.musicAudio.play().catch(e=>console.warn('Awaiting user gesture for playback',e)):Promise.resolve();
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('ต้องเปิดผ่าน HTTPS หรือ localhost');
    const cameraPromise=navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facingMode},width:{ideal:960},height:{ideal:720},frameRate:{ideal:30,max:30}}}).then(s=>{
      if(current!==token){s.getTracks().forEach(t=>t.stop());return null;}return s;
    });
    const [newStream]=await Promise.all([cameraPromise,getTracker(),resumePromise,audioStart]);
    if(current!==token||!newStream){newStream?.getTracks().forEach(t=>t.stop());return;}
    stream=newStream;
    ui.video.srcObject=stream;await ui.video.play();
    if(current!==token){newStream.getTracks().forEach(t=>t.stop());return;}
    ui.handCanvas.width=ui.video.videoWidth||960;ui.handCanvas.height=ui.video.videoHeight||720;
    ui.cameraStage.classList.toggle('mirror',facingMode==='user');
    cameraActive=true;
    ui.cameraBadge.classList.remove('badge-off');ui.cameraBadge.classList.add('badge-on');ui.cameraBadgeText.textContent='CAMERA LIVE';
    ui.cameraEmpty.classList.add('is-hidden');
    ui.stopCamera.disabled=false;ui.flipCamera.disabled=false;ui.cameraRing.classList.add('active');
    ui.video.classList.add('active');
    lastVideoTime=-1;lastInferMs=0;previousCenters=[];lastMotionAt=-Infinity;
    status('เปิดกล้องแล้ว · ยกมือในกรอบแล้วโบกเพื่อเล่นเพลง 🎶');
    frameId=requestAnimationFrame(detectFrame);
  }catch(e){
    console.error('Camera start failed',e);
    if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
    status(cameraError(e));
  }finally{
    startupPending=false;ui.startCamera.disabled=false;ui.startCamera.textContent='◎ เปิดกล้อง เริ่มเล่น ↗';
  }
}
function stopCamera({preserveAudio=false}={}){
  ++token;cameraActive=false;startupPending=false;
  cancelAnimationFrame(frameId);
  if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}
  ui.video.pause();ui.video.srcObject=null;ui.video.classList.remove('active');
  ui.cameraBadge.classList.add('badge-off');ui.cameraBadge.classList.remove('badge-on');ui.cameraBadgeText.textContent='CAMERA OFF';
  ui.cameraEmpty.classList.remove('is-hidden');ui.cameraRing.classList.remove('active');
  ui.stopCamera.disabled=true;ui.flipCamera.disabled=true;ui.startCamera.disabled=false;ui.startCamera.textContent='◎ เปิดกล้อง เริ่มเล่น ↗';
  ui.trackingLabel.textContent='WAITING FOR HAND';ui.fpsLabel.textContent='— FPS';
  ui.handCanvas.getContext('2d').clearRect(0,0,ui.handCanvas.width,ui.handCanvas.height);
  targetEnergy=0;activeHandCount=0;previousCenters=[];lastMotionAt=-Infinity;
  if(!preserveAudio && !previewActive)ui.musicAudio.pause();
  if(!preserveAudio)status('ปิดกล้องแล้ว · คุณยังสามารถกด ▶ เพื่อฟังเพลงได้');
}
async function flipCamera(){
  if(!cameraActive)return;
  facingMode=facingMode==='user'?'environment':'user';
  stopCamera({preserveAudio:true});
  await startCamera();
}
function centerOf(hand){
  const ids=[0,5,9,13,17];let x=0,y=0;
  for(const i of ids){x+=hand[i].x/ids.length;y+=hand[i].y/ids.length;}
  return {x,y};
}
function palmOpen(hand){
  let count=0;
  for(const [tip,mid] of [[8,6],[12,10],[16,14],[20,18]]){
    const d1=Math.hypot(hand[tip].x-hand[0].x,hand[tip].y-hand[0].y);
    const d2=Math.hypot(hand[mid].x-hand[0].x,hand[mid].y-hand[0].y);
    if(d1>d2*1.10)count++;
  }
  return count>=2;
}
function drawHands(hands){
  const can=ui.handCanvas,ctx=can.getContext('2d');const w=can.width,h=can.height;
  ctx.clearRect(0,0,w,h);
  if(!HandLandmarker)return;
  hands.forEach((pts,index)=>{
    const color=index?'#b6e6f5':'#ffb4cc';ctx.save();ctx.lineWidth=2.9;ctx.lineCap='round';
    ctx.shadowColor=color;ctx.shadowBlur=10;ctx.strokeStyle=color;
    for(const {start,end} of HandLandmarker.HAND_CONNECTIONS){
      ctx.beginPath();ctx.moveTo(pts[start].x*w,pts[start].y*h);ctx.lineTo(pts[end].x*w,pts[end].y*h);ctx.stroke();
    }
    pts.forEach((p,i)=>{ctx.beginPath();ctx.arc(p.x*w,p.y*h,i%4===0?3.8:2.8,0,Math.PI*2);ctx.fillStyle=i%4===0?'#fff':color;ctx.fill();});
    ctx.restore();
  });
}
function detectFrame(now){
  if(!cameraActive||!tracker)return;
  frameId=requestAnimationFrame(detectFrame);
  if(now-lastInferMs<43||ui.video.readyState<2||ui.video.currentTime===lastVideoTime)return;
  const dt=lastInferMs?clamp((now-lastInferMs)/1000,.016,.2):1/24;
  lastInferMs=now;lastVideoTime=ui.video.currentTime;
  let points=[];
  try{points=tracker.detectForVideo(ui.video,now).landmarks||[];}
  catch(e){console.error('Tracker failed',e);stopCamera();status('เกิดข้อผิดพลาดระหว่างตรวจจับมือ · กรุณาเปิดกล้องอีกครั้ง');return;}
  drawHands(points);
  activeHandCount=points.length;
  const centers=points.map(centerOf);
  let biggest=0,openCount=0;
  centers.forEach((p,i)=>{
    if(palmOpen(points[i]))openCount++;
    const old=previousCenters[i];
    if(old)biggest=Math.max(biggest,Math.hypot(old.x-p.x,old.y-p.y)/dt);
  });
  previousCenters=centers;
  palmHeight=centers.length?1-centers[0].y:.75;
  const sample=clamp((biggest-.05)/.95,0,1);
  handSpeed += (sample-handSpeed)*.25;
  const open=openCount>0;
  if(open&&biggest>.15)lastMotionAt=now;
  const activeMotion=now-lastMotionAt<950;
  targetEnergy=open&&activeMotion?clamp(.23+handSpeed*1.65+(points.length>1?.1:0),0,1):0;
  ui.trackingLabel.textContent=points.length?`${points.length} HAND${points.length>1?'S':''} FOUND · ${open?'OPEN':'FIST'}`:'SEARCHING FOR HAND';
  ui.fpsLabel.textContent=`${Math.round(1/dt)} FPS`;
  status(!points.length?'ยังไม่เห็นมือ · ลองขยับเข้ามาหน้ากล้อง':!open?'ตรวจพบกำมือ · กำลังลดเสียง':activeMotion?'✦ กำลังเล่นเพลงด้วยมือของคุณ': 'ตรวจพบมือแล้ว · โบกมือเพื่อเพิ่มเสียงเพลง');
}
function resizeVisualizer(){
  const c=ui.visualizer,rect=c.getBoundingClientRect();
  visualizerRatio=Math.min(window.devicePixelRatio||1,2);
  c.width=Math.max(1,Math.round(rect.width*visualizerRatio));
  c.height=Math.round(108*visualizerRatio);
}
function animate(now){
  requestAnimationFrame(animate);
  const dt=clamp((now-lastVisualFrame)/1000,0,.09);lastVisualFrame=now;
  if(!cameraActive)targetEnergy=0;
  applyEnergy(energy+(targetEnergy-energy)*(1-Math.exp(-dt*(targetEnergy>energy?8:4.4))));
  if(cameraActive&&active?.src&&ui.musicAudio.paused&&now-lastPlayRetry>1500){
    lastPlayRetry=now;
    // Re-tries are useful on desktop; Safari may require another tap and will show status.
    void ensurePlayback();
  }
  const canvas=ui.visualizer,ctx=canvas.getContext('2d');if(!canvas.width)return;
  const w=canvas.width/visualizerRatio,h=canvas.height/visualizerRatio;
  ctx.setTransform(visualizerRatio,0,0,visualizerRatio,0,0);ctx.clearRect(0,0,w,h);
  const arr=analyser&&audioContext?.state==='running'?new Uint8Array(analyser.frequencyBinCount):null;
  if(arr)analyser.getByteFrequencyData(arr);
  const bars=68,step=w/bars,bw=Math.max(1.5,step*.47);
  const energyDisplay=Math.max(energy,previewActive?.50:0,mode==='continuous'&&cameraActive?.27:0);
  for(let i=0;i<bars;i++){
    const middle=1-Math.abs((i-bars/2)/(bars/2));
    const audio=arr?arr[Math.floor(i*arr.length/bars)]/255:0;
    const breath=.11+.1*Math.sin(now*.0018+i*.44);
    const strength=Math.max(.065,(audio*.85+(arr?.025:breath)+energyDisplay*.13)*(0.52+middle*.48));
    const bh=Math.min(h*.86,Math.max(4,strength*h*1.6));
    const x=i*step+(step-bw)/2;
    const grad=ctx.createLinearGradient(0,h/2-bh/2,0,h/2+bh/2);
    grad.addColorStop(0,'#a48de5');grad.addColorStop(.5,'#f493bc');grad.addColorStop(1,'#f5b498');
    ctx.fillStyle=grad;ctx.beginPath();ctx.roundRect(x,(h-bh)/2,bw,bh,bw/2);ctx.fill();
  }
  updateSeek();
}
function onMetadata(){
  const len=getDuration();
  if(active.type!=='original'){
    if(active.end===undefined)active.end=len;
    syncClipEditor();
  }
  const start=clamp(Number(active.start)||0,0,Math.max(0,len-.1));
  if(start>.05)ui.musicAudio.currentTime=start;
  updateSeek();
}
function onTimeUpdate(){
  if(!hasClip())return;
  const {start,end}=getClip();
  if(ui.musicAudio.currentTime>=end-.06){ui.musicAudio.currentTime=start;if(ui.musicAudio.paused&&(previewActive||cameraActive))void ensurePlayback();}
}
function setMode(next){
  mode=next;ui.gestureMode.classList.toggle('selected',mode==='gesture');ui.continuousMode.classList.toggle('selected',mode==='continuous');
  ui.gestureMode.setAttribute('aria-pressed',String(mode==='gesture'));ui.continuousMode.setAttribute('aria-pressed',String(mode==='continuous'));
  ui.modeHelp.textContent=mode==='gesture'?'โหมดตามมือ: แบมือและขยับเพื่อเพิ่มเสียง หากกำมือหรือไม่พบมือเสียงจะค่อย ๆ เบาลง':'โหมดต่อเนื่อง: เพลงเล่นเบา ๆ ตลอดเวลาที่กล้องเปิด ขยับมือเพื่อเพิ่มเสียงและเปลี่ยนโทน';
  status(mode==='gesture'?'เปิดโหมดควบคุมด้วยมือแล้ว':'เปิดโหมดเพลงต่อเนื่องแล้ว');
}
ui.startCamera.addEventListener('click',()=>void startCamera());
ui.stopCamera.addEventListener('click',()=>stopCamera());
ui.flipCamera.addEventListener('click',()=>void flipCamera());
ui.previewAudio.addEventListener('click',()=>void togglePreview());
ui.previousTrack.addEventListener('click',async()=>{await unlockAudio();previewActive=true;chooseNext(-1);updatePlayUI();});
ui.nextTrack.addEventListener('click',async()=>{await unlockAudio();previewActive=true;chooseNext(1);updatePlayUI();});
ui.muteAudio.addEventListener('click',()=>{
  muted=!muted;ui.muteAudio.setAttribute('aria-pressed',String(muted));
  ui.muteAudio.textContent=muted?'♩':'♫';ui.muteAudio.setAttribute('aria-label',muted?'เปิดเสียง':'ปิดเสียง');
  if(masterGain&&audioContext)masterGain.gain.setTargetAtTime(muted?0:Number(ui.masterVolume.value)/100,audioContext.currentTime,.05);
});
ui.masterVolume.addEventListener('input',()=>{
  ui.volumeValue.textContent=`${ui.masterVolume.value}%`;
  if(masterGain&&audioContext&&!muted)masterGain.gain.setTargetAtTime(Number(ui.masterVolume.value)/100,audioContext.currentTime,.08);
});
ui.gestureMode.addEventListener('click',()=>setMode('gesture'));
ui.continuousMode.addEventListener('click',()=>setMode('continuous'));
ui.featuredTab.addEventListener('click',()=>{activeTab='featured';updateTabUI();renderPlaylist();});
ui.originalTab.addEventListener('click',()=>{activeTab='original';updateTabUI();renderPlaylist();});
ui.myMusicTab.addEventListener('click',()=>{activeTab='upload';updateTabUI();renderPlaylist();});
ui.audioUpload.addEventListener('change',e=>handleFiles(e.target.files));
ui.featureUpload.addEventListener('change',e=>{const file=e.target.files?.[0];if(file)void attachFeaturedFile(file);ui.featureUpload.value='';});
ui.musicAudio.addEventListener('loadedmetadata',onMetadata);
ui.musicAudio.addEventListener('timeupdate',onTimeUpdate);
ui.musicAudio.addEventListener('ended',()=>{
  if(hasClip()){ui.musicAudio.currentTime=getClip().start;void ensurePlayback();}
  else if(previewActive||cameraActive)chooseNext(1);
});
ui.musicAudio.addEventListener('error',()=>{if(active)status(`เล่นไฟล์ ${active.name} ไม่ได้ · ลองเลือกไฟล์ MP3 หรือ WAV`);});
ui.seekBar.addEventListener('input',()=>{
  const {start,end,len}=getClip();
  const min=hasClip()?start:0,max=hasClip()?end:len;
  if(len)ui.musicAudio.currentTime=min+(max-min)*Number(ui.seekBar.value)/1000;
});
ui.resetTrim.addEventListener('click',()=>{active.start=0;active.end=getDuration();syncClipEditor();updateSeek();});
for(const input of [ui.startSecond,ui.endSecond])input.addEventListener('change',updateClipInputs);
window.addEventListener('resize',resizeVisualizer);
window.addEventListener('pagehide',()=>{
  stopCamera({preserveAudio:true});ui.musicAudio.pause();uploads.forEach(t=>URL.revokeObjectURL(t.src));featureObjectUrls.forEach(url=>URL.revokeObjectURL(url));
  if(audioContext)void audioContext.close();
});
loadTrack(FEATURED[0]);
void restoreFeatureAudio();
resizeVisualizer();requestAnimationFrame(animate);
