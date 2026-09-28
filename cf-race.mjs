import { cfStyle, dateKey, dayEnd } from './cf-history-core.mjs';
import { profileBadge } from './cf-profile.mjs';

let chartSerial = 0;

function settleCardTint(node) {
  if (!node.flashHolding) return;
  node.flashHolding = false;
  node.flashCard.style.backgroundColor = node.flashBase;
  node.flash = node.flashCard.animate?.([
    { backgroundColor: node.flashColor },
    { backgroundColor: node.flashBase },
  ], { duration: 450, easing: 'ease-out' });
}

function flashCard(node, card, row, at, reduced, base = 'transparent', moving = false) {
  node.flashCard = card; node.flashBase = base;
  const change = row?.change;
  const key = `${row?.changeKey ?? at}:${change}:${row?.value.rating}`;
  if (reduced || !Number.isFinite(change) || change === 0 || row.exiting) {
    node.flash?.cancel(); node.flash = null; node.flashKey = key;
    node.flashHolding = false; card.style.backgroundColor = base;
    return;
  }
  if (node.flashKey === key) {
    if (!moving) settleCardTint(node);
    return;
  }
  node.flashKey = key;
  node.flash?.cancel();
  const color = change > 0 ? '#dceeff' : '#e4e7eb';
  node.flashColor = color;
  node.flashHolding = moving;
  card.style.backgroundColor = moving ? color : base;
  // Holding the base style, rather than a timer, also keeps the tint on pause.
  if (moving) { node.flash = null; return; }
  node.flash = card.animate?.([
    { backgroundColor: color, offset: 0 },
    { backgroundColor: color, offset: .35 },
    { backgroundColor: base, offset: 1 },
  ], { duration: 1800, easing: 'ease-out' });
}

