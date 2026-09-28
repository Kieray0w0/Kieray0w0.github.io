import { SAMPLE_RATE, HOP_SIZE, noteName, numberedNote } from './pitch-core.mjs';
import { createMicrophone } from './pitch-microphone.mjs';
import { parseMidi } from './pitch-midi.mjs';
import { createSession, encodeWav, SESSION_LIMIT, RECORDING_RATE } from './pitch-session.mjs';
import { createDualPlayback } from './pitch-playback.mjs';
import { createPiano, PIANO_ROWS, PIANO_WHITE_OFFSETS, pianoKeyOffset } from './pitch-piano.mjs';

const $ = id => document.getElementById(id);
const player = $('player'), recordingPlayer = $('recording-player');
const scroll = $('roll-scroll'), stage = $('roll-stage'), canvas = $('roll');
const context = canvas.getContext('2d');
const HEIGHT = 540, TOP = 30, KEY_WIDTH = 96;
const session = createSession();
let reference = {kind:'none',frames:[],notes:[],duration:0,buffer:null,tracks:[]};
let cursor = 0, minNote = 48, maxNote = 83, width = 800;
let zoom = Number($('zoom').value), job = 0, worker = null, animation = 0, loading = null;
let audioURL = null, recordingURL = null, exportedPCM = session.pcm;
let take = null, pendingTake = null, seekVersion = 0, micState = 'idle', lastMicError = '';
const programmedSeeks = new Map();
let timelineDragging = false;
const volumes = {reference:0.5,recording:0.5};
let referenceMonitor = null;
const playbackEnd = () => Math.max(reference.buffer?.duration || 0, session.duration);
const playback = createDualPlayback({
  onState(state) {
    $('dual-play').textContent=state==='starting'?'取消播放启动':state==='playing'?'暂停双轨播放':'双轨同步播放';
    $('dual-play').setAttribute('aria-pressed',String(state!=='idle'));
    $('dual-status').textContent=state==='starting'?'正在准备同步播放…':state==='playing'?'正在按时间轴同步播放原曲和麦克风轨。':'播放已暂停或结束，可从当前游标继续。';
    controls();
  },
  onPosition(time){cursor=time;follow();},
  onError(message){$('dual-status').textContent=message;},
});
async function playTogether(){
  if(micState!=='idle'||loading||!playbackEnd())return;
  piano.allOff();
  player.pause();recordingPlayer.pause();
  if(cursor>=playbackEnd())cursor=0;
  await playback.play({reference:reference.buffer,samples:session.pcm,sampleRate:RECORDING_RATE,offset:cursor});
}
$('dual-play').addEventListener('click',()=>playback.active?playback.pause():playTogether());
const totalTime = () => Math.min(SESSION_LIMIT, Math.max(10, reference.duration, session.duration, cursor));
const formatTime = seconds => {
  const tenth = Math.round(seconds * 10);
  return `${Math.floor(tenth / 600)}:${((tenth % 600) / 10).toFixed(1).padStart(4,'0')}`;
};
const pianoButtons=[];
$('recording-input').value='microphone';$('piano-octave').value='60';
const piano=createPiano({
  onKeys({held,active}){
    for(const {button,offset} of pianoButtons){
      const midi=Number($('piano-octave').value)+offset;
      button.setAttribute('aria-pressed',String(held.includes(midi)));
      button.setAttribute('data-sounding',String(active===midi));
    }
    $('piano-status').textContent=active===null?'琴键已松开。未录音时仅试听，开始录音后写入麦克风轨。':`正在弹奏 ${noteName(active)} · ${micState==='live'?'录入当前片段':'试听'}`;
  },
  onError(message){$('piano-status').textContent=message;},
});
const updatePianoVolume=()=>{
  const value=Number($('piano-volume').value);
  piano.setMonitorVolume(value/100);$('piano-volume-value').textContent=`${value}%`;
};
$('piano-volume').addEventListener('input',updatePianoVolume);updatePianoVolume();
for(const track of ['reference','recording']){
  const slider=$(`${track}-volume`),output=$(`${track}-volume-value`),media=track==='reference'?player:recordingPlayer;
  const update=(percent,fromMedia=false)=>{
    if(!Number.isFinite(percent))return;
    const value=Math.max(0,Math.min(100,Math.round(percent))),level=value/100;
    volumes[track]=level;slider.value=String(value);output.textContent=`${value}%`;
    playback.setVolume(track,level);
    if(track==='reference'&&referenceMonitor)referenceMonitor.gain.gain.setTargetAtTime(level,referenceMonitor.context.currentTime,0.01);
    if(!fromMedia){media.volume=level;media.muted=false;}
  };
  slider.addEventListener('input',()=>update(Number(slider.value)));
  media.addEventListener('volumechange',()=>update(media.muted?0:media.volume*100,true));
  update(Number(slider.value));
}
function pressPiano(token,offset){
  if(loading||micState==='requesting'||micState==='stopping')return;
  if(micState==='idle'){playback.pause();player.pause();recordingPlayer.pause();}
  return piano.press(token,Number($('piano-octave').value)+offset);
}
for(const row of PIANO_ROWS){
  let whiteKeys=0;
  const container=$(row.id==='middle'?'piano-keys':`piano-${row.id}-keys`);
  for(let localOffset=0;localOffset<=12;localOffset++){
    const black=[1,3,6,8,10].includes(localOffset),button=document.createElement('button');
    const key=row.keys[PIANO_WHITE_OFFSETS.indexOf(localOffset-(black?1:0))],shortcutName=black?`Shift+${key}`:key;
    const offset=row.offset+localOffset,token=`button:${row.id}:${localOffset}`;
    const pressedOffset=shift=>{
      if(!shift||black)return offset;
      return [0,2,5,7,9].includes(localOffset)?offset+1:null;
    };
    const label=document.createElement('span'),shortcut=document.createElement('kbd');
    button.type='button';button.className=`piano-key${black?' black':''}`;
    button.style.width=black?'7%':'12.5%';button.style.left=`${whiteKeys*12.5-(black?3.5:0)}%`;
    if(!black)whiteKeys++;
    shortcut.textContent=key;button.append(label);
    if(black){const modifier=document.createElement('small');modifier.textContent='Shift';button.append(modifier);}
    button.append(shortcut);container.append(button);
    button.setAttribute('aria-pressed','false');button.setAttribute('aria-keyshortcuts',shortcutName);button.title=shortcutName;
    button.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;event.preventDefault();const note=pressedOffset(event.shiftKey);if(note===null)return;
      button.setPointerCapture(event.pointerId);pressPiano(`pointer:${event.pointerId}`,note);
    });
    for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,e=>piano.release(`pointer:${e.pointerId}`));
    button.addEventListener('keydown',event=>{
      if(event.code==='Space'||event.code==='Enter'){
        event.preventDefault();const note=pressedOffset(event.shiftKey);if(!event.repeat&&note!==null)pressPiano(token,note);
      }
    });
    button.addEventListener('keyup',event=>{if(event.code==='Space'||event.code==='Enter'){event.preventDefault();piano.release(token);}});
    button.addEventListener('blur',()=>piano.release(token));
    pianoButtons.push({button,label,offset,key:shortcutName});
  }
}
function labelPiano(){
  for(const {button,label,offset,key} of pianoButtons){
    const note=noteName(Number($('piano-octave').value)+offset);label.textContent=note;button.setAttribute('aria-label',`${note}，键盘 ${key}`);
  }
  for(const row of PIANO_ROWS){
    const start=Number($('piano-octave').value)+row.offset;
    $(`piano-${row.id}-label`).textContent=`${row.label} · ${noteName(start)}–${noteName(start+12)} · ${row.keys.join(' ')}`;
  }
}
labelPiano();
$('piano-octave').addEventListener('change',()=>{piano.allOff();labelPiano();});
$('piano-keyboard').addEventListener('change',()=>piano.allOff());
$('piano-release').addEventListener('click',()=>piano.allOff());
document.addEventListener('keydown',event=>{
  if(event.defaultPrevented||event.isComposing||event.ctrlKey||event.altKey||event.metaKey)return;
  if(event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])'))return;
  if(event.code==='Period'&&!event.shiftKey){
    if(loading||micState==='stopping')return;
    event.preventDefault();
    if(!event.repeat)return toggleRecording();
    return;
  }
  if(event.code==='Space'){
    // Keep native button/media keyboard behavior and piano key presses intact.
    if(event.target?.closest?.('button, a, audio, video, [role="button"]'))return;
    if(micState!=='idle'||loading||!playbackEnd())return;
    event.preventDefault();
    if(!event.repeat)return playback.active?playback.pause():playTogether();
    return;
  }
  if(event.repeat||!$('piano-keyboard').checked)return;
  const offset=pianoKeyOffset(event.code,event.shiftKey);
  if(offset!==null){event.preventDefault();pressPiano(`key:${event.code}`,offset);}
});
document.addEventListener('keyup',event=>piano.release(`key:${event.code}`));
window.addEventListener('blur',()=>piano.allOff());
$('recording-input').addEventListener('change',()=>{
  piano.allOff();$('microphone-status').textContent=$('recording-input').value==='piano'?'仅钢琴模式：点击开始录音后弹奏，不申请麦克风权限。':'麦克风 + 钢琴模式：开始时申请麦克风权限，请戴耳机录制。';
});
const lowerBound = (list, value, field = 'time') => {
  let low = 0, high = list.length;
  while (low < high) { const mid = (low + high) >> 1; if (list[mid][field] < value) low = mid + 1; else high = mid; }
  return low;
};

