export function createDualPlayback({onState, onPosition, onError, createContext = () => new AudioContext(),
  requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame}) {
  let audio = null, sources = [], state = 'idle', generation = 0, frame = 0;
  let start = 0, when = 0, end = 0, cachedPCM = null, recordingBuffer = null;
  const volumes = {reference:0.5, recording:0.5};
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
    async play({reference, samples, sampleRate, offset}) {
      pause();
      end = Math.max(reference?.duration || 0, samples.length / sampleRate);
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
        // Both sources use one scheduled audio-clock instant, not two media play() calls.
        when = audio.currentTime + 0.04;
        const buffers = [{track:'reference', buffer:reference}, {track:'recording', buffer:samples.length ? recordingBuffer : null}]
          .filter(({buffer}) => buffer && buffer.duration > offset);
        let remaining = buffers.length;
        for (const {track, buffer} of buffers) {
          const source = audio.createBufferSource(), gain = audio.createGain();
          source.buffer = buffer; gain.gain.value = volumes[track];
          source.connect(gain); gain.connect(audio.destination); sources.push({source, gain, track});
          source.onended = () => {
            if (current !== generation || --remaining > 0) return;
            onPosition(end); pause({updatePosition:false});
          };
          source.start(when, offset);
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
