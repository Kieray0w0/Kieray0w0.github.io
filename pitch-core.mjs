export const SAMPLE_RATE = 16000;
export const FRAME_SIZE = 1024;
export const HOP_SIZE = 320;
export const MIN_HZ = 65;
export const MAX_HZ = 1100;

// YIN cumulative mean normalized difference, with sub-sample interpolation.
export function detectPitch(samples, offset = 0) {
  if (offset + FRAME_SIZE > samples.length) return null;
  let energy = 0;
  let mean = 0;
  for (let i = 0; i < FRAME_SIZE; i++) mean += samples[offset + i];
  mean /= FRAME_SIZE;
  for (let i = 0; i < FRAME_SIZE; i++) energy += (samples[offset + i] - mean) ** 2;
  if (Math.sqrt(energy / FRAME_SIZE) < 0.008) return null;
  const minLag = Math.floor(SAMPLE_RATE / MAX_HZ);
  const maxLag = Math.ceil(SAMPLE_RATE / MIN_HZ);
  const difference = new Float64Array(maxLag + 2);
  let sum = 0;
  for (let lag = 1; lag <= maxLag + 1; lag++) {
    let value = 0;
    for (let i = 0; i < FRAME_SIZE - maxLag - 1; i++) {
      value += (samples[offset + i] - samples[offset + i + lag]) ** 2;
    }
    sum += value;
    difference[lag] = sum ? value * lag / sum : 1;
  }
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (difference[lag] >= 0.15) continue;
    while (lag < maxLag && difference[lag + 1] < difference[lag]) lag++;
    const left = difference[lag - 1];
    const center = difference[lag];
    const right = difference[lag + 1];
    const denominator = left - 2 * center + right;
    const shift = denominator ? Math.max(-0.5, Math.min(0.5, (left - right) / (2 * denominator))) : 0;
    const hz = SAMPLE_RATE / (lag + shift);
    if (hz < MIN_HZ || hz > MAX_HZ) return null;
    return { hz, midi: 69 + 12 * Math.log2(hz / 440), confidence: 1 - center };
  }
  return null;
}

export function smoothFrames(frames) {
  return frames.map((frame, i) => {
    if (frame.midi === null) return frame;
    const neighbors = frames.slice(Math.max(0, i - 1), i + 2).filter(f => f.midi !== null);
    const values = neighbors.map(f => f.midi).sort((a, b) => a - b);
    return { ...frame, midi: values[Math.floor(values.length / 2)] };
  });
}

export function noteName(midi) {
  const rounded = Math.round(midi);
  return ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][((rounded % 12) + 12) % 12]
    + (Math.floor(rounded / 12) - 1);
}

// Fixed C-major reference: middle C (MIDI 60) is an undotted 1.
export function numberedNote(midi) {
  const note = Math.round(midi);
  const pitchClass = ((note % 12) + 12) % 12;
  return {
    digit: [1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6, 7][pitchClass],
    sharp: [1, 3, 6, 8, 10].includes(pitchClass),
    octave: Math.floor(note / 12) - 5,
  };
}