function referencePitch(time, measured) {
  if (reference.kind === 'midi') {
    let result = null;
    for (let i = lowerBound(reference.notes, time + 1e-7, 'start') - 1; i >= 0; i--) {
      const note = reference.notes[i];
      if (note.maxEnd <= time) break;
      if (note.end > time && (result === null || Math.abs(note.midi - measured) < Math.abs(result - measured))) result = note.midi;
    }
    return result;
  }
  const at = lowerBound(reference.frames, time);
  const candidates = [reference.frames[at - 1], reference.frames[at]].filter(Boolean).sort((a,b)=>Math.abs(a.time-time)-Math.abs(b.time-time));
  return candidates[0] && Math.abs(candidates[0].time - time) <= 0.022 ? candidates[0].midi : null;
}
function micColor(frame) {
  const target = referencePitch(frame.time, frame.midi);
  if (target === null || Math.abs(frame.midi - target) <= 0.5) return '#32765f';
  return frame.midi > target ? '#c27735' : '#a84e68';
}
function draw() {
  const rowHeight = (HEIGHT - TOP) / (maxNote - minNote + 1);
  const yFor = midi => TOP + (maxNote - midi + 0.5) * rowHeight;
  const left = scroll.scrollLeft, fromTime = left / zoom, toTime = (left + width - KEY_WIDTH) / zoom;
  context.clearRect(0,0,width,HEIGHT); context.font = '11px monospace'; context.textBaseline = 'middle';
  for (let note = minNote; note <= maxNote; note++) {
    const y = yFor(note) - rowHeight / 2, black = [1,3,6,8,10].includes(note % 12);
    context.fillStyle = black ? '#edf0e8' : '#fffdf7'; context.fillRect(0,y,width,rowHeight);
    context.strokeStyle = note % 12 === 0 ? '#b5c4b0' : '#e1e6dc';
    context.beginPath(); context.moveTo(0,y+rowHeight); context.lineTo(width,y+rowHeight); context.stroke();
  }
  const tick = zoom < 45 ? 5 : zoom < 100 ? 2 : 1;
  context.fillStyle = '#f3f2e9'; context.fillRect(0,0,width,TOP);
  for (let time = Math.ceil(fromTime/tick)*tick; time <= Math.min(totalTime(),toTime); time += tick) {
    const x = KEY_WIDTH + time*zoom-left;
    context.strokeStyle = '#d8ded2'; context.beginPath(); context.moveTo(x,TOP); context.lineTo(x,HEIGHT); context.stroke();
    context.fillStyle = '#6b776d'; context.fillText(`${time}s`,x+4,TOP/2);
  }
  context.save(); context.beginPath(); context.rect(KEY_WIDTH,TOP,Math.max(0,width-KEY_WIDTH),HEIGHT-TOP); context.clip();
  const frameWidth = HOP_SIZE/SAMPLE_RATE;
  const drawFrames = (list, referenceLayer = false, shifted = 0, skipFrom = Infinity, skipTo = -Infinity) => {
    const start = lowerBound(list, fromTime - shifted - frameWidth);
    for (let i = start; i < list.length && list[i].time + shifted <= toTime + frameWidth; i++) {
      const frame = list[i], time = frame.time + shifted;
      if (frame.midi === null || (time >= skipFrom && time < skipTo)) continue;
      context.fillStyle = referenceLayer ? '#8fbed5' : micColor({...frame,time});
      const height = rowHeight*(referenceLayer ? 0.82 : 0.34);
      context.fillRect(KEY_WIDTH+(time-frameWidth/2)*zoom-left,yFor(frame.midi)-height/2,Math.max(1,frameWidth*zoom+0.5),height);
    }
  };
  if (reference.kind === 'midi') {
    let at = lowerBound(reference.notes,toTime,'start') - 1;
    for (; at >= 0; at--) {
      const note = reference.notes[at]; if (note.maxEnd < fromTime) break;
      if (note.end < fromTime) continue;
      const start = Math.max(fromTime,note.start), end = Math.min(toTime,note.end);
      context.fillStyle = '#8fbed5'; context.fillRect(KEY_WIDTH+start*zoom-left,yFor(note.midi)-rowHeight*0.41,Math.max(1,(end-start)*zoom),rowHeight*0.82);
    }
  } else drawFrames(reference.frames,true);
  const shift = take ? take.start - take.delayMs/1000 : 0;
  drawFrames(session.frames,false,0,take ? Math.max(0,shift) : Infinity,take ? cursor-take.delayMs/1000 : -Infinity);
  if (take) drawFrames(take.frames,false,shift);
  const playX = KEY_WIDTH+cursor*zoom-left;
  context.strokeStyle = '#bf7140'; context.lineWidth = 2; context.beginPath(); context.moveTo(playX,TOP); context.lineTo(playX,HEIGHT); context.stroke(); context.lineWidth = 1;
  context.restore();
  for (let note = minNote; note <= maxNote; note++) {
    const y = yFor(note), black = [1,3,6,8,10].includes(note % 12);
    context.fillStyle = black ? '#536458' : '#f8f6ee'; context.fillRect(0,y-rowHeight/2,KEY_WIDTH-1,rowHeight-1);
    context.fillStyle = black ? '#f4f4ec' : '#536458'; context.font = '11px monospace'; context.fillText(noteName(note),9,y);
    const numbered = numberedNote(note); context.font = `bold ${Math.min(12,rowHeight*0.48)}px monospace`; context.textAlign = 'center';
    context.fillText(String(numbered.digit),76,y); if (numbered.sharp) context.fillText('#',63,y);
    for (let dot=0;dot<Math.abs(numbered.octave);dot++) {
      context.beginPath(); context.arc(76,y-Math.sign(numbered.octave)*rowHeight*(0.28+dot*0.09),Math.min(1,rowHeight*0.035),0,Math.PI*2); context.fill();
    }
    context.textAlign = 'start';
  }
  context.fillStyle = '#f3f2e9'; context.fillRect(0,0,KEY_WIDTH,TOP); context.fillStyle = '#6b776d'; context.font = '10px monospace';
  context.fillText('音名',9,TOP/2); context.fillText('1=C',61,TOP/2);
  $('position').textContent = `${formatTime(cursor)} / ${formatTime(totalTime())}`;
  $('timeline').max = totalTime(); if (!timelineDragging) $('timeline').value = cursor;
}
function extendRange(midi) { if (midi !== null) { minNote=Math.min(minNote,Math.floor(midi)-2); maxNote=Math.max(maxNote,Math.ceil(midi)+2); } }
function refit() {
  minNote=48; maxNote=83;
  for (const frame of reference.frames) extendRange(frame.midi);
  for (const note of reference.notes) extendRange(note.midi);
  for (const frame of session.frames) extendRange(frame.midi);
  canvas.setAttribute('aria-label','双轨音高卷帘图。蓝色为参考，细线为麦克风；绿为接近参考，橙为偏高，红为偏低。左侧是音名和 C 调数字。');
}
function follow() {
  stage.style.width=`${Math.max(width,totalTime()*zoom+KEY_WIDTH+24)}px`;
  if ($('follow').checked) {
    const x=cursor*zoom;
    if(x<scroll.scrollLeft || x>scroll.scrollLeft+width-KEY_WIDTH-20) scroll.scrollLeft=Math.max(0,x-(width-KEY_WIDTH)*0.7);
  }
  draw();
}
function resize() {
  width=scroll.clientWidth; const ratio=Math.min(devicePixelRatio||1,2);
  canvas.width=Math.round(width*ratio);canvas.height=HEIGHT*ratio;canvas.style.width=`${width}px`;
  context.setTransform(ratio,0,0,ratio,0,0);stage.style.width=`${Math.max(width,totalTime()*zoom+KEY_WIDTH+24)}px`;draw();
}
function controls() {
  const active=micState!=='idle'||!!loading;
  $('dual-play').disabled=active||!playbackEnd();
  $('recording-input').disabled=active;
  for(const {button} of pianoButtons)button.disabled=!!loading||micState==='requesting'||micState==='stopping';
  $('undo-take').disabled=active||!session.canUndo;
  $('export-recording').disabled=active||!session.pcm.length;
  $('latency').disabled=active; $('play-reference').disabled=active||!reference.buffer;
  $('midi-track').disabled=active; recordingPlayer.hidden=active||!recordingURL;
  player.hidden=active||!audioURL;
  $('microphone-toggle').disabled=micState==='stopping'||!!loading;
  for(const id of ['import-start','import-use-cursor'])$(id).disabled=active;
  for(const id of ['import-earlier','import-later','import-apply'])$(id).disabled=active||!session.movableClip;
  const clip=session.movableClip;
  $('placement-note').textContent=clip ? `可移动：${clip.label} · 起始 ${clip.start.toFixed(3)} 秒 · 原始时长 ${clip.duration.toFixed(3)} 秒${clip.start<0||clip.start+clip.duration>SESSION_LIMIT?' · 超出 0–600 秒的部分已裁切':''}` : '尚无可移动的导入录音；若导入后进行了重录，可撤销重录或重新导入。';
  $('recording-summary').textContent=session.pcm.length ? `麦克风轨（导入 / 录制）${formatTime(session.duration)} · WAV / 单声道 / 16 kHz · ${exportedPCM===session.pcm?'当前版本已导出':'尚未导出，刷新会丢失'}` : '麦克风轨尚无录音。';
}
function refreshRecording() {
  playback.pause({updatePosition:false});
  programmedSeeks.delete(recordingPlayer);
  recordingPlayer.pause(); recordingPlayer.removeAttribute('src');recordingPlayer.load();
  if(recordingURL)URL.revokeObjectURL(recordingURL);recordingURL=null;
  if(session.pcm.length){recordingURL=URL.createObjectURL(new Blob([encodeWav(session.pcm)],{type:'audio/wav'}));recordingPlayer.src=recordingURL;}
  if(session.movableClip)$('import-start').value=session.movableClip.start.toFixed(3);
  controls();refit();follow();
}
function stopJob() {
  job++;worker?.terminate();worker=null;loading=null;
  for(const id of ['cancel','progress','recording-cancel','recording-progress'])$(id).hidden=true;
  controls();
}

