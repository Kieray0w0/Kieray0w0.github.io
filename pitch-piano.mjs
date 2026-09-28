export const PIANO_WHITE_OFFSETS = [0,2,4,5,7,9,11,12];
export const PIANO_ROWS = [
  {id:'high',label:'上排 · 高八度',offset:12,keys:[...'QWERTYUI']},
  {id:'middle',label:'中排',offset:0,keys:[...'ASDFGHJK']},
  {id:'low',label:'下排 · 低八度',offset:-12,keys:[...'ZXCVBNM,']},
];
export function pianoKeyOffset(code, shift = false) {
  for (const row of PIANO_ROWS) {
    const at = row.keys.findIndex(key => code === (key === ',' ? 'Comma' : `Key${key}`));
    if (at < 0) continue;
    const offset = PIANO_WHITE_OFFSETS[at];
    if (shift && ![0,2,5,7,9].includes(offset)) return null;
    return row.offset + offset + (shift ? 1 : 0);
  }
  return null;
}

// Last-note priority keeps the synthesizer compatible with monophonic pitch analysis.
export function createPiano({onKeys, onError}, env = globalThis) {
  const held = new Map(), voices = new Set();
  let audio = null, bus = null, owned = false, ready = null, earliest = 0, voice = null;
  let monitor = null, monitorVolume = 2;
  function updateMonitor() {
    if (monitor) monitor.gain.setTargetAtTime(monitorVolume, audio.currentTime, 0.01);
  }
  const currentNote = () => [...held.values()].at(-1) ?? null;
  const notify = () => onKeys({held:[...new Set(held.values())], active:currentNote()});
  function silence(immediate = false) {
    if (!voice) return;
    const old = voice; voice = null;
    const now = audio.currentTime;
    old.gain.gain.cancelScheduledValues(now);
    old.gain.gain.setTargetAtTime(0, now, 0.006);
    old.oscillator.stop(immediate ? now : now + 0.04);
  }
  function render() {
    if (!audio || audio.state !== 'running') return;
    const note = currentNote();
    if (voice?.note === note) return;
    silence();
    if (note === null) return;
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    const at = Math.max(audio.currentTime, earliest);
    oscillator.type = 'triangle'; oscillator.frequency.value = 440 * 2 ** ((note - 69) / 12);
    gain.gain.value = 0;
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(0.22, at + 0.008);
    gain.gain.setTargetAtTime(0.09, at + 0.008, 0.25);
    oscillator.connect(gain); gain.connect(bus);
    voice = {oscillator, gain, note}; const playing = voice; voices.add(playing);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); voices.delete(playing); };
    oscillator.start(at);
  }
  function allOff() { held.clear(); silence(); notify(); }
  function detach() {
    allOff();
    for (const {oscillator, gain} of voices) {
      oscillator.onended = null;
      try { oscillator.stop(); } catch {}
      oscillator.disconnect(); gain.disconnect();
    }
    voices.clear(); bus?.disconnect(); bus = null;
    monitor?.disconnect(); monitor = null;
    if (owned && audio) { audio.onstatechange = null; void audio.close().catch(() => {}); }
    audio = null; owned = false; ready = null; earliest = 0;
  }
  function connect(context, destinations) {
    audio = context; bus = audio.createGain(); bus.gain.value = 1;
    monitor = audio.createGain(); monitor.gain.value = monitorVolume;
    bus.connect(monitor); monitor.connect(audio.destination);
    // Capture and pitch analysis bypass the listening volume, including mute.
    for (const destination of destinations) bus.connect(destination);
  }
  return {
    setMonitorVolume(value) {
      if (!Number.isFinite(value)) return;
      monitorVolume = Math.max(0, Math.min(4, value));
      updateMonitor();
    },
    async press(token, note) {
      if (held.has(token) || !Number.isInteger(note) || note < 0 || note > 127) return;
      held.set(token, note); notify();
      let context;
      try {
        if (!audio) {
          connect(new env.AudioContext(), []); owned = true;
          audio.onstatechange = () => { if (audio?.state !== 'running') allOff(); };
        }
        context = audio;
        if (context.state !== 'running') {
          ready ??= context.resume().finally(() => { if (audio === context) ready = null; });
          await ready;
        }
        if (audio !== context) return;
        if (context.state !== 'running') throw new Error('Audio unavailable');
        render();
      } catch {
        if (context && audio !== context) return;
        detach(); onError('琴音未能启动，请再次按键或检查浏览器音频权限。');
      }
    },
    release(token) { if (held.delete(token)) { render(); notify(); } },
    allOff,
    attach(context, destinations, when) {
      detach(); connect(context, destinations); earliest = when;
    },
    detach,
    dispose:detach,
  };
}
