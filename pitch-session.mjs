export const RECORDING_RATE = 16000;
export const SESSION_LIMIT = 600;

export function resamplePCM(input, fromRate, toRate = RECORDING_RATE) {
  if (!Number.isFinite(fromRate) || fromRate <= 0) throw new Error('Invalid recording sample rate');
  if (fromRate === toRate) return input;
  const output = new Float32Array(Math.round(input.length * toRate / fromRate));
  const ratio = fromRate / toRate;
  for (let i = 0; i < output.length; i++) {
    const start = i * ratio;
    if (ratio <= 1) {
      const at = Math.floor(start), mix = start - at;
      output[i] = (input[at] || 0) * (1 - mix) + (input[Math.min(at + 1, input.length - 1)] || 0) * mix;
    } else {
      const end = Math.min(input.length, start + ratio);
      let sum = 0;
      for (let at = Math.floor(start); at < end; at++) sum += input[at] * (Math.min(at + 1, end) - Math.max(at, start));
      output[i] = sum / (end - start);
    }
  }
  return output;
}

export function createSession() {
  let pcm = new Float32Array(0), frames = [], previous = null, placement = null;
  // Moving an import always rebuilds from its pre-import baseline, not from
  // the already merged audio, so the old location is restored without ghosts.
  function merge(base, input, start, pitchFrames, delayMs) {
    if (![start, delayMs].every(Number.isFinite)) throw new Error('Invalid take position');
    const shiftedStart = Math.round((start - delayMs / 1000) * RECORDING_RATE);
    const from = Math.max(0, shiftedStart), skip = Math.max(0, -shiftedStart);
    const length = Math.min(input.length - skip, SESSION_LIMIT * RECORDING_RATE - from);
    if (length <= 0) return null;
    const end = from + length;
    const output = new Float32Array(Math.max(base.pcm.length, end));
    output.set(base.pcm); output.set(input.subarray(skip, skip + length), from);
    const beginTime = from / RECORDING_RATE, endTime = end / RECORDING_RATE;
    const newFrames = pitchFrames.map(frame => ({ ...frame, time: frame.time + start - delayMs / 1000 }))
      .filter(frame => frame.time >= beginTime && frame.time < endTime);
    return {pcm:output,frames:base.frames.filter(frame => frame.time < beginTime || frame.time >= endTime).concat(newFrames).sort((a,b)=>a.time-b.time)};
  }
  return {
    get pcm() { return pcm; },
    get frames() { return frames; },
    get duration() { return pcm.length / RECORDING_RATE; },
    get canUndo() { return previous !== null; },
    get movableClip() { return placement ? {start:placement.start,duration:placement.input.length/RECORDING_RATE,label:placement.label} : null; },
    apply({ samples, sampleRate, start, pitchFrames = [], delayMs = 0, movable = false, label = '' }) {
      const input = resamplePCM(samples, sampleRate);
      const base = {pcm,frames}, merged = merge(base,input,start,pitchFrames,delayMs);
      if (!merged) return false;
      previous = {pcm,frames,placement};
      ({pcm,frames} = merged);
      placement = movable ? {base,input,start,pitchFrames,delayMs,label} : null;
      return true;
    },
    moveImport(start) {
      if (!placement) return false;
      const merged = merge(placement.base,placement.input,start,placement.pitchFrames,placement.delayMs);
      if (!merged) return false;
      previous = {pcm,frames,placement};
      ({pcm,frames} = merged); placement = {...placement,start};
      return true;
    },
    undo() {
      if (!previous) return false;
      ({ pcm, frames, placement } = previous); previous = null; return true;
    },
  };
}

export function encodeWav(samples, sampleRate = RECORDING_RATE) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (at, value) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const value = Number.isFinite(samples[i]) ? Math.max(-1, Math.min(1, samples[i])) : 0;
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
  }
  return buffer;
}
