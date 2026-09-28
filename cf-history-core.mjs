export const DAY = 86400;
export const dateKey = stamp => new Date((stamp + 8 * 3600) * 1000).toISOString().slice(0, 10);
export const dayEnd = date => Date.parse(`${date}T23:59:59+08:00`) / 1000;

export function rollingHistoryWindow(at, earliest, mode, customDays = 90) {
  let start;
  if (mode === 'custom') {
    if (!Number.isInteger(customDays) || customDays < 1 || customDays > 36500) throw new RangeError('Window must be 1-36500 days');
    start = at - customDays * DAY;
  } else {
    const months = { m1: 1, m3: 3, m6: 6, m12: 12 }[mode];
    if (!Number.isInteger(months)) throw new RangeError('Unknown history window');
    const date = new Date((at + 8 * 3600) * 1000), day = date.getUTCDate();
    date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() - months);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
    start = date.getTime() / 1000 - 8 * 3600;
  }
  start = Math.min(at, Math.max(earliest, start));
  const samples = [start];
  for (let t = dayEnd(dateKey(start)); t < at; t += DAY) if (t > start) samples.push(t);
  if (at > start) samples.push(at);
  return { start, end: at, samples };
}
export function cutoff(stamp) {
  const d = new Date(stamp * 1000), day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 6);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.getTime() / 1000;
}
export function ratingAt(player, at) {
  if (!Array.isArray(player.events) || !Number.isFinite(player.fetchedAt) || at > player.fetchedAt) return null;
  let low = 0, high = player.events.length;
  while (low < high) { const mid = (low + high) >>> 1; if (player.events[mid].at <= at) low = mid + 1; else high = mid; }
  const last = player.events[low - 1];
  return last ? { rating: last.rating, active: last.at >= cutoff(at), event: last } : null;
}
export function standings(players, at, activeOnly = false) {
  const result = players.map(player => ({ player, value: ratingAt(player, at) }))
    .filter(row => row.value && (!activeOnly || row.value.active))
    .sort((a, b) => b.value.rating - a.value.rating || a.player.handle.localeCompare(b.player.handle));
  result.forEach((row, i) => { row.rank = i && row.value.rating === result[i-1].value.rating ? result[i-1].rank : i + 1; });
  return result;
}
export function cfStyle(rating) {
  const color = rating >= 2400 ? '#FF0000' : rating >= 2100 ? '#FF8C00' : rating >= 1900 ? '#AA00AA'
    : rating >= 1600 ? '#0000FF' : rating >= 1400 ? '#03A89E' : rating >= 1200 ? '#008000' : '#808080';
  return { color, black: rating >= 3000 };
}

export function contestChangeTimeline(players) {
  const events = [];
  for (const player of players) {
    for (const event of player.events || []) {
      const before = event.old;
      if (!Number.isFinite(event.at) || event.at < 0 || !Number.isFinite(player.fetchedAt) || event.at > player.fetchedAt ||
          !Number.isInteger(event.contestId) || event.contestId <= 0 || !Number.isFinite(event.rating)) continue;
      events.push({ ...event, handle: player.handle, delta: Number.isFinite(before) ? event.rating - before : null });
    }
  }
  events.sort((a,b)=>a.at-b.at || a.contestId-b.contestId);
  const byContest = new Map(), timeline = [];
  for (let i=0; i<events.length;) {
    const at=events[i].at, ids=new Set();
    while (i<events.length && events[i].at===at) {
      const event=events[i++]; ids.add(event.contestId);
      if (!byContest.has(event.contestId)) byContest.set(event.contestId, {
        contestId:event.contestId, name:event.name || `Contest ${event.contestId}`, changes:new Map(),
      });
      byContest.get(event.contestId).changes.set(event.handle,event.delta);
    }
    const contests=[...ids].map(id=>byContest.get(id)), changes=new Map();
    // Simultaneous divisions form one update batch; never pick one arbitrarily.
    for (const contest of contests) for (const [handle,delta] of contest.changes) {
      const before=changes.has(handle)?changes.get(handle):0;
      changes.set(handle,before===null || delta===null?null:before+delta);
    }
    timeline.push({at,key:`${at}:${[...ids].join(',')}`,
      contests:contests.map(({contestId,name,changes})=>({contestId,name,changes:new Map(changes)})),changes});
  }
  return timeline;
}

export function latestContestAt(timeline, at) {
  let low=0,high=timeline.length;
  while(low<high){const mid=(low+high)>>>1;if(timeline[mid].at<=at)low=mid+1;else high=mid;}
  return timeline[low-1] || null;
}

export function relevantContestTimeline(players, timeline, activeOnly = false, limit = 15) {
  return timeline.flatMap(contest => {
    const before=new Set(standings(players,contest.at-1,activeOnly).slice(0,limit).map(row=>row.player.handle));
    const after=new Set(standings(players,contest.at,activeOnly).slice(0,limit).map(row=>row.player.handle));
    const relevant=contest.contests.filter(round=>[...(round.changes || contest.changes)].some(([handle, delta]) =>
      (before.has(handle) || after.has(handle)) && (delta !== 0 || (after.has(handle) && !before.has(handle)))));
    if(!relevant.length)return [];
    const changes=new Map();
    for(const round of relevant)for(const [handle,delta] of round.changes || contest.changes){
      const previous=changes.has(handle)?changes.get(handle):0;
      changes.set(handle,previous===null || delta===null?null:previous+delta);
    }
    return [{...contest,key:`${contest.at}:${relevant.map(round=>round.contestId).join(',')}`,contests:relevant,changes}];
  });
}