const microphone=createMicrophone({
  onReady({context:audio,when,inputDestinations}) {
    piano.attach(audio,inputDestinations,when);
    let source=null,monitor=null;
    if(reference.buffer&&$('play-reference').checked&&pendingTake&&pendingTake.start<reference.duration){
      const gain=audio.createGain();gain.gain.value=volumes.reference;
      monitor={context:audio,gain};referenceMonitor=monitor;
      source=audio.createBufferSource();source.buffer=reference.buffer;source.connect(gain);gain.connect(audio.destination);source.start(when,pendingTake.start);
    }
    return ()=>{
      piano.detach();if(source){try{source.stop();}catch{} source.disconnect();}
      monitor?.gain.disconnect();if(referenceMonitor===monitor)referenceMonitor=null;
    };
  },
  onState(state,reason) {
    micState=state;
    const inputLabel=$('recording-input').value==='piano'?'钢琴':'麦克风 + 钢琴';
    const button=$('microphone-toggle');button.textContent=state==='requesting'?'取消启动录音':state==='live'?'停止并保存这一段':state==='stopping'?'正在合并录音…':'从当前位置开始录音';
    button.setAttribute('aria-pressed',String(state==='live'));
    if(state==='requesting'){
      lastMicError='';piano.allOff();player.pause();recordingPlayer.pause();
      $('microphone-status').textContent=$('recording-input').value==='piano'?'正在准备钢琴录音，不申请麦克风权限。':'正在申请麦克风并准备录音。此时不会覆盖旧片段。';
      $('microphone-pitch').textContent='等待录音输入…';
    }else if(state==='live'){
      take={...pendingTake,frames:[]};
      $('microphone-status').textContent=`${inputLabel}：从 ${formatTime(take.start)} 开始录音；停止后覆盖实际录制区间。请戴耳机。`;
    }else if(state==='stopping'){
      $('microphone-status').textContent='输入已停止，正在合并本段录音…';
    }else{
      pendingTake=null;
      piano.allOff();$('microphone-pitch').textContent='录音已停止';
      const messages={hidden:'页面进入后台，已停止并保存本段。',limit:'已到参考结尾或 10 分钟上限，本段已保存。','device-ended':'设备已断开，已保留接收到的录音。',interrupted:'音频输入中断，已保留接收到的录音。'};
      $('microphone-status').textContent=lastMicError||messages[reason]||'录音已停止。点击时间轴可定位并重新录制；可撤销上次覆盖。';
    }
    controls();follow();
  },
  onFrame(frame){
    if(!take)return;
    take.frames.push(frame);cursor=Math.min(SESSION_LIMIT,take.start+frame.elapsed);extendRange(frame.midi);
    if(frame.midi!==null){
      const n=numberedNote(frame.midi), octave=n.octave===0?'中音':`${n.octave>0?'高':'低'} ${Math.abs(n.octave)} 八度`;
      const target=referencePitch(frame.time+take.start-take.delayMs/1000,frame.midi);
      const deviation=target===null?'无对应参考':`${Math.round((frame.midi-target)*100)} 音分`;
      $('microphone-pitch').textContent=`${noteName(frame.midi)} · 简谱 ${n.sharp?'#':''}${n.digit}（${octave}） · ${frame.hz.toFixed(1)} Hz · ${deviation}`;
    }else $('microphone-pitch').textContent='未检测到可信音高（声音仍在录制）';
    follow();
  },
  onTake({samples,sampleRate,complete}){
    if(!take)return;
    cursor=Math.min(SESSION_LIMIT,take.start+samples.length/sampleRate);
    session.apply({samples,sampleRate,start:take.start,delayMs:take.delayMs,pitchFrames:take.frames});take=null;
    if(!complete)lastMicError='录音收尾未完整响应，已保留收到的完整音频块；末尾可能缺少一小段。';
    refreshRecording();
  },
  onError(message){lastMicError=message;$('microphone-status').textContent=message;},
});
async function startRecording(){
  if(loading)return;
  playback.pause();piano.allOff();
  if(cursor>=SESSION_LIMIT){$('microphone-status').textContent='已到 10 分钟上限，请先定位到更早的位置。';return;}
  if(!Number.isFinite(Number($('latency').value))){$('microphone-status').textContent='请输入有效的延迟补偿。';return;}
  stopJob();pendingTake={start:cursor,delayMs:Math.max(-1000,Math.min(1000,Number($('latency').value)))};
  const end=reference.duration>cursor ? reference.duration : SESSION_LIMIT;
  await microphone.start({maxSeconds:end-cursor,input:$('recording-input').value});
}
function toggleRecording(){
  if(loading||micState==='stopping')return;
  return micState==='idle'?startRecording():microphone.stop();
}
$('microphone-toggle').addEventListener('click',toggleRecording);
async function seekTo(time){
  const version=++seekVersion,restart=micState==='live',resumePlayback=playback.active;
  playback.pause();
  player.pause();recordingPlayer.pause();await microphone.stop();
  if(version!==seekVersion)return;
  cursor=Math.max(0,Math.min(SESSION_LIMIT,time));
  if(audioURL){const time=Math.min(cursor,reference.duration);programmedSeeks.set(player,time);player.currentTime=time;}
  if(recordingURL){const time=Math.min(cursor,session.duration);programmedSeeks.set(recordingPlayer,time);recordingPlayer.currentTime=time;}
  $('seek-seconds').value=cursor.toFixed(2);follow();
  if(restart&&!document.hidden)await startRecording();
  else if(resumePlayback&&!document.hidden&&cursor<playbackEnd())await playTogether();
}
$('timeline').addEventListener('pointerdown',()=>{timelineDragging=true;});
$('timeline').addEventListener('pointerup',()=>{timelineDragging=false;});
$('timeline').addEventListener('pointercancel',()=>{timelineDragging=false;draw();});
$('timeline').addEventListener('change',event=>{timelineDragging=false;return seekTo(Number(event.target.value));});
$('seek-go').addEventListener('click',()=>{const time=Number($('seek-seconds').value);if(Number.isFinite(time))seekTo(time);});
canvas.addEventListener('click',event=>{const x=event.clientX-canvas.getBoundingClientRect().left;if(x>=KEY_WIDTH)seekTo((x-KEY_WIDTH+scroll.scrollLeft)/zoom);});
$('undo-take').addEventListener('click',()=>{
  if(micState==='idle'&&!loading&&session.undo()){
    refreshRecording();
    $('microphone-status').textContent=$('recording-import-status').textContent='已撤销上次导入、覆盖或移动，恢复此前录音与音高。';
  }
});
$('export-recording').addEventListener('click',()=>{
  if(micState!=='idle'||loading||!recordingURL)return;
  const link=document.createElement('a');link.href=recordingURL;link.download='microphone-recording.wav';link.click();exportedPCM=session.pcm;controls();
});

