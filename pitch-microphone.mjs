import { detectPitch, SAMPLE_RATE, FRAME_SIZE, HOP_SIZE } from './pitch-core.mjs';

// Read the newest analysis window at the detector's sample rate. Some devices
// ignore the requested AudioContext rate; average source samples when downsampling.
export function resampleWindow(input, sourceRate, output = new Float32Array(FRAME_SIZE)) {
  const ratio = sourceRate / SAMPLE_RATE;
  const start = input.length - output.length * ratio;
  if (start < 0 || ratio <= 0) throw new Error('音频采样窗口无效。');
  for (let i = 0; i < output.length; i++) {
    const position = start + i * ratio;
    if (ratio <= 1) {
      const index = Math.floor(position);
      const fraction = position - index;
      output[i] = input[index] * (1 - fraction) + input[Math.min(index + 1, input.length - 1)] * fraction;
    } else {
      const end = Math.min(input.length, position + ratio);
      let sum = 0;
      for (let index = Math.floor(position); index < end; index++) {
        sum += input[index] * (Math.min(index + 1, end) - Math.max(index, position));
      }
      output[i] = sum / (end - position);
    }
  }
  return output;
}

export function microphoneError(error) {
  switch (error.name) {
    case 'NotAllowedError': case 'SecurityError': return '麦克风权限未获允许，请在浏览器站点设置中允许后重试。';
    case 'NotFoundError': return '没有找到麦克风，请连接设备后重试。';
    case 'NotReadableError': return '无法读取麦克风，设备可能被其他程序占用。';
    default: return error.message || '麦克风启动失败，请检查设备后重试。';
  }
}

