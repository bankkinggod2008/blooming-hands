// MediaPipe is loaded on demand so the audio demo works even if its CDN is unavailable.
let HandLandmarker = null;

// Blooming Hands — camera frames and user-chosen audio stay on the device.
const $ = (id) => document.getElementById(id);
const ui = {
  video: $('video'), handCanvas: $('handCanvas'), cameraStage: $('cameraStage'),
  startCamera: $('startCamera'), stopCamera: $('stopCamera'), cameraEmpty: $('cameraEmpty'),
  cameraBadge: $('cameraBadge'), cameraBadgeText: $('cameraBadgeText'),
  cameraRing: $('cameraRing'), trackingLabel: $('trackingLabel'), fpsLabel: $('fpsLabel'),
  inCamTip: $('inCamTip'), statusText: $('statusText'),
  visualizer: $('visualizer'), audioState: $('audioState'), activityValue: $('activityValue'),
  intensityNumber: $('intensityNumber'), intensityFill: $('intensityFill'),
  intensityDot: $('intensityDot'), previewAudio: $('previewAudio'),
  previewText: $('previewText'), muteAudio: $('muteAudio'), audioMode: $('audioMode'),
  songTitle: $('songTitle'), songSubtitle: $('songSubtitle'), modeExplainer: $('modeExplainer'),
  audioUpload: $('audioUpload'), dropZone: $('dropZone'), dropMain: $('dropMain'),
  dropDesc: $('dropDesc'), trimControls: $('trimControls'), startSecond: $('startSecond'),
  endSecond: $('endSecond'), resetAudio: $('resetAudio'), uploadedTrack: $('uploadedTrack')
};

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const modelUrl = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const wasmUrl = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
let modelPromise = null;
let landmarker = null;
let stream = null;
let cameraActive = false;
let startupPending = false;
let generation = 0;
let frameId = 0;
let lastVideoTime = -1;
let lastInferMs = 0;
let priorCenters = [];
let latestSpeed = 0;
let smoothedSpeed = 0;
let lastMotionAt = -Infinity;
let targetEnergy = 0;
let energy = 0;
let activeHandCount = 0;
let lastFrameMs = performance.now();
let audioContext = null;
let masterGain = null;
let synthGain = null;
let trackGain = null;
let analyser = null;
let audioIsMuted = false;
let manualPreview = false;
let audioFileUrl = null;
let visualizerDpr = 1;
let lastAudioUpdate = 0;
let lastSoundMessage = '';

function setStatus(text) {
  if (ui.statusText.textContent !== text) ui.statusText.textContent = text;
}
function setSoundLabel(text) {
  if (lastSoundMessage !== text) { ui.audioState.textContent = text; lastSoundMessage = text; }
}
function describeCameraError(error) {
  if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
    return 'กล้องต้องเปิดผ่าน HTTPS หรือ http://localhost — ดูคู่มือ README';
  }
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
    return 'ไม่ได้รับอนุญาตใช้กล้อง กรุณาอนุญาตกล้องในเบราว์เซอร์แล้วลองใหม่';
  }
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') return 'ไม่พบกล้องในอุปกรณ์นี้';
  if (error?.name === 'NotReadableError') return 'กล้องถูกใช้อยู่ในโปรแกรมอื่น กรุณาปิดโปรแกรมนั้นก่อน';
  return `เริ่มระบบไม่สำเร็จ: ${error?.message || 'ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต'}`;
}

async function getModel() {
  if (landmarker) return landmarker;
  if (!modelPromise) {
    modelPromise = (async () => {
      const mediaPipe = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs');
      HandLandmarker = mediaPipe.HandLandmarker;
      const vision = await mediaPipe.FilesetResolver.forVisionTasks(wasmUrl);
      const options = {
        baseOptions: { modelAssetPath: modelUrl, delegate: 'GPU' },
        runningMode: 'VIDEO', numHands: 2,
        minHandDetectionConfidence: .6,
        minHandPresenceConfidence: .55,
        minTrackingConfidence: .55
      };
      try {
        landmarker = await HandLandmarker.createFromOptions(vision, options);
      } catch (gpuError) {
        console.warn('GPU tracking unavailable; using CPU:', gpuError);
        options.baseOptions.delegate = 'CPU';
        landmarker = await HandLandmarker.createFromOptions(vision, options);
      }
      return landmarker;
    })().catch((error) => { modelPromise = null; throw error; });
  }
  return modelPromise;
}