function setMidiTrack(index){
  let maxEnd=0;
  reference.notes=reference.tracks[index].notes.map(note=>({...note,maxEnd:(maxEnd=Math.max(maxEnd,note.end))}));
  reference.frames=[];refit();follow();
}
$('midi-track').addEventListener('change',event=>{if(micState==='idle')setMidiTrack(Number(event.target.value));});
function installReference(next,file){
  playback.pause();
  programmedSeeks.delete(player);
  player.pause();player.removeAttribute('src');player.load();if(audioURL)URL.revokeObjectURL(audioURL);audioURL=null;
  reference=next;cursor=0;scroll.scrollLeft=0;
  $('midi-track-controls').hidden=next.kind!=='midi';$('midi-track').replaceChildren();
  if(next.kind==='midi'){
    next.tracks.forEach((track,i)=>{const option=document.createElement('option');option.value=i;option.textContent=`${track.name}（${track.notes.length} 个音符）`;$('midi-track').append(option);});
    $('midi-track').value='0';setMidiTrack(0);
  }else{audioURL=URL.createObjectURL(file);player.src=audioURL;}
  $('file-name').textContent=file.name;
  $('summary').textContent=next.kind==='midi'?'标准参考：MIDI 音符与速度事件。请选择旋律声部；此版本不合成 MIDI 伴奏，忽略踏板和弯音。':'估计参考：从原曲提取音高，伴奏与和声可能造成误识别，不保证是标准旋律。';
  $('status').textContent=`参考已加载 · ${formatTime(next.duration)}。已有麦克风录音保持不变。`;
  refit();stopJob();follow();
}
function importStart(){
  const value=$('import-start').value.trim(),start=Number(value);
  if(!value||!Number.isFinite(start)||start < -SESSION_LIMIT||start >= SESSION_LIMIT)throw new Error('请输入 -600 至 600 之间的起始秒数（不含 600）。');
  return start;
}
function moveImport(start){
  if(micState!=='idle'||loading||!session.movableClip)return;
  try{
    if(start===undefined)start=importStart();
    if(!Number.isFinite(start)||start < -SESSION_LIMIT||start >= SESSION_LIMIT||!session.moveImport(start))throw new Error('录音必须至少有一部分位于 0–600 秒内，请调整起始时间。');
    cursor=Math.max(0,start);refreshRecording();
    $('recording-import-status').textContent=`已将录音声音和音高移至 ${start.toFixed(3)} 秒，旧位置已恢复。`;
  }catch(error){$('recording-import-status').textContent=error.message;}
}
$('import-apply').addEventListener('click',()=>moveImport());
$('import-earlier').addEventListener('click',()=>{if(session.movableClip)moveImport(Math.round((session.movableClip.start-0.01)*1000)/1000);});
$('import-later').addEventListener('click',()=>{if(session.movableClip)moveImport(Math.round((session.movableClip.start+0.01)*1000)/1000);});
$('import-use-cursor').addEventListener('click',()=>{if(micState==='idle'&&!loading)$('import-start').value=cursor.toFixed(3);});

