import {trackEnd, playbackSlice} from './pitch-playback.mjs';

export const MIX_RATE = 48000;

export function mixPlan(tracks) {
  return tracks.flatMap(track => {
    const duration = track.buffer?.duration ?? (track.samples?.length || 0) / (track.sampleRate || MIX_RATE);
    if (!track.enabled || !Number.isFinite(track.volume) || track.volume <= 0) return [];
    const start = track.start ?? 0, slice = playbackSlice(duration,start,0);
    return slice ? [{...track,volume:Math.min(1,track.volume),slice,end:trackEnd(duration,start)}] : [];
  });
}

// Yield between blocks so long stereo exports do not freeze the controls.
export async function encodeMixWav(buffer, {onProgress=()=>{}, yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0))} = {}) {
  const channels = [buffer.getChannelData(0),buffer.getChannelData(Math.min(1,buffer.numberOfChannels-1))];
  const length=buffer.length,block=262144;
  let peak=0;
  for(let from=0;from<length;from+=block){
    const end=Math.min(length,from+block);
    for(let i=from;i<end;i++)for(const channel of channels)if(Number.isFinite(channel[i]))peak=Math.max(peak,Math.abs(channel[i]));
    onProgress(0.5*end/length);await yieldTask();
  }
  const scale=peak>1?0.99/peak:1;
  const wav=new ArrayBuffer(44+length*4),view=new DataView(wav);
  const text=(offset,value)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,wav.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);
  view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*4,true);view.setUint16(32,4,true);view.setUint16(34,16,true);
  text(36,'data');view.setUint32(40,length*4,true);
  for(let from=0;from<length;from+=block){
    const end=Math.min(length,from+block);
    for(let i=from;i<end;i++)for(let channel=0;channel<2;channel++){
      const input=channels[channel][i],sample=Number.isFinite(input)?Math.max(-1,Math.min(1,input*scale)):0;
      view.setInt16(44+i*4+channel*2,Math.round(sample*(sample<0?32768:32767)),true);
    }
    onProgress(0.5+0.5*end/length);await yieldTask();
  }
  return {wav,scale,peak};
}

export async function exportMix(tracks, {createContext=(length)=>new OfflineAudioContext(2,length,MIX_RATE),onProgress=()=>{},yieldTask} = {}) {
  const plan=mixPlan(tracks);
  if(!plan.length)throw new Error('没有可导出的未静音音频，请先载入音频并开启至少一轨（音量需大于 0%）。');
  const duration=Math.max(...plan.map(track=>track.end));
  const audio=createContext(Math.ceil(duration*MIX_RATE)),nodes=[];
  try{
    for(const track of plan){
      let buffer=track.buffer;
      if(!buffer){buffer=audio.createBuffer(1,track.samples.length,track.sampleRate);buffer.copyToChannel(track.samples,0);}
      const source=audio.createBufferSource(),gain=audio.createGain();nodes.push(source,gain);
      source.buffer=buffer;gain.gain.value=track.volume;source.connect(gain);gain.connect(audio.destination);
      source.start(track.slice.delay,track.slice.offset,track.slice.duration);
    }
    onProgress(null);
    const rendered=await audio.startRendering();
    const result=await encodeMixWav(rendered,{onProgress,yieldTask});
    return {...result,duration,labels:plan.map(track=>track.label)};
  }finally{for(const node of nodes)node.disconnect();}
}