// A small, original, royalty-free synthetic choir pad for testing; NOT the LANDOKMAI recording or melody.
function initAudio() {
  if (audioContext) return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) throw Error('เบราว์เซอร์ไม่รองรับ Web Audio');
  audioContext = new AudioCtx();
  masterGain = audioContext.createGain();
  masterGain.gain.value = .8;
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = .8;
  masterGain.connect(analyser);
  analyser.connect(audioContext.destination);

  synthGain = audioContext.createGain();
  synthGain.gain.value = 0;
  synthGain.connect(masterGain);
  trackGain = audioContext.createGain();
  trackGain.gain.value = 0;
  trackGain.connect(masterGain);
  const mediaSource = audioContext.createMediaElementSource(ui.uploadedTrack);
  mediaSource.connect(trackGain);
  ui.uploadedTrack.volume = 1;

  // Chord is an original sustained Fmaj7 sonority, not the linked song's musical passage.
  const frequencies = [174.61, 220, 261.63, 329.63, 523.25];
  const level = [.13, .10, .09, .075, .025];
  frequencies.forEach((hz, idx) => {
    const voice = audioContext.createGain();
    voice.gain.value = level[idx];
    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = idx === 4 ? 1300 : 900;
    filter.Q.value = .6;
    const osc = audioContext.createOscillator();
    osc.type = idx % 2 ? 'triangle' : 'sine';
    osc.frequency.value = hz;
    osc.detune.value = (idx - 2) * 2.5;
    osc.connect(filter); filter.connect(voice); voice.connect(synthGain);
    const lfo = audioContext.createOscillator();
    const lfoDepth = audioContext.createGain();
    lfo.type = 'sine'; lfo.frequency.value = .27 + idx * .07;
    lfoDepth.gain.value = 2.4;
    lfo.connect(lfoDepth); lfoDepth.connect(osc.detune);
    osc.start(); lfo.start();
  });
}
async function unlockAudio() {
  initAudio();
  if (audioContext.state === 'suspended') await audioContext.resume();
}
function getTrim() {
  const duration = Number.isFinite(ui.uploadedTrack.duration) ? ui.uploadedTrack.duration : 0;
  const start = clamp(Number(ui.startSecond.value) || 0, 0, Math.max(0, duration - .05));
  const rawEnd = Number(ui.endSecond.value);
  const end = clamp(Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : duration, start + .05, duration || start + .05);
  return {start, end};
}
function ensureTrackWithinTrim() {
  if (!audioFileUrl || !Number.isFinite(ui.uploadedTrack.duration)) return;
  const {start, end} = getTrim();
  if (ui.uploadedTrack.currentTime < start || ui.uploadedTrack.currentTime >= end - .06) {
    ui.uploadedTrack.currentTime = start;
  }
}
async function playLocalTrack() {
  if (!audioFileUrl || !ui.uploadedTrack.paused) return;
  ensureTrackWithinTrim();
  try { await ui.uploadedTrack.play(); }
  catch (err) { setStatus(`เปิดไฟล์เสียงไม่ได้: ${err.message}`); }
}
function applyEnergy(value, hard = false) {
  energy = clamp(value, 0, 1);
  if (audioContext) {
    const t = audioContext.currentTime;
    const liveLevel = energy * (audioIsMuted ? 0 : 1);
    const previewLevel = manualPreview ? .52 : 0;
    const level = Math.max(previewLevel, liveLevel);
    // Exponential approach avoids pops and the harsh on/off behavior of .play() alone.
    synthGain.gain.setTargetAtTime(audioFileUrl ? 0 : level * .78, t, hard ? .008 : .10);
    trackGain.gain.setTargetAtTime(audioFileUrl ? level * .9 : 0, t, hard ? .008 : .10);
  }
  const percent = Math.round(energy * 100);
  ui.intensityFill.style.width = `${percent}%`;
  ui.intensityDot.style.left = `${percent}%`;
  ui.intensityDot.style.opacity = percent ? '1' : '0';
  ui.intensityNumber.textContent = `${percent}%`;
  ui.activityValue.textContent = `${Math.round(smoothedSpeed * 100)}% ENERGY`;
  setSoundLabel(audioIsMuted ? 'ปิดเสียงอยู่' : manualPreview ? 'กำลังทดลองฟัง' : percent >= 12 ? 'กำลังเล่นคอรัส ♪' : 'รอการขยับมือ');
}