// Keep keyed rows alive while their position and score move to the next daily snapshot.
export function createRace({ container, chart, players, colors, ceiling = 4000, onBarScale = () => {}, onRecord = () => {}, reducedMotion = () => false,
  requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame, now = () => performance.now() }) {
  const nodes = new Map();
  const sharedChart = chart ? createSharedChart(chart, players, colors, onRecord) : null;
  let frame = null;
  let barCeiling = ceiling;
  const hidden = { slot: 10, rating: 0, opacity: 0 };
  for (const [i, player] of players.entries()) {
    const row = document.createElement('div'); row.className = 'race-row';
    row.style.borderLeftColor = colors[i % colors.length];
    const rank = document.createElement('span'); rank.className = 'race-rank';
    const name = document.createElement('span'); name.className = 'race-name'; name.title = player.handle;
    const initial = document.createElement('span'); initial.textContent = player.handle[0];
    name.append(initial, document.createTextNode(player.handle.slice(1)));
    const identity = document.createElement('span'); identity.className = 'race-identity';
    identity.append(profileBadge(player), name);
    const lane = document.createElement('div'); lane.className = 'race-lane';
    const score = document.createElement('span'); score.className = 'race-score';
    const delta = document.createElement('span'); delta.className = 'race-delta';
    const bar = document.createElement('div'); bar.className = 'race-bar';
    bar.style.backgroundColor = colors[i % colors.length];
    lane.append(bar, score, delta); row.append(rank, identity, lane); container.append(row);
    nodes.set(player.handle, { row, rank, name, initial, score, delta, bar, state: { ...hidden } });
  }
  function paint(node, state) {
    node.state = state;
    node.row.style.transform = `translateY(${state.slot * 100}%) translateX(${state.offset || 0}px)`;
    node.row.style.zIndex = state.lift ? '2' : '1';
    node.row.style.filter = state.lift ? `drop-shadow(0 3px 3px rgba(40,65,55,${state.lift * .18}))` : 'none';
    node.row.style.opacity = String(state.opacity);
    node.rank.textContent = state.rank === undefined ? '' : String(state.rank).padStart(2, '0');
    node.score.textContent = String(Math.round(state.rating));
    const width = Math.max(0, Math.min(100, Math.round(state.rating) / Math.max(1,barCeiling) * 100));
    node.bar.style.width = `${width}%`;
    node.score.style.left = `${width}%`;
    node.delta.style.left = `${width}%`;
    const style = cfStyle(Math.round(state.rating));
    node.name.style.color = style.color;
    node.score.style.color = style.color;
    node.score.setAttribute('data-legendary',String(style.black));
    node.initial.style.color = style.black ? '#000000' : style.color;
  }
  function cancel() { if (frame !== null) cancelFrame(frame); frame = null; }
  function update(rows, { animate = false, duration = 700, continuous = false, onComplete, mode = 'bar', barScale = 'fixed', curveScale = 'record', displayLimit, days = [], timeline = days, timeWeights = [], ordinalTimeline, viewport, seriesColors, viewKey, chartRows = rows, contests = [], bounds, record = null } = {}) {
    cancel();
    const limit = displayLimit ?? (mode === 'curve' ? 15 : 10);
    container.style.height = mode === 'curve' ? `${limit * 48}px` : displayLimit !== undefined ? `calc(${Math.max(1,limit)} * var(--race-row-height, 64px))` : '';
    const colorMap=seriesColors?new Map(players.map((player,i)=>[player.handle,seriesColors[i]])):null;
    if(colorMap)for(const [handle,node] of nodes){node.row.style.borderLeftColor=colorMap.get(handle);node.bar.style.backgroundColor=colorMap.get(handle);}
    sharedChart?.update(chartRows, days, { animate: animate && !reducedMotion(), displayLimit, contests, timeline, timeWeights, ordinalTimeline, viewport, colorMap, continuous, viewKey, bounds, record, curveScale, reduced: reducedMotion() });
    const visible = new Map(rows.slice(0, limit).map(row => [row.player.handle, row]));
    for (const [handle, node] of nodes) flashCard(node, node.row, visible.get(handle), days.at(-1), reducedMotion(), 'transparent', animate && !reducedMotion());
    for (const row of rows.slice(0, limit)) {
      const node = nodes.get(row.player.handle);
      if (!node) continue;
      const change = row.change;
      node.delta.textContent = !Number.isFinite(change) ? '—' : change > 0 ? `+${change}` : String(change);
      node.delta.className = `race-delta${change > 0 ? ' gain' : change < 0 ? ' loss' : ''}`;
      node.delta.title = '最近一场计分比赛的 Rating 变化；未参加为 0';
    }
    const targets = new Map(rows.slice(0, limit).map((row, slot) => [row.player.handle, {
      slot, rating: row.value.rating, opacity: 1, rank: row.rank,
    }]));
    const moves = [], staticStates = [];
    function scaleBars(states) {
      const maximum=Math.max(0,...states.filter(state=>state.opacity>0).map(state=>Math.round(state.rating)));
      barCeiling=barScale==='current'?maximum:barScale==='record'?(record?.rating??maximum):ceiling;
      container.setAttribute('data-rating-max',String(barCeiling));
      onBarScale(barCeiling);
    }
    for (const [handle, node] of nodes) {
      const target = { ...(targets.get(handle) || { ...node.state, slot: limit, opacity: 0 }), offset: 0, lift: 0 };
      if (animate && !reducedMotion()) moves.push({ node, from: { ...node.state }, target });
      else staticStates.push({node,state:target});
    }
    scaleBars(moves.length?moves.map(move=>move.from):staticStates.map(item=>item.state));
    for(const {node,state} of staticStates)paint(node,state);
    for(const {node,from} of moves)paint(node,from);
    if (!moves.length) { sharedChart?.paint(1); if(!onComplete)return; }
    const start = now();
    function tick(time) {
      const progress = Math.max(0, Math.min(1, (time - start) / Math.max(1, duration)));
      const eased = progress * progress * (3 - 2 * progress);
      if(moves.length)sharedChart?.paint(continuous ? progress : eased);
      const states=moves.map(({node,from,target})=>{
        const direction = Math.sign(from.slot - target.slot);
        const arc = Math.sin(progress * Math.PI);
        return {node,state:{ slot: from.slot + (target.slot - from.slot) * eased,
          rating: from.rating + (target.rating - from.rating) * eased,
          opacity: from.opacity + (target.opacity - from.opacity) * eased,
          offset: progress === 1 ? 0 : (from.offset || 0) * (1-eased) + direction * 7 * arc,
          lift: progress === 1 ? 0 : direction > 0 ? arc : 0,
          rank: progress < .5 ? from.rank : target.rank }};
      });
      if(states.length)scaleBars(states.map(item=>item.state));
      for(const {node,state} of states)paint(node,state);
      frame = progress < 1 ? requestFrame(tick) : null;
      if(progress===1){
        for (const node of nodes.values()) settleCardTint(node);
        onComplete?.();
      }
    }
    frame = requestFrame(tick);
  }
  return { update, pause:cancel, destroy() {
    cancel();
    for (const node of nodes.values()) { node.flash?.cancel(); node.row.style.backgroundColor = 'transparent'; }
    sharedChart?.destroy();
  } };
}