export function createMicrophone({ onState, onFrame, onError, onTake, onReady }, env = globalThis) {
  let generation = 0;
  let state = 'idle';
  let resources = null;
  const dispose = resource => {
    if (!resource) return;
    env.clearInterval(resource.timer);
    env.clearTimeout(resource.timeout);
    env.clearTimeout(resource.flushTimeout);
    for (const track of resource.stream?.getTracks() || []) { track.onended = null; track.stop(); }
    if (resource.context) {
      resource.context.onstatechange = null;
      resource.source?.disconnect();
      resource.analyser?.disconnect();
      resource.capture?.disconnect();
      if (resource.capture) resource.capture.port.onmessage = null;
      resource.stopReference?.();
      if (resource.context.state !== 'closed') resource.context.close().catch(() => {});
    }
  };
  function stop(reason = 'user') {
    if (state === 'stopping') return resources?.finished;
    if (state === 'idle') return Promise.resolve();
    generation++;
    const previous = state;
    const resource = resources;
    if (resource?.capture && previous === 'live') {
      state = 'stopping'; onState(state, reason);
      env.clearInterval(resource.timer);
      resource.context.onstatechange = null;
      for (const track of resource.stream?.getTracks() || []) { track.onended = null; track.stop(); }
      resource.source.disconnect(); resource.stopReference?.(); resource.stopReference = null;
      resource.finished = new Promise(resolve => { resource.resolve = resolve; });
      resource.finish = () => {
        if (resource.finalized) return;
        resource.finalized = true;
        const length = resource.recordedLength ?? resource.chunks.reduce((max, chunk) => Math.max(max, chunk.offset + chunk.data.length), 0);
        const samples = new Float32Array(length);
        for (const chunk of resource.chunks) samples.set(chunk.data.subarray(0, Math.max(0, length - chunk.offset)), chunk.offset);
        dispose(resource); resources = null; state = 'idle';
        try { onTake({samples,sampleRate:resource.context.sampleRate,complete:resource.recordedLength !== undefined}); }
        catch (error) { onError(error.message || '录音合并失败。'); }
        onState('idle', reason); resource.resolve();
      };
      resource.flushTimeout = env.setTimeout(resource.finish, 1500);
      if (resource.recordedLength !== undefined) resource.finish();
      else resource.capture.port.postMessage({type:'stop'});
      return resource.finished;
    }
    state = 'idle'; resources = null;
    dispose(resource); onState('idle', reason);
    return Promise.resolve();
  }
  async function start({ maxSeconds = 600, input:inputMode = 'microphone' } = {}) {
    if (state !== 'idle') return;
    const current = ++generation;
    const resource = {}; resources = resource;
    state = 'requesting'; onState(state);
    const fail = error => {
      if (current !== generation) return;
      stop('error'); onError(microphoneError(error));
    };
    try {
      const useMicrophone = inputMode !== 'piano';
      if (!env.isSecureContext || (useMicrophone && !env.navigator?.mediaDevices?.getUserMedia)) {
        throw new Error('录音需要 HTTPS 或 localhost，请通过本地服务器或线上网页打开。');
      }
      if (!env.AudioContext) throw new Error('当前浏览器不支持实时音频分析，请使用新版浏览器。');
      resource.timeout = env.setTimeout(() => fail(new Error('录音启动超时，已取消请求；请重新点击开始。')), 30000);
      resource.context = new env.AudioContext({ sampleRate: SAMPLE_RATE });
      const audio = resource.context;
      // Microphone input is never monitored; only the separately attached piano is audible.
      const resumed = audio.resume();
      // getUserMedia may throw synchronously; still handle a rejected resume promise.
      resumed.catch(() => {});
      const permission = useMicrophone ? env.navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      }, video: false }).then(stream => {
        if (current !== generation) { stream.getTracks().forEach(track => track.stop()); return; }
        resource.stream = stream;
        for (const track of stream.getTracks()) track.onended = () => stop('device-ended');
      }) : Promise.resolve();
      await Promise.all([resumed, permission]);
      if (current !== generation) return;
      if (audio.state !== 'running' || (useMicrophone && !resource.stream?.getAudioTracks().some(track => track.readyState === 'live'))) {
        throw new Error('录音输入未就绪，请检查设备并重新点击开始。');
      }
      if (onTake) {
        if (!audio.audioWorklet || !env.AudioWorkletNode) throw new Error('录音需要支持 AudioWorklet 的新版浏览器。');
        await audio.audioWorklet.addModule(new URL('./pitch-capture-worklet.js', import.meta.url));
        if (current !== generation) return;
        resource.capture = new env.AudioWorkletNode(audio, 'pitch-capture');
        resource.chunks = [];
        resource.capture.port.onmessage = ({data}) => {
          if (resources !== resource || resource.finalized) return;
          if (data.type === 'chunk') resource.chunks.push(data);
          if (data.type === 'done') {
            resource.recordedLength = data.length;
            if (state === 'live') stop('limit');
            else if (state === 'stopping') resource.finish();
          }
        };
      }
      resource.source = useMicrophone ? audio.createMediaStreamSource(resource.stream) : audio.createGain();
      resource.analyser = audio.createAnalyser();
      const analyser = resource.analyser;
      analyser.fftSize = Math.max(1024, 2 ** Math.ceil(Math.log2(FRAME_SIZE * audio.sampleRate / SAMPLE_RATE)));
      resource.source.connect(analyser);
      const input = new Float32Array(analyser.fftSize);
      const samples = new Float32Array(FRAME_SIZE);
      const startedAt = audio.currentTime + (onTake ? 0.15 : 0);
      if (resource.capture) {
        resource.source.connect(resource.capture);
        resource.capture.connect(audio.destination);
        resource.capture.port.postMessage({type:'start',at:startedAt,maxSeconds:Math.min(600, Math.max(0, maxSeconds))});
      }
      resource.stopReference = onReady?.({context:audio,when:startedAt,inputDestinations:[analyser,...(resource.capture ? [resource.capture] : [])]});
      let lastTime = -1;
      env.clearTimeout(resource.timeout);
      audio.onstatechange = () => { if (current === generation && audio.state !== 'running') stop('interrupted'); };
      state = 'live'; onState(state);
      resource.timer = env.setInterval(() => {
        if (current !== generation) return;
        try {
          const elapsed = audio.currentTime - startedAt;
          if (elapsed >= Math.min(600, maxSeconds)) { stop('limit'); return; }
          if (elapsed < FRAME_SIZE / SAMPLE_RATE || elapsed - lastTime < HOP_SIZE / SAMPLE_RATE * 0.8) return;
          analyser.getFloatTimeDomainData(input);
          const pitch = detectPitch(resampleWindow(input, audio.sampleRate, samples));
          const time = elapsed - FRAME_SIZE / SAMPLE_RATE / 2;
          lastTime = elapsed;
          onFrame({ time, elapsed, midi: pitch?.midi ?? null, hz: pitch?.hz ?? null, confidence: pitch?.confidence ?? 0 });
        } catch (error) { fail(error); }
      }, HOP_SIZE / SAMPLE_RATE * 1000);
    } catch (error) { fail(error); }
  }
  return { start, stop, get state() { return state; } };
}
