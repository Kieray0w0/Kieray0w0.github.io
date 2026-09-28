import { detectPitch, smoothFrames, SAMPLE_RATE, FRAME_SIZE, HOP_SIZE } from './pitch-core.mjs';

self.onmessage = ({ data: samples }) => {
  try {
    const frames = [];
    const count = Math.max(0, Math.floor((samples.length - FRAME_SIZE) / HOP_SIZE) + 1);
    for (let i = 0; i < count; i++) {
      const result = detectPitch(samples, i * HOP_SIZE);
      frames.push({ time: (i * HOP_SIZE + FRAME_SIZE / 2) / SAMPLE_RATE,
        midi: result?.midi ?? null, confidence: result?.confidence ?? 0 });
      if (i % 50 === 0) self.postMessage({ progress: i / count });
    }
    self.postMessage({ frames: smoothFrames(frames) });
  } catch {
    self.postMessage({ error: '音高分析失败，请换一段较短的清唱音频重试。' });
  }
};