function resetHandState() {
  priorCenters = [];
  smoothedSpeed = 0;
  latestSpeed = 0;
  activeHandCount = 0;
  lastMotionAt = -Infinity;
  targetEnergy = 0;
  applyEnergy(0, true);
}

async function startCamera() {
  if (cameraActive || startupPending) return;
  startupPending = true;
  const token = ++generation;
  ui.startCamera.disabled = true;
  ui.startCamera.textContent = 'กำลังเตรียมกล้องและโมเดล...';
  setStatus('กำลังขออนุญาตกล้องและโหลด AI ตรวจจับมือ...');
  try {
    await unlockAudio();
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('ต้องเปิดผ่าน HTTPS หรือ localhost เพื่อใช้กล้อง');
    const cameraPromise = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: {ideal: 960}, height: {ideal: 720}, frameRate: {ideal: 30, max: 30} }
    }).then(newStream => {
      if (token !== generation || !startupPending) {
        newStream.getTracks().forEach(track => track.stop());
        return null;
      }
      stream = newStream;
      return newStream;
    });
    const trackerPromise = getModel();
    const [newStream] = await Promise.all([cameraPromise, trackerPromise]);
    if (token !== generation || !newStream) { newStream?.getTracks().forEach(track => track.stop()); return; }
    ui.video.srcObject = stream;
    await ui.video.play();
    if (token !== generation) { stopCamera(); return; }
    ui.handCanvas.width = ui.video.videoWidth || 960;
    ui.handCanvas.height = ui.video.videoHeight || 720;
    cameraActive = true;
    startupPending = false;
    ui.video.classList.add('active');
    ui.cameraEmpty.classList.add('is-hidden');
    ui.cameraBadge.classList.add('online');
    ui.cameraBadgeText.textContent = 'LIVE';
    ui.cameraRing.classList.add('active');
    ui.stopCamera.disabled = false;
    ui.inCamTip.hidden = false;
    setTimeout(() => { if (cameraActive) ui.inCamTip.hidden = true; }, 3800);
    setStatus('เปิดกล้องสำเร็จ ลองยกมือขึ้นแล้วขยับ');
    lastInferMs = 0;
    lastVideoTime = -1;
    resetHandState();
    frameId = requestAnimationFrame(detectFrame);
  } catch (error) {
    console.error('Could not start:', error);
    if (stream) { stream.getTracks().forEach(track => track.stop()); stream = null; }
    setStatus(describeCameraError(error));
    ui.startCamera.textContent = 'ลองเปิดกล้องอีกครั้ง ↗';
  } finally {
    startupPending = false;
    ui.startCamera.disabled = false;
    if (cameraActive) ui.startCamera.textContent = 'เปิดกล้อง & เริ่มเล่น ↗';
  }
}
function stopCamera() {
  ++generation;
  cameraActive = false;
  startupPending = false;
  cancelAnimationFrame(frameId);
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  ui.video.pause(); ui.video.srcObject = null;
  ui.video.classList.remove('active');
  ui.cameraEmpty.classList.remove('is-hidden');
  ui.cameraBadge.classList.remove('online');
  ui.cameraBadgeText.textContent = 'OFFLINE';
  ui.cameraRing.classList.remove('active');
  ui.stopCamera.disabled = true;
  ui.startCamera.disabled = false;
  ui.startCamera.textContent = 'เปิดกล้อง & เริ่มเล่น ↗';
  ui.inCamTip.hidden = true;
  ui.trackingLabel.textContent = 'NO HAND DETECTED';
  ui.fpsLabel.textContent = '— FPS';
  ui.handCanvas.getContext('2d').clearRect(0, 0, ui.handCanvas.width, ui.handCanvas.height);
  manualPreview = false;
  ui.previewText.textContent = audioFileUrl ? 'ทดลองฟังท่อนคอรัส' : 'ทดลองฟังเสียงตัวอย่าง';
  ui.uploadedTrack.pause();
  resetHandState();
  setStatus('ปิดกล้องแล้ว กลับมาเล่นใหม่ได้ทุกเมื่อ');
}