// All series use the same time origin and rating scale; unknown dates stay gaps.
export function createTimeScale(timeline, weights = []) {
  const positions = [0];
  for (let i = 1; i < timeline.length; i++) positions.push(positions[i - 1] + (timeline[i] - timeline[i - 1]) * (weights[i] || 1));
  const total = positions.at(-1) || 1;
  return at => {
    if (!timeline.length || at <= timeline[0]) return 60;
    if (at >= timeline.at(-1)) return 564;
    let low = 1, high = timeline.length - 1;
    while (low < high) { const mid = (low + high) >>> 1; if (timeline[mid] < at) low = mid + 1; else high = mid; }
    const i = low;
    const elapsed = positions[i - 1] + (at - timeline[i - 1]) * (weights[i] || 1);
    return 60 + elapsed / total * 504;
  };
}

export function contestPosition(timeline, at) {
  if(timeline.length<2 || at<=timeline[0])return 0;
  if(at>=timeline.at(-1))return timeline.length-1;
  let low=1,high=timeline.length-1;
  while(low<high){const mid=(low+high)>>>1;if(timeline[mid]<at)low=mid+1;else high=mid;}
  return low-1+(at-timeline[low-1])/(timeline[low]-timeline[low-1]);
}

export function contestTime(timeline, position) {
  if(!timeline.length)return 0;
  const i=Math.max(0,Math.min(timeline.length-1,Math.floor(position)));
  return timeline[i]+(timeline[Math.min(i+1,timeline.length-1)]-timeline[i])*(position-i);
}

export function createContestScale(timeline, viewport) {
  const start=viewport?.[0] ?? 0, end=viewport?.[1] ?? timeline.length-1;
  if(end<=start)return ()=>564;
  return at=>60+(contestPosition(timeline,at)-start)/(end-start)*504;
}

// Ordinal samples are settled scores at the end of an event's animation unit.
// Its guide belongs halfway through the last half-unit's score transition.
// Keep the real event timestamp for data lookup, record age and descriptions.
export function contestTransitionCenter(timeline, at) {
  const position = contestPosition(timeline, at);
  return position > 0 ? contestTime(timeline, position - .25) : at;
}

export function sharedHistoryGeometry(rows, days, options = {}) {
  const values = rows.flatMap(row => (row.history || []).filter(Number.isFinite));
  const low = options.low ?? Math.floor(((values.length ? values.reduce((a,b)=>Math.min(a,b),Infinity) : 2000) - 50) / 100) * 100;
  const high = options.high ?? Math.ceil(((values.length ? values.reduce((a,b)=>Math.max(a,b),-Infinity) : 3000) + 50) / 100) * 100;
  const timeline = options.timeline || days;
  const timeX = options.timeScale || createTimeScale(timeline, options.timeWeights);
  const until = options.until ?? days.at(-1);
  const x = index => timeX(days[index]);
  const height = options.height ?? Math.max(640, rows.length * 38 + 60);
  const y = value => height - 42 - (value - low) / (high - low) * (height - 122);
  const series = rows.map(row => {
    let path = '', previous = null, end = null, lastKnown = null;
    for (let index = 0; index < Math.min(row.history?.length || 0, days.length); index++) {
      const value = row.history[index], at = days[index];
      if (!Number.isFinite(value)) {
        if (at > until) break;
        previous = null; end = null; continue;
      }
      const to = { x: x(index), y: y(value), rating: value };
      if (!previous) {
        if (at > until) break;
        path += ` M${to.x},${to.y}`; end = to;
      } else {
        const fraction = Math.max(0, Math.min(1, (until - days[index - 1]) / Math.max(1, at - days[index - 1])));
        if (fraction === 0) break;
        const px = Math.max(previous.x, Math.min(to.x, timeX(Math.min(until, at))));
        if (previous.rating === value) {
          path += ` H${px}`; end = { ...to, x: px };
        } else {
          // Hold the old score until the final 50% before this contest. Reveal
          // only this fixed cubic so new contests never refit completed history.
          const startX = previous.x + (to.x - previous.x) * .5;
          path += ` H${Math.min(px, startX)}`;
          if (px <= startX) end = { ...previous, x: px };
          else {
            const span = to.x - startX, dy = to.y - previous.y;
            const f = transitionParameter((px - startX) / span), shoulder = .4;
            const py = previous.y + dy * f * f * (3 - 2 * f);
            path += ` C${startX + span * shoulder * f},${previous.y} ${startX + span * (2 * shoulder * f + (1 - 3 * shoulder) * f * f)},${previous.y + dy * f * f} ${px},${py}`;
            end = { x: px, y: py, rating: previous.rating + (value - previous.rating) * f * f * (3 - 2 * f) };
          }
        }
        if (fraction < 1) { lastKnown = end; break; }
      }
      lastKnown = end; previous = to;
    }
    return { handle: row.player.handle, path, end: row.exiting ? lastKnown : end };
  });
  return { low, high, height, series,
    ticks: Array.from({ length: 6 }, (_, i) => { const value = low + (high - low) * i / 5; return { value, y: y(value) }; }),
    dates: [...new Set([0, Math.floor((timeline.length - 1) / 2), timeline.length - 1])].filter(i => i >= 0 && timeline.length).map(i => ({ x: timeX(timeline[i]), at: timeline[i] })) };
}

