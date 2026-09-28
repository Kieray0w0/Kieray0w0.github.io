// Standard MIDI File types 0/1, PPQ timing. Each channel is exposed separately
// so the singer can choose a melody rather than treating a chord as one pitch.
export function parseMidi(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  let at = 0, events = 0;
  const need = n => { if (at + n > bytes.length) throw new Error('MIDI 文件不完整。'); };
  const u8 = () => { need(1); return bytes[at++]; };
  const u16 = () => { need(2); const n = view.getUint16(at); at += 2; return n; };
  const u32 = () => { need(4); const n = view.getUint32(at); at += 4; return n; };
  const tag = () => String.fromCharCode(u8(), u8(), u8(), u8());
  const vlq = () => {
    let value = 0;
    for (let i = 0; i < 4; i++) { const n = u8(); value = value * 128 + (n & 127); if (!(n & 128)) return value; }
    throw new Error('MIDI 时间编码无效。');
  };
  if (tag() !== 'MThd') throw new Error('不是标准 MIDI 文件。');
  const headerLength = u32(); if (headerLength < 6) throw new Error('MIDI 头部无效。');
  const format = u16(), count = u16(), ppq = u16();
  if (format > 1 || ppq & 0x8000 || !ppq) throw new Error('目前只支持 PPQ 计时的 MIDI 0/1，不支持 SMPTE 或 MIDI 2 格式。');
  if (!count || count > 128 || (format === 0 && count !== 1)) throw new Error('MIDI 声部数量无效或过多。');
  need(headerLength - 6); at += headerLength - 6;
  const tempos = [{ tick: 0, tempo: 500000 }], rawTracks = [];
  let lastTick = 0;
  for (let trackIndex = 0; trackIndex < count; trackIndex++) {
    if (tag() !== 'MTrk') throw new Error('MIDI 音轨标记无效。');
    const length = u32(); need(length); const end = at + length;
    let tick = 0, running = 0, name = `音轨 ${trackIndex + 1}`;
    const notes = [], active = new Map();
    while (at < end) {
      if (++events > 200000) throw new Error('MIDI 事件过多，请仅导出旋律声部。');
      tick += vlq(); if (tick > 1e9) throw new Error('MIDI 时间超出范围。');
      let status = u8();
      if (status < 128) { at--; if (!running) throw new Error('MIDI 运行状态无效。'); status = running; }
      else if (status < 240) running = status;
      if (status === 255) {
        running = 0;
        const type = u8(), size = vlq(); need(size);
        if (type === 3) name = new TextDecoder().decode(bytes.subarray(at, at + Math.min(size, 120))) || name;
        if (type === 81 && size === 3) {
          const tempo = bytes[at] * 65536 + bytes[at + 1] * 256 + bytes[at + 2];
          if (!tempo) throw new Error('MIDI 速度为零。');
          tempos.push({tick,tempo});
        }
        at += size;
        if (type === 47) { if (at > end) throw new Error('MIDI 音轨长度无效。'); at = end; break; }
      } else if (status === 240 || status === 247) {
        running = 0; const size = vlq(); need(size); at += size;
      } else {
        if (status >= 240) throw new Error('不支持的 MIDI 系统事件。');
        const command = status >> 4, channel = status & 15;
        const first = u8(), second = command === 12 || command === 13 ? 0 : u8();
        if (first > 127 || second > 127) throw new Error('MIDI 音符数据无效。');
        const key = channel * 128 + first;
        if (command === 9 && second > 0) {
          if (!active.has(key)) active.set(key, []);
          active.get(key).push({ tick, midi: first, channel });
        } else if (command === 8 || command === 9) {
          const note = active.get(key)?.shift();
          if (note && tick > note.tick) notes.push({ ...note, endTick: tick });
        }
      }
      if (at > end) throw new Error('MIDI 事件越过音轨边界。');
    }
    for (const pending of active.values()) for (const note of pending) if (tick > note.tick) notes.push({ ...note, endTick: tick });
    lastTick = Math.max(lastTick, tick); rawTracks.push({name,notes,trackIndex});
  }
  tempos.sort((a,b)=>a.tick-b.tick);
  const segments = []; let previousTick = 0, seconds = 0, tempo = 500000;
  for (const event of tempos) {
    seconds += (event.tick - previousTick) * tempo / ppq / 1e6;
    segments.push({tick:event.tick,seconds,tempo:event.tempo}); previousTick = event.tick; tempo = event.tempo;
  }
  const timeAt = tick => {
    let low = 0, high = segments.length;
    while (low < high) { const mid = (low + high) >> 1; if (segments[mid].tick <= tick) low = mid + 1; else high = mid; }
    const segment = segments[Math.max(0, low - 1)];
    return segment.seconds + (tick - segment.tick) * segment.tempo / ppq / 1e6;
  };
  const tracks = [];
  for (const track of rawTracks) for (const channel of [...new Set(track.notes.map(n=>n.channel))]) {
    if (channel === 9) continue;
    tracks.push({name:`${track.name} · 通道 ${channel + 1}`, notes:track.notes.filter(n=>n.channel===channel)
      .map(n=>({start:timeAt(n.tick),end:timeAt(n.endTick),midi:n.midi})).sort((a,b)=>a.start-b.start)});
  }
  if (!tracks.length) throw new Error('MIDI 中没有可用旋律音符（打击乐通道不作为音高参考）。');
  const duration = timeAt(lastTick);
  if (duration > 600) throw new Error('MIDI 超过 10 分钟，请先截取需要练习的部分。');
  return {tracks,duration};
}