function palmCenter(points) {
  const ids = [0, 5, 9, 13, 17];
  return ids.reduce((a, i) => ({x:a.x + points[i].x / ids.length, y:a.y + points[i].y / ids.length}), {x:0, y:0});
}
function isOpenPalm(points) {
  // Compare wrist-to-tip and wrist-to-middle-joint distances to handle different rotations.
  let extended = 0;
  for (const [tip, pip] of [[8,6],[12,10],[16,14],[20,18]]) {
    const dist = (p) => Math.hypot(points[p].x - points[0].x, points[p].y - points[0].y);
    if (dist(tip) > dist(pip) * 1.12) extended++;
  }
  return extended >= 2;
}
function drawLandmarks(hands) {
  const canvas = ui.handCanvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const connections = HandLandmarker.HAND_CONNECTIONS;
  hands.forEach((points, handIndex) => {
    const c = handIndex === 0 ? '#f7bfdc' : '#d0c2ff';
    ctx.save();
    ctx.shadowBlur = 12;
    ctx.shadowColor = c;
    ctx.strokeStyle = c;
    ctx.lineWidth = 2.7;
    for (const {start, end} of connections) {
      ctx.beginPath();
      ctx.moveTo(points[start].x * w, points[start].y * h);
      ctx.lineTo(points[end].x * w, points[end].y * h);
      ctx.stroke();
    }
    ctx.shadowBlur = 9;
    points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, i % 4 === 0 ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = i % 4 === 0 ? '#fff5ee' : c;
      ctx.fill();
    });
    ctx.restore();
  });
}
function detectFrame(nowMs) {
  if (!cameraActive || !landmarker) return;
  frameId = requestAnimationFrame(detectFrame);
  if (nowMs - lastInferMs < 43 || ui.video.readyState < 2 || ui.video.currentTime === lastVideoTime) return;
  const sampleDt = lastInferMs ? clamp((nowMs - lastInferMs) / 1000, .016, .2) : 1 / 24;
  lastInferMs = nowMs;
  lastVideoTime = ui.video.currentTime;
  let landmarks = [];
  try {
    const result = landmarker.detectForVideo(ui.video, nowMs);
    landmarks = result.landmarks || [];
  } catch (err) {
    console.error(err);
    setStatus('ไม่สามารถวิเคราะห์ภาพกล้องได้ กรุณาลองเปิดกล้องใหม่');
    stopCamera();
    return;
  }
  drawLandmarks(landmarks);
  const hands = landmarks.length;
  activeHandCount = hands;
  let biggestSpeed = 0;
  let openCount = 0;
  const current = [];
  for (let i = 0; i < hands; i++) {
    const center = palmCenter(landmarks[i]);
    current.push(center);
    if (isOpenPalm(landmarks[i])) openCount++;
    const prior = priorCenters[i];
    if (prior) {
      const speed = Math.hypot(center.x - prior.x, center.y - prior.y) / sampleDt;
      biggestSpeed = Math.max(biggestSpeed, speed);
    }
  }
  priorCenters = current;
  latestSpeed = clamp((biggestSpeed - .055) / 1.0, 0, 1);
  smoothedSpeed += (latestSpeed - smoothedSpeed) * .29;
  const open = openCount > 0;
  if (open && biggestSpeed > .17) lastMotionAt = nowMs;
  const recentlyMoved = nowMs - lastMotionAt < 780;
  targetEnergy = open && recentlyMoved ? clamp(.18 + smoothedSpeed * 1.45 + (hands > 1 ? .07 : 0), 0, 1) : 0;
  const intendedState = hands === 0 ? 'ยังไม่พบมือ ลองยกมือให้อยู่ในกรอบ'
    : !open ? 'กำมืออยู่ — เสียงกำลังเบาลง'
    : recentlyMoved ? `ตรวจพบ ${hands} มือ • กำลังสร้างเสียงคอรัส` : 'ตรวจพบมือแล้ว ลองโบกให้เสียงดังขึ้น';
  setStatus(intendedState);
  ui.trackingLabel.textContent = hands ? `${hands} HAND${hands > 1 ? 'S' : ''} TRACKED · ${open ? 'OPEN' : 'CLOSED'}` : 'SEARCHING FOR HANDS';
  ui.fpsLabel.textContent = `${Math.round(1 / sampleDt)} FPS`;
}