async function loadFile(event,kind){
  const file=event.target.files[0];if(!file)return;event.target.value='';
  const recording=kind==='recording',status=$(recording?'recording-import-status':'status'),progress=$(recording?'recording-progress':'progress');
  let start=0;
  try{if(recording)start=importStart();}catch(error){status.textContent=error.message;return;}
  if(!file.size||file.size>100*1024*1024){status.textContent='请选择非空且不超过 100 MB 的文件。';return;}
  if(recording&&/\.midi?$/i.test(file.name)){status.textContent='麦克风轨需导入音频文件，MIDI 请在参考区上传。';return;}
  ++seekVersion;piano.allOff();playback.pause();stopJob();loading=kind;
  const current=job;
  $(recording?'recording-cancel':'cancel').hidden=false;progress.hidden=false;progress.removeAttribute('value');controls();
  status.textContent=recording?'正在本机读取录音文件…':'正在本机读取参考文件…';
  try{
    await microphone.stop('file');if(current!==job)return;
    player.pause();recordingPlayer.pause();
    const raw=await file.arrayBuffer();if(current!==job)return;
    if(/\.midi?$/i.test(file.name)){
      if(file.size>2*1024*1024)throw new Error('MIDI 请限制在 2 MB 内。');
      const parsed=parseMidi(raw);installReference({kind:'midi',...parsed,frames:[],notes:[],buffer:null},file);return;
    }
    const decoder=new OfflineAudioContext(1,1,SAMPLE_RATE);const buffer=await decoder.decodeAudioData(raw);if(current!==job)return;
    if(buffer.duration>SESSION_LIMIT)throw new Error('音频超过 10 分钟，请先剪短。');
    if(buffer.duration<0.1)throw new Error('音频过短，请至少提供 0.1 秒。');
    if(recording&&start+buffer.duration<=0)throw new Error('录音必须至少有一部分位于 0–600 秒内，请调整起始时间。');
    const renderer=new OfflineAudioContext(1,Math.ceil(buffer.duration*SAMPLE_RATE),SAMPLE_RATE),source=renderer.createBufferSource();
    source.buffer=buffer;source.connect(renderer.destination);source.start();const mono=await renderer.startRendering();if(current!==job)return;
    const samples=mono.getChannelData(0).slice(),activeWorker=new Worker(new URL('./pitch-worker.mjs',import.meta.url),{type:'module'});worker=activeWorker;
    const failed=message=>{if(current!==job)return;stopJob();status.textContent=message;};
    activeWorker.onmessage=({data})=>{
      if(current!==job)return;if(data.error){failed(data.error);return;}
      if(!data.frames){progress.value=data.progress;status.textContent=`正在提取${recording?'导入录音':'原曲参考'}音高… ${Math.round(data.progress*100)}%`;return;}
      if(recording){
        if(!session.apply({samples:mono.getChannelData(0),sampleRate:SAMPLE_RATE,start,pitchFrames:data.frames,movable:true,label:file.name})){
          failed('录音未落在有效时间轴内，请调整起始时间。');return;
        }
        cursor=Math.max(0,start);stopJob();refreshRecording();
        status.textContent=`已导入 ${file.name}，起始 ${start.toFixed(3)} 秒。可微调位置、试听、重录或导出。${data.frames.some(frame=>frame.midi!==null)?'':'未检测到可信音高，但音频已保留。'}`;
        return;
      }
      installReference({kind:'audio',frames:data.frames,notes:[],tracks:[],duration:buffer.duration,buffer:mono},file);
      if(!data.frames.some(frame=>frame.midi!==null))$('status').textContent='原曲中未检测到可信音高，仍可播放参考音频并录制麦克风。';
    };
    activeWorker.onerror=event=>{event.preventDefault();failed('分析模块无法运行，请通过 localhost 或 HTTPS 打开页面。');};
    activeWorker.postMessage(samples,[samples.buffer]);
  }catch(error){if(current!==job)return;stopJob();status.textContent=error.name==='EncodingError'?'无法解码音频，请转换成 WAV 或 MP3。':error.message;}
}
$('audio-file').addEventListener('change',event=>loadFile(event,'reference'));
$('recording-file').addEventListener('change',event=>loadFile(event,'recording'));
$('cancel').addEventListener('click',()=>{stopJob();$('status').textContent='已取消，原有参考与录音未改变。';});
$('recording-cancel').addEventListener('click',()=>{stopJob();$('recording-import-status').textContent='已取消录音导入，原有轨道未改变。';});
$('zoom').addEventListener('input',event=>{const start=scroll.scrollLeft/zoom;zoom=Number(event.target.value);$('zoom-value').textContent=`${zoom} px/s`;resize();scroll.scrollLeft=start*zoom;draw();});
scroll.addEventListener('scroll',draw,{passive:true});
function playbackTick(media){
  animation=0;cursor=Math.min(SESSION_LIMIT,media.currentTime);follow();
  if(!media.paused&&!media.ended)animation=requestAnimationFrame(()=>playbackTick(media));
}
for(const [media,other] of [[player,recordingPlayer],[recordingPlayer,player]]){
  media.addEventListener('play',()=>{if(micState!=='idle'||loading){media.pause();return;}piano.allOff();playback.pause();other.pause();cancelAnimationFrame(animation);playbackTick(media);});
  for(const event of ['pause','ended'])media.addEventListener(event,()=>{cancelAnimationFrame(animation);animation=0;draw();});
  media.addEventListener('seeked',()=>{
    const expected=programmedSeeks.get(media);programmedSeeks.delete(media);
    if(expected!==undefined&&Math.abs(expected-media.currentTime)<0.05)return;
    if(micState==='idle'&&!playback.active){cursor=media.currentTime;follow();}
  });
  media.addEventListener('error',()=>{if(media.getAttribute('src'))$('status').textContent='音频播放失败，请重试或导出录音后播放。';});
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){++seekVersion;piano.allOff();playback.pause();microphone.stop('hidden');player.pause();recordingPlayer.pause();}});
window.addEventListener('beforeunload',event=>{if(micState!=='idle'||(session.pcm.length&&exportedPCM!==session.pcm)){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>{++seekVersion;piano.dispose();playback.dispose();microphone.stop('hidden');stopJob();player.pause();recordingPlayer.pause();cancelAnimationFrame(animation);});
new ResizeObserver(resize).observe(scroll);controls();resize();