// Invert the local S-curve's x coordinate to keep playback time exact.
export function transitionParameter(fraction) {
  if (fraction <= 0 || fraction >= 1) return Math.max(0, Math.min(1, fraction));
  let low = 0, high = 1;
  for (let i = 0; i < 32; i++) {
    const t = (low + high) / 2, x = 3 * .4 * t * (1 - t) ** 2 + 3 * .6 * t * t * (1 - t) + t ** 3;
    if (x < fraction) low = t; else high = t;
  }
  return (low + high) / 2;
}

export function endpointLabels(series, height = 640) {
  const labels = series.filter(s => s.end).map(s => ({ handle: s.handle, x: s.end.x + 22, y: s.end.y }))
    .sort((a, b) => a.y - b.y || a.handle.localeCompare(b.handle));
  for (let i = 0; i < labels.length; i++) labels[i].y = Math.max(labels[i].y, i ? labels[i - 1].y + 38 : 22);
  for (let i = labels.length - 1; i >= 0; i--) labels[i].y = Math.min(labels[i].y, i === labels.length - 1 ? height - 30 : labels[i + 1].y - 38);
  return labels;
}

function createSharedChart(svg, players, colors, onRecord) {
  const ns = 'http://www.w3.org/2000/svg';
  function el(tag, attrs = {}, text) {
    const node = document.createElementNS(ns, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    if (text !== undefined) node.textContent = text;
    return node;
  }
  const grid = el('g'), curves = el('g'), paths = new Map();
  const clipId = `rating-plot-${++chartSerial}`, defs = el('defs');
  const clip = el('clipPath', { id: clipId });
  const clipRect = el('rect', { x: 60, y: 80, width: 504, height: 518 });
  clip.append(clipRect);
  defs.append(clip);
  function layoutLabels(geometry, rows) {
    const exiting = new Set(rows.filter(row => row.exiting).map(row => row.player.handle));
    const labels = new Map(endpointLabels(geometry.series.filter(series => !exiting.has(series.handle)), geometry.height)
      .map(label => [label.handle, label]));
    // Outgoing labels fade in place rather than displacing the incoming top 15.
    for (const series of geometry.series) if (exiting.has(series.handle) && series.end) {
      labels.set(series.handle, paths.get(series.handle)?.position || { x: series.end.x + 22, y: series.end.y });
    }
    return labels;
  }
  const contestLayer = el('g', { class: 'contest-markers' });
  const recordBox = el('foreignObject', { x: 586, y: 4, width: 260, height: 56, class: 'history-record' });
  const recordContent = document.createElement('div'); recordContent.className = 'history-record-content';
  const recordPeak = document.createElement('div'); recordPeak.className = 'history-record-peak';
  const recordLabel = document.createElement('span'); recordLabel.textContent = '本段历史最高';
  const recordScore = document.createElement('strong');
  recordPeak.append(recordLabel, recordScore);
  const recordDetails = document.createElement('div'); recordDetails.className = 'history-record-details';
  const recordTitle = document.createElement('strong'), recordAge = document.createElement('span'), recordNote = document.createElement('small');
  recordDetails.append(recordTitle, recordAge, recordNote);
  recordContent.append(recordPeak, recordDetails); recordBox.append(recordContent);
  let moves = [], scene = null, currentBounds = null, currentAt = null, currentKey = null, lastProgress = 1, currentRecord = null, tickNodes = [];
  let currentViewport=null, movingAxis=[];
  let activeHandles = new Set();
  svg.append(grid, curves, defs);
  for (const [index, player] of players.entries()) {
    const group = el('g'), color = colors[index % colors.length];
    const path = el('path', { fill: 'none', stroke: color, 'stroke-width': 2.5, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round', 'clip-path': `url(#${clipId})` });
    const dot = el('circle', { r: 4, fill: color, stroke: '#fff', 'stroke-width': 1.5, 'clip-path': `url(#${clipId})` });
    const connector = el('path', { fill: 'none', stroke: color, 'stroke-width': 1.2, 'stroke-opacity': .6 });
    const label = el('foreignObject', { width: 260, height: 36, class: 'curve-end-label' });
    const content = document.createElement('div'); content.className = 'curve-end-identity';
    const name = document.createElement('span'); name.className = 'curve-end-name'; name.title = player.handle;
    const initial = document.createElement('span'); initial.textContent = player.handle[0];
    name.append(initial, document.createTextNode(player.handle.slice(1)));
    const score = document.createElement('span'); score.className = 'curve-end-score';
    const delta = document.createElement('span');
    content.append(profileBadge(player), name, score, delta); label.append(content);
    group.append(el('title', {}, player.handle), path, dot, connector, label); curves.append(group);
    paths.set(player.handle, { group, path, dot, connector, label, content, name, initial, score, delta, position: null, opacity: 0 });
  }
  return { paint(progress) {
    if (!scene) return;
    lastProgress = progress;
    currentBounds = { low: scene.fromBounds.low + (scene.bounds.low - scene.fromBounds.low) * progress,
      high: scene.fromBounds.high + (scene.bounds.high - scene.fromBounds.high) * progress };
    currentAt = scene.fromAt + (scene.at - scene.fromAt) * progress;
    let timeScale;
    if(scene.ordinalTimeline?.length){
      const a=contestPosition(scene.ordinalTimeline,scene.fromAt), b=contestPosition(scene.ordinalTimeline,scene.at);
      currentAt=progress===1?scene.at:contestTime(scene.ordinalTimeline,a+(b-a)*progress);
      currentViewport=scene.viewport.map((v,i)=>scene.fromViewport[i]+(v-scene.fromViewport[i])*progress);
      timeScale=createContestScale(scene.ordinalTimeline,currentViewport);
      svg.setAttribute('data-viewport-start',currentViewport[0]);svg.setAttribute('data-viewport-end',currentViewport[1]);
      for(const item of movingAxis){
        const x=timeScale(item.at), visible=x>=60 && x<=564 && item.at<=currentAt;
        item.node.setAttribute('opacity',visible?'1':'0');
        if(item.line){item.node.setAttribute('x1',x);item.node.setAttribute('x2',x);}
        else item.node.setAttribute('x',item.caption?Math.min(x,520):x);
      }
    }
    const geometryOptions = { timeline: scene.timeline, timeWeights: scene.timeWeights, timeScale, height: scene.height, until: currentAt };
    let geometry = sharedHistoryGeometry(scene.rows, scene.days, { ...currentBounds, ...geometryOptions });
    const breaking = progress < 1 && scene.fromRecord && scene.record?.rating > scene.fromRecord.rating && currentAt < scene.record.since;
    currentRecord = scene.record;
    if (breaking) {
      const livePeak = Math.min(scene.record.rating, Math.max(scene.fromRecord.rating,
        ...geometry.series.map(series => series.end?.rating ?? -Infinity)));
      currentRecord = livePeak > scene.fromRecord.rating
        ? { ...scene.record, rating: Math.round(livePeak) } : scene.fromRecord;
    }
    const currentPeak=geometry.series.filter(series=>scene.rows.some(row=>row.player.handle===series.handle&&!row.exiting))
      .reduce((peak,series)=>Math.max(peak,series.end?.rating??-Infinity),-Infinity);
    const upper=scene.curveScale==='current'?currentPeak:currentRecord?.rating;
    if (Number.isFinite(upper)) {
      currentBounds.high = upper;
      currentBounds.low = Math.min(currentBounds.low, currentBounds.high - 1);
      geometry = sharedHistoryGeometry(scene.rows, scene.days, { ...currentBounds, ...geometryOptions });
    }
    svg.setAttribute('data-rating-high', currentBounds.high);
    svg.setAttribute('data-rating-low', currentBounds.low);
    svg.setAttribute('data-current-at', currentAt);
    for (let i = 0; i < tickNodes.length; i++) tickNodes[i].textContent = String(Math.round(currentBounds.low + (currentBounds.high - currentBounds.low) * i / 5));
    const seriesByHandle = new Map(geometry.series.map(series => [series.handle, series]));
    const labels = layoutLabels(geometry, scene.rows);
    // Resolve only the current sample interval. A future contest must not keep
    // an already-completed exchange suspended at a whole-playback offset.
    const nextIndex = scene.days.findIndex(at => at >= currentAt);
    let labelFrom, labelTo, labelProgress = 1;
    const ratingY = rating => scene.height - 42 - (rating - currentBounds.low) /
      (currentBounds.high - currentBounds.low) * (scene.height - 122);
    if (nextIndex > 0) {
      const scale = timeScale || createTimeScale(scene.timeline, scene.timeWeights);
      const left = scale(scene.days[nextIndex - 1]), right = scale(scene.days[nextIndex]);
      const fraction = right > left ? (scale(currentAt) - left) / (right - left) : 1;
      const t = transitionParameter((fraction - .5) * 2);
      labelProgress = t * t * (3 - 2 * t);
      const snapshot = index => ({height: scene.height, series: scene.rows.map(row => {
        const rating = row.history?.[index];
        return {handle: row.player.handle, end: Number.isFinite(rating)
          ? {x: scale(scene.days[index]), y: ratingY(rating), rating} : null};
      })});
      labelFrom = layoutLabels(snapshot(nextIndex - 1), scene.rows);
      labelTo = layoutLabels(snapshot(nextIndex), scene.rows);
    }
    if (currentRecord) {
      const ageAt = breaking ? Math.min(currentAt, scene.record.since) : currentAt;
      const hours = Math.max(0, Math.floor((ageAt - currentRecord.since) / 3600));
      recordScore.textContent = String(currentRecord.rating);
      recordTitle.textContent = currentRecord.holders.join(' / ');
      recordTitle.title = recordTitle.textContent;
      recordAge.textContent = `已保持 ${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
      recordNote.textContent = breaking ? '新纪录形成中' : `${dateKey(currentRecord.since)}${currentRecord.baseline ? ' 首日基准' : ' 起'}`;
    } else {
      recordScore.textContent = '—';
      recordTitle.textContent = '暂无历史纪录'; recordTitle.title = ''; recordAge.textContent = ''; recordNote.textContent = '';
    }
    onRecord({score:recordScore.textContent,holder:recordTitle.textContent,age:recordAge.textContent,note:recordNote.textContent});
    const membershipProgress = progress * progress * (3 - 2 * progress);
    let reflowProgress = membershipProgress;
    if (scene.reflowInterval) {
      const scale = timeScale || createTimeScale(scene.timeline, scene.timeWeights);
      const [start, finish] = scene.reflowInterval.map(scale);
      if (finish > start) {
        const phase = at => {
          const t = transitionParameter(((scale(at) - start) / (finish - start) - .5) * 2);
          return t * t * (3 - 2 * t);
        };
        const initial = phase(scene.fromAt);
        reflowProgress = initial < 1 ? Math.max(0, Math.min(1, (phase(currentAt) - initial) / (1 - initial))) : membershipProgress;
      }
    }
    for (const move of moves) {
      const { node, handle, fromOpacity, opacity, row, entering, entryY, entryTarget, reflow, previousY } = move;
      const series = seriesByHandle.get(handle), end = series?.end;
      const target = labels.get(handle) || (entering ? entryTarget : null);
      node.path.setAttribute('d', series?.path || '');
      node.dot.setAttribute('opacity', end ? '1' : '0');
      node.dot.setAttribute('cx', end?.x ?? 0); node.dot.setAttribute('cy', end?.y ?? 0);
      node.label.setAttribute('opacity', target ? '1' : '0'); node.connector.setAttribute('opacity', target && end ? '1' : '0');
      node.opacity = fromOpacity + (opacity - fromOpacity) * progress;
      node.group.setAttribute('opacity', String(node.opacity));
      node.group.setAttribute('pointer-events', node.opacity === 0 ? 'none' : 'auto');
      node.group.setAttribute('aria-hidden', String(node.opacity === 0));
      if (!target) continue;
      const x = target.x;
      const from = labelFrom?.get(handle), to = labelTo?.get(handle);
      let y = !row.exiting && end && from && to
        ? end.y + (from.y - ratingY(row.history[nextIndex - 1])) * (1 - labelProgress)
          + (to.y - ratingY(row.history[nextIndex])) * labelProgress
        : target.y;
      if (entering) y = entryY + (entryTarget.y - entryY) * membershipProgress;
      else if (reflow && previousY !== undefined) {
        // Reflow only near this event, not across its preceding plateau.
        // Normalize from the current phase so resuming never jumps backward.
        move.reflowOffset ??= previousY - y;
        y += move.reflowOffset * (1 - reflowProgress);
      }
      node.entering = entering && progress < 1;
      node.reflow = reflow && progress < 1;
      node.position = { x, y };
      const displayedRating = Math.round(end?.rating ?? row.value.rating);
      node.score.textContent = String(displayedRating);
      const style = cfStyle(displayedRating);
      node.name.style.color = style.color;
      node.score.style.color = style.color;
      node.score.setAttribute('data-legendary',String(style.black));
      node.initial.style.color = style.black ? '#000000' : style.color;
      node.label.setAttribute('x', x); node.label.setAttribute('y', y - 18);
      node.connector.setAttribute('d', end ? `M${end.x},${end.y} C${end.x + 10},${end.y} ${x - 10},${y} ${x - 3},${y}` : '');
    }
    if (progress === 1) for (const node of paths.values()) settleCardTint(node);
  }, update(rows, days, { animate = false, displayLimit, contests = [], timeline = days, timeWeights = [], ordinalTimeline, viewport, colorMap, continuous = false, viewKey, bounds, record = null, curveScale = 'record', reduced = false } = {}) {
    if(colorMap)for(const [handle,node] of paths){const color=colorMap.get(handle);node.path.setAttribute('stroke',color);node.dot.setAttribute('fill',color);node.connector.setAttribute('stroke',color);}
    const leaders = new Set(rows.filter(row => !row.exiting).slice(0, displayLimit ?? 15).map(row => row.player.handle));
    const membershipChanged = leaders.size !== activeHandles.size || [...leaders].some(handle => !activeHandles.has(handle));
    activeHandles = leaders;
    const limitedRows = rows.map(row => leaders.has(row.player.handle) || row.exiting ? row
      : { ...row, exiting: true, exitReason: `已掉出前 ${displayLimit ?? 15} 名` });
    const visibleRows = limitedRows.filter(row => !row.exiting || (animate && paths.get(row.player.handle)?.opacity > 0));
    const height = Math.max(640, (displayLimit ?? 15) * 38 + 60);
    clipRect.setAttribute('height',height-122);
    const timeX = ordinalTimeline?.length ? createContestScale(ordinalTimeline,viewport) : createTimeScale(timeline, timeWeights);
    const upper=curveScale==='current'?Math.max(...visibleRows.filter(row=>!row.exiting).map(row=>row.value.rating)):record?.rating;
    const recordBounds = Number.isFinite(upper) ? { ...bounds, high: upper,
      ...(Number.isFinite(bounds?.low) ? {low: Math.min(bounds.low,upper-1)} : {}) } : bounds;
    const geometry = sharedHistoryGeometry(visibleRows, days, { ...recordBounds, timeline, timeWeights, timeScale:timeX, height });
    const key = viewKey || `${timeline[0]}:${timeline.at(-1)}:${timeline.length}:${timeWeights.join(',')}`;
    const at = days.at(-1) ?? 0;
    const sameRange = currentKey === key;
    const forward = sameRange && currentAt !== null && at > currentAt;
    const fromAt = animate && forward ? (continuous || lastProgress < 1 ? currentAt : Math.max(currentAt, days.at(-2) ?? currentAt)) : at;
    const reflowIndex = days.findIndex(day => day > fromAt);
    scene = { rows: visibleRows, days, timeline, timeWeights, ordinalTimeline, viewport,
      reflowInterval: fromAt < at && reflowIndex > 0 ? [days[reflowIndex - 1], days[reflowIndex]] : null,
      fromViewport:animate && sameRange && currentViewport?currentViewport:viewport, height, at, fromAt,
      bounds: { low: geometry.low, high: geometry.high },
      fromBounds: animate && sameRange && currentBounds ? { ...currentBounds } : { low: geometry.low, high: geometry.high },
      record, curveScale, fromRecord: forward ? currentRecord : record };
    currentKey = key;
    svg.setAttribute('viewBox', `0 0 860 ${geometry.height}`);
    const labels = layoutLabels(geometry, visibleRows);
    const scores = new Map(visibleRows.map(row => [row.player.handle, row]));
    for (const [handle, node] of paths) flashCard(node, node.content, scores.get(handle), at, reduced, '#fffdf7e8', animate);
    moves = [];
    grid.replaceChildren();
    contestLayer.replaceChildren();
    movingAxis=[];
    contestLayer.setAttribute('class', contests.length > 40 ? 'contest-markers dense' : 'contest-markers');
    grid.append(contestLayer);
    const lastCaptionX = [-Infinity, -Infinity, -Infinity];
    for (const [index, contest] of contests.entries()) {
      if (!days.length) continue;
      // The ordinal guide identifies the transition, not its settled endpoint.
      const at = ordinalTimeline?.length ? contestTransitionCenter(ordinalTimeline, contest.at)
        : Math.min(days.at(-1), Math.max(timeline[0], dayEnd(dateKey(contest.at))));
      const x = timeX(at);
      const captionX = Math.min(x, 520), lane = index % 3, showCaption = captionX - lastCaptionX[lane] >= 44;
      if (showCaption) lastCaptionX[lane] = captionX;
      const title = contest.exits ? `${contest.exits.join(' / ')} · 不活跃退出 ${dateKey(contest.at)}`
        : `${contest.name} · Rating 更新 ${dateKey(contest.at)}\n${contest.changes.map(change => `${change.handle} ${change.delta > 0 ? '+' : ''}${change.delta}`).join(' · ')}`;
      const link = contest.exits ? el('g', { class: 'contest-marker exit-marker', role: 'img', 'aria-label': title })
        : el('a', { href: `https://codeforces.com/contest/${contest.contestId}`, target: '_blank', rel: 'noopener noreferrer', class: 'contest-marker', 'aria-label': title });
      link.append(el('title', {}, title), el('line', { x1: x, x2: x, y1: 68, y2: geometry.height - 42 }),
        el('line', { x1: x, x2: x, y1: 68, y2: geometry.height - 42, class: 'contest-marker-hit' }),
        el('text', { x: captionX, y: 28 + lane * 16, 'text-anchor': 'start', opacity: showCaption ? '1' : '0', class: showCaption ? '' : 'crowded-caption' }, contest.exits ? '退出' : `#${contest.contestId}`));
      contestLayer.append(link);
      if(ordinalTimeline?.length){
        movingAxis.push({node:link.children[1],at,line:true},{node:link.children[2],at,line:true});
        if(showCaption)movingAxis.push({node:link.children[3],at,caption:true});
      }
    }
    grid.append(el('text', { x: 12, y: 16, class: 'chart-label' }, 'Rating'));
    tickNodes = [];
    for (const tick of geometry.ticks) {
      const tickLabel = el('text', { x: 50, y: tick.y + 4, 'text-anchor': 'end', class: 'chart-label' }, Math.round(tick.value));
      tickNodes.push(tickLabel);
      grid.append(el('line', { x1: 60, x2: 564, y1: tick.y, y2: tick.y, class: 'chart-grid' }),
        tickLabel);
    }
    grid.append(recordBox);
    if(ordinalTimeline?.length){
      const first=Math.max(0,Math.ceil(Math.min(scene.fromViewport?.[0]??viewport[0],viewport[0]))),last=Math.min(ordinalTimeline.length-1,Math.floor(viewport[1]));
      const stride=Math.max(1,Math.ceil((last-first)/4));
      for(let i=first;i<=last;i+=stride){
        const at=contestTransitionCenter(ordinalTimeline,ordinalTimeline[i]),label=el('text',{x:timeX(at),y:geometry.height-15,'text-anchor':'middle',class:'chart-label'},String(i+1));
        label.append(el('title',{},dateKey(ordinalTimeline[i])));grid.append(label);movingAxis.push({node:label,at});
      }
    }else for (const date of geometry.dates) grid.append(el('text', { x: date.x, y: geometry.height - 15, 'text-anchor': date.x === 60 ? 'start' : date.x === 564 ? 'end' : 'middle', class: 'chart-label' }, dateKey(date.at)));
    for (const [handle, node] of paths) if (!scores.has(handle)) {
      node.opacity = 0; node.group.setAttribute('opacity', '0'); node.group.setAttribute('pointer-events', 'none'); node.group.setAttribute('aria-hidden', 'true');
    }
    for (const series of geometry.series) {
      const node = paths.get(series.handle);
      if (!node) continue;
      node.path.setAttribute('d', series.path);
      node.dot.setAttribute('opacity', series.end ? '1' : '0');
      node.dot.setAttribute('cx', series.end?.x ?? 0); node.dot.setAttribute('cy', series.end?.y ?? 0);
      const target = labels.get(series.handle), row = scores.get(series.handle);
      node.label.setAttribute('opacity', target ? '1' : '0'); node.connector.setAttribute('opacity', target ? '1' : '0');
      const opacity = row.exiting ? 0 : 1;
      const fromOpacity = animate ? node.opacity : opacity;
      const entering = Boolean(animate && !row.exiting && target && (node.opacity === 0 || node.entering));
      moves.push({ node, handle: series.handle, fromOpacity, opacity, row, entering,
        entryY: node.opacity > 0 && node.position ? node.position.y : height + 18,
        entryTarget: target,
        reflow: Boolean(animate && !row.exiting && !entering && node.opacity > 0 && (membershipChanged || node.reflow)),
        previousY: node.position?.y,
      });
      node.group.setAttribute('opacity', String(fromOpacity));
      if (!target) continue;
      node.delta.textContent = !Number.isFinite(row.change) ? '—' : row.change > 0 ? `+${row.change}` : String(row.change);
      node.delta.className = row.change > 0 ? 'gain' : row.change < 0 ? 'loss' : '';
      node.delta.title = '最近一场计分比赛的 Rating 变化；未参加为 0';
      node.name.title = row.exiting ? `${series.handle} · ${row.exitReason || '已不活跃，退出当前榜单'}` : `${series.handle} · 组内第 ${row.rank} 名`;
    }
    this.paint(animate ? 0 : 1);
  }, destroy() {
    for (const node of paths.values()) { node.flash?.cancel(); node.content.style.backgroundColor = '#fffdf7e8'; }
  } };
}

export function nextRaceIndex(days, index, getRows, skipQuiet, limit = 10) {
  if (!skipQuiet) return Math.min(index + 1, days.length - 1);
  const signature = rows => JSON.stringify(rows.slice(0, limit).map(row => [row.player.handle, row.value.rating, row.rank, row.change]));
  const current = signature(getRows(days[index]));
  for (let i = index + 1; i < days.length; i++) if (signature(getRows(days[i])) !== current) return i;
  return days.length - 1;
}