function resizeVisualizer() {
  const c = ui.visualizer;
  const rect = c.getBoundingClientRect();
  visualizerDpr = Math.min(window.devicePixelRatio || 1, 2);
  c.width = Math.max(1, Math.round(rect.width * visualizerDpr));
  c.height = Math.round(80 * visualizerDpr);
}
function paintVisualizer(now) {
  requestAnimationFrame(paintVisualizer);
  const elapsed = clamp((now - lastFrameMs) / 1000, 0, .1);
  lastFrameMs = now;
  if (!cameraActive && !manualPreview) targetEnergy = 0;
  const blend = 1 - Math.exp(-elapsed * (targetEnergy > energy ? 7 : 4));
  const next = energy + (targetEnergy - energy) * blend;
  applyEnergy(next);
  if (audioFileUrl && audioContext && (energy > .04 || manualPreview)) {
    ensureTrackWithinTrim();
    if (ui.uploadedTrack.paused && now - lastAudioUpdate > 650) {
      lastAudioUpdate = now;
      void playLocalTrack();
    }
  } else if (ui.uploadedTrack && !ui.uploadedTrack.paused && !manualPreview && energy < .013) {
    ui.uploadedTrack.pause();
  }
  const canvas = ui.visualizer, ctx = canvas.getContext('2d');
  if (!canvas.width) return;
  const w = canvas.width / visualizerDpr, h = canvas.height / visualizerDpr;
  ctx.setTransform(visualizerDpr, 0, 0, visualizerDpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const bars = 61, gap = 3.3, step = w / bars, barW = Math.max(1.1, step - gap);
  let bins = null;
  if (analyser && audioContext?.state === 'running') {
    bins = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(bins);
  }
  const loud = Math.max(energy, manualPreview ? .43 : 0);
  for (let i=0; i<bars; i++) {
    const x = i * step + (step - barW)/2;
    const wave = (Math.sin(i*.49+now*.0016)*.5+.5)*.36 + (Math.sin(i*.23-now*.0011)*.5+.5)*.32;
    const spectral = bins ? bins[Math.min(bins.length-1, Math.round(i/bars * 48))]/255 : 0;
    const height = 3 + (wave + spectral*.7) * (10 + loud*69) + Math.sin(i*.12+now*.0009)**2 * loud*8;
    const grad = ctx.createLinearGradient(0, h/2-height/2, 0, h/2+height/2);
    grad.addColorStop(0, loud > .05 ? '#f2b2d7' : '#67566e');
    grad.addColorStop(.55, loud > .05 ? '#d0b2f7' : '#7a6281');
    grad.addColorStop(1, loud > .05 ? '#9c89d9' : '#4b405b');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, (h-height)/2, barW, Math.min(h-2,height), Math.min(3,barW/2));
    ctx.fill();
  }
}