export function activityBoundaries(players) {
  const times=new Set(), cache=new Map();
  for(const player of players) for(const [i,event] of (player.events || []).entries()) {
    if(!Number.isFinite(event.at) || event.at>player.fetchedAt)continue;
    if(!cache.has(event.at)){
      let low=event.at,high=event.at+190*DAY;
      while(low<high){const mid=Math.floor((low+high)/2);if(cutoff(mid)>event.at)high=mid;else low=mid+1;}
      cache.set(event.at,low);
    }
    const expiry=cache.get(event.at);
    if(expiry<=player.fetchedAt && !(player.events[i+1]?.at<=expiry)){times.add(expiry-1);times.add(expiry);}
  }
  return [...times].sort((a,b)=>a-b);
}

export function contestWindowSamples(timeline, start, end) {
  const before = latestContestAt(timeline, start);
  const samples = [before?.at ?? start];
  for (const contest of timeline) if (contest.at > samples[0] && contest.at <= end) samples.push(contest.at);
  if (end > samples.at(-1)) samples.push(end);
  return samples;
}

// Expiry is a leaderboard event, not a rated contest. Same-time exits share
// one unit and merge with a contest if both occur at exactly the same time.
export function leaderboardTimeline(players, contests, activeOnly = false, limit = 15, boundaries = activityBoundaries(players)) {
  if (!activeOnly) return contests;
  const nodes = new Map(contests.map(contest => [contest.at, contest]));
  for (const at of boundaries) {
    const before = standings(players, at - 1, true).slice(0, limit);
    const after = new Set(standings(players, at, true).slice(0, limit).map(row => row.player.handle));
    const exits = before.filter(row => !after.has(row.player.handle) && ratingAt(row.player, at)?.active === false)
      .map(row => row.player.handle);
    if (!exits.length) continue;
    const existing = nodes.get(at);
    nodes.set(at, { ...(existing || { at, key: `exit:${at}`, contests: [], changes: new Map() }), exits });
  }
  return [...nodes.values()].sort((a, b) => a.at - b.at);
}

export function contestMarkers(players, start, end) {
  const contests = new Map();
  for (const player of players) {
    let previous = null;
    for (const event of player.events || []) {
      const before = Number.isFinite(event.old) ? event.old : previous;
      previous = event.rating;
      if (!Number.isFinite(event.at) || event.at < start || event.at > end || event.at > player.fetchedAt ||
          !Number.isFinite(player.fetchedAt) || !Number.isInteger(event.contestId) || event.contestId <= 0 ||
          !Number.isFinite(event.rating) || !Number.isFinite(before) || event.rating === before) continue;
      if (!contests.has(event.contestId)) contests.set(event.contestId, {
        contestId: event.contestId, name: event.name || `Contest ${event.contestId}`, at: event.at, changes: [],
      });
      const contest = contests.get(event.contestId);
      contest.at = Math.max(contest.at, event.at);
      if (!contest.changes.some(change => change.handle === player.handle)) contest.changes.push({ handle: player.handle, delta: event.rating - before });
    }
  }
  return [...contests.values()].sort((a, b) => a.at - b.at || a.contestId - b.contestId);
}

export function visibleRatingBounds(rows, limit = 15) {
  let minimum = Infinity, maximum = -Infinity;
  for (const row of rows.filter(row => !row.exiting).slice(0, limit)) {
    for (const rating of [...(row.history || []), row.value?.rating]) if (Number.isFinite(rating)) {
      minimum = Math.min(minimum, rating);
      maximum = Math.max(maximum, rating);
    }
  }
  if (!Number.isFinite(minimum)) return { low: 2000, high: 3000 };
  const padding = Math.max(50, (maximum - minimum) * .08);
  return { low: Math.floor((minimum - padding) / 100) * 100,
    high: Math.ceil((maximum + padding) / 100) * 100 };
}

export function historyWindowStats(players, start, at) {
  if (!Number.isFinite(start) || !Number.isFinite(at) || at < start) return { record: null, minimum: null };
  const points = [];
  for (const player of players) {
    const baseline = ratingAt(player, start);
    if (baseline) points.push({ at: start, rating: baseline.rating, handle: player.handle, baseline: true });
    for (const event of player.events || []) if (event.at > start && event.at <= at && event.at <= player.fetchedAt && Number.isFinite(event.rating)) {
      points.push({ at: event.at, rating: event.rating, handle: player.handle, baseline: false });
    }
  }
  points.sort((a, b) => a.at - b.at || a.handle.localeCompare(b.handle));
  let record = null, minimum = Infinity;
  for (const point of points) {
    minimum = Math.min(minimum, point.rating);
    if (!record || point.rating > record.rating) record = { rating: point.rating, holders: [point.handle], since: point.at, baseline: point.baseline };
    else if (point.rating === record.rating && !record.holders.includes(point.handle)) record.holders.push(point.handle);
  }
  return { record, minimum: Number.isFinite(minimum) ? minimum : null };
}
