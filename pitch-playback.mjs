export function trackEnd(duration, start = 0) {
  return [duration,start].every(Number.isFinite) && duration > 0 && start < 600 ? Math.max(0, Math.min(600, start + duration)) : 0;
}

// File time and timeline time differ by start; clip without modifying source PCM.
export function playbackSlice(duration, start, cursor, until = 600) {
  const from = Math.max(0, start, cursor), to = Math.min(600, start + duration, until);
  if (![duration,start,cursor,until].every(Number.isFinite) || to <= from) return null;
  return {delay:from-cursor,offset:from-start,duration:to-from,clipped:to < start+duration};
}

export function createDualPlayback({onState, onPosition, onError, createContext = () => new AudioContext(),
  requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame}) {
  let audio = null, sources = [], state = 'idle', generation = 0, frame = 0;
  let start = 0, when = 0, end = 0, cachedPCM = null, recordingBuffer = null;
  const volumes = {reference:0.5, recording:0.5, accompaniment:0.5};
  const position = () => Math.min(end, start + Math.max(0, audio.currentTime - when));
  function pause({updatePosition = true} = {}) {
    generation++;
    if (state === 'playing' && updatePosition) onPosition(position());
    cancelFrame(frame); frame = 0;
    for (const {source, gain} of sources) {
      source.onended = null;
      try { source.stop(); } catch {}
      source.disconnect(); gain.disconnect();
    }
    sources = [];
    if (state !== 'idle') { state = 'idle'; onState(state); }
  }
  function tick() {
    frame = 0;
    if (state !== 'playing') return;
    onPosition(position());
    frame = requestFrame(tick);
  }
  return {
    get active() { return state !== 'idle'; },
    pause,
    setVolume(track, value) {
      if (!Object.hasOwn(volumes, track) || !Number.isFinite(value)) return;
      volumes[track] = Math.max(0, Math.min(1, value));
      for (const {gain, track:sourceTrack} of sources) {
        if (sourceTrack === track) gain.gain.setTargetAtTime(volumes[track], audio.currentTime, 0.01);
      }
    },
    async play({reference, accompaniment = null, referenceStart = 0, accompanimentStart = 0, samples, sampleRate, offset}) {
      pause();
      end = Math.max(trackEnd(reference?.duration || 0,referenceStart),trackEnd(accompaniment?.duration || 0,accompanimentStart),trackEnd(samples.length / sampleRate));
      if (!Number.isFinite(offset) || offset < 0 || offset >= end) return;
      const current = generation;
      state = 'starting'; onState(state);
      try {
        if (!audio) {
          audio = createContext();
          audio.onstatechange = () => {
            if (state === 'playing' && audio.state !== 'running') pause();
          };
        }
        await audio.resume();
        if (current !== generation) return;
        if (audio.state !== 'running') throw new Error('Audio context unavailable');
        if (samples.length && cachedPCM !== samples) {
          recordingBuffer = audio.createBuffer(1, samples.length, sampleRate);
          recordingBuffer.copyToChannel(samples, 0); cachedPCM = samples;
        }
        start = offset;
        // All sources share one audio-clock instant, including muted tracks.
        when = audio.currentTime + 0.04;
        const buffers = [{track:'reference', buffer:reference,start:referenceStart}, {track:'recording', buffer:samples.length ? recordingBuffer : null,start:0}, {track:'accompaniment', buffer:accompaniment,start:accompanimentStart}]
          .map(item=>({...item,slice:item.buffer&&playbackSlice(item.buffer.duration,item.start,offset)})).filter(item=>item.slice);
        let remaining = buffers.length;
        for (const {track, buffer, slice} of buffers) {
          const source = audio.createBufferSource(), gain = audio.createGain();
          source.buffer = buffer; gain.gain.value = volumes[track];
          source.connect(gain); gain.connect(audio.destination); sources.push({source, gain, track});
          source.onended = () => {
            if (current !== generation || --remaining > 0) return;
            onPosition(end); pause({updatePosition:false});
          };
          if(slice.clipped)source.start(when+slice.delay,slice.offset,slice.duration);
          else source.start(when+slice.delay,slice.offset);
        }
        state = 'playing'; onState(state); tick();
      } catch {
        if (current !== generation) return;
        pause({updatePosition:false}); onError('同步播放未能启动，请再次点击播放或检查浏览器音频权限。');
      }
    },
    dispose() {
      pause(); cachedPCM = null; recordingBuffer = null;
      if (audio) { audio.onstatechange = null; void audio.close().catch(() => {}); audio = null; }
    },
  };
}