async function togglePreview() {
  try {
    await unlockAudio();
    manualPreview = !manualPreview;
    ui.previewText.textContent = manualPreview ? 'หยุดทดลองฟัง' : (audioFileUrl ? 'ทดลองฟังท่อนคอรัส' : 'ทดลองฟังเสียงตัวอย่าง');
    if (manualPreview && audioFileUrl) await playLocalTrack();
    if (!manualPreview && audioFileUrl && !cameraActive) ui.uploadedTrack.pause();
    if (manualPreview) setStatus('กำลังทดลองฟังเสียง — เปิดกล้องเพื่อควบคุมด้วยมือ');
  } catch (error) { setStatus(`ไม่สามารถเปิดระบบเสียง: ${error.message}`); }
}
function toggleMute() {
  audioIsMuted = !audioIsMuted;
  ui.muteAudio.setAttribute('aria-pressed', String(audioIsMuted));
  ui.muteAudio.setAttribute('aria-label', audioIsMuted ? 'เปิดเสียง' : 'ปิดเสียง');
  ui.muteAudio.textContent = audioIsMuted ? '♩' : '♬';
  if (audioContext) masterGain.gain.setTargetAtTime(audioIsMuted ? 0 : .8, audioContext.currentTime, .05);
}
async function loadAudioFile(file) {
  if (!file) return;
  if (file.size > 100 * 1024 * 1024) { setStatus('ไฟล์เสียงใหญ่เกิน 100 MB'); return; }
  if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|ogg|aac|flac)$/i.test(file.name)) {
    setStatus('ไฟล์นี้ไม่ใช่ไฟล์เสียง กรุณาเลือก MP3, WAV, M4A หรือ OGG'); return;
  }
  manualPreview = false;
  ui.uploadedTrack.pause();
  if (audioFileUrl) URL.revokeObjectURL(audioFileUrl);
  audioFileUrl = URL.createObjectURL(file);
  ui.uploadedTrack.src = audioFileUrl;
  ui.uploadedTrack.load();
  ui.dropMain.textContent = file.name;
  ui.dropDesc.textContent = 'ไฟล์เสียงอยู่บนอุปกรณ์ของคุณ • พร้อมควบคุมด้วยมือ';
  ui.audioMode.textContent = 'YOUR CHORUS · LOCAL AUDIO';
  ui.songTitle.textContent = 'เพลงรักเพลงแรก';
  ui.songSubtitle.textContent = file.name;
  ui.modeExplainer.textContent = 'ใช้ไฟล์เสียงจากเครื่องของคุณ กำหนดช่วงเริ่มและสิ้นสุดท่อนคอรัสด้านล่าง ระบบจะวนเฉพาะช่วงที่เลือก';
  ui.trimControls.hidden = false;
  ui.previewText.textContent = 'ทดลองฟังท่อนคอรัส';
  setStatus('เพิ่มไฟล์เสียงแล้ว รออ่านความยาวเพลง...');
}
function resetAudioFile() {
  manualPreview = false;
  ui.uploadedTrack.pause();
  ui.uploadedTrack.removeAttribute('src');
  ui.uploadedTrack.load();
  if (audioFileUrl) URL.revokeObjectURL(audioFileUrl);
  audioFileUrl = null;
  ui.audioUpload.value = '';
  ui.trimControls.hidden = true;
  ui.dropMain.textContent = 'อัปโหลดเสียงท่อนคอรัสของคุณ';
  ui.dropDesc.textContent = 'MP3, WAV, M4A หรือ OGG · ไม่ส่งไฟล์ขึ้นเซิร์ฟเวอร์';
  ui.audioMode.textContent = 'DEMO CHORUS · SYNTH PAD';
  ui.songSubtitle.textContent = 'LANDOKMAI · Interactive experience';
  ui.modeExplainer.textContent = 'เสียงเริ่มต้นเป็นเสียงสังเคราะห์ตัวอย่าง ไม่ใช่ท่อนร้องจากเพลงต้นฉบับ — อัปโหลดไฟล์เสียงที่มีสิทธิ์ใช้เพื่อเล่นท่อนเพลงจริง';
  ui.previewText.textContent = 'ทดลองฟังเสียงตัวอย่าง';
  setStatus(cameraActive ? 'ใช้เสียงตัวอย่างแล้ว ลองโบกมือ' : 'กลับมาใช้เสียงสังเคราะห์ตัวอย่าง');
}

ui.startCamera.addEventListener('click', startCamera);
ui.stopCamera.addEventListener('click', stopCamera);
ui.previewAudio.addEventListener('click', togglePreview);
ui.muteAudio.addEventListener('click', toggleMute);
ui.audioUpload.addEventListener('change', e => void loadAudioFile(e.target.files?.[0]));
ui.uploadedTrack.addEventListener('loadedmetadata', () => {
  const duration = ui.uploadedTrack.duration;
  ui.startSecond.value = '0';
  ui.endSecond.value = String(Math.round(Math.min(duration,25) * 10) / 10);
  ui.startSecond.max = String(duration);
  ui.endSecond.max = String(duration);
  setStatus(`ไฟล์พร้อมเล่น • ความยาว ${Math.round(duration)} วินาที`);
});
ui.uploadedTrack.addEventListener('error', () => { if (audioFileUrl) setStatus('ไม่สามารถอ่านไฟล์เสียงนี้ ลองเปลี่ยนเป็น MP3 หรือ WAV'); });
ui.resetAudio.addEventListener('click', resetAudioFile);
for (const input of [ui.startSecond, ui.endSecond]) {
  input.addEventListener('change', () => {
    const {start,end} = getTrim();
    ui.startSecond.value = String(Math.round(start*10)/10);
    ui.endSecond.value = String(Math.round(end*10)/10);
    ensureTrackWithinTrim();
  });
}
ui.dropZone.addEventListener('dragover', e => { e.preventDefault(); ui.dropZone.classList.add('dragging'); });
ui.dropZone.addEventListener('dragleave', () => ui.dropZone.classList.remove('dragging'));
ui.dropZone.addEventListener('drop', e => {
  e.preventDefault(); ui.dropZone.classList.remove('dragging');
  const file = e.dataTransfer?.files?.[0]; if (file) void loadAudioFile(file);
});
window.addEventListener('resize', resizeVisualizer);
window.addEventListener('pagehide', () => {
  stopCamera();
  if (audioFileUrl) URL.revokeObjectURL(audioFileUrl);
  if (audioContext) void audioContext.close();
});
resizeVisualizer();
requestAnimationFrame(paintVisualizer);
