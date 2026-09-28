// Raw mono PCM only; analysis stays off the audio rendering thread.
class PitchCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.active = false; this.position = 0; this.used = 0; this.chunk = new Float32Array(2048);
    this.port.onmessage = ({data}) => {
      if (data.type === 'start') {
        this.startFrame = Math.round(data.at * sampleRate);
        this.maxLength = Math.floor(data.maxSeconds * sampleRate);
        this.active = true;
      } else if (data.type === 'stop') this.finish();
    };
  }
  flush() {
    if (!this.used) return;
    const data = this.chunk.slice(0, this.used);
    this.port.postMessage({type:'chunk',offset:this.position-this.used,data},[data.buffer]);
    this.used = 0;
  }
  finish() {
    this.active = false; this.flush();
    this.port.postMessage({type:'done',length:this.position});
  }
  process(inputs) {
    if (!this.active) return true;
    const channels = inputs[0] || [];
    const length = channels[0]?.length || 128;
    for (let i = 0; i < length; i++) {
      if (currentFrame + i < this.startFrame) continue;
      if (this.position >= this.maxLength) { this.finish(); break; }
      let value = 0;
      for (const channel of channels) value += channel[i] || 0;
      this.chunk[this.used++] = channels.length ? value / channels.length : 0;
      this.position++;
      if (this.used === this.chunk.length) this.flush();
    }
    // Output remains zero: keep capture alive without sending the microphone to speakers.
    return true;
  }
}
registerProcessor('pitch-capture', PitchCaptureProcessor);
