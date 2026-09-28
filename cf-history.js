import { DAY, dateKey, dayEnd, ratingAt, standings, cfStyle, historyWindowStats, rollingHistoryWindow, visibleRatingBounds, contestChangeTimeline, latestContestAt, relevantContestTimeline, contestWindowSamples, activityBoundaries, leaderboardTimeline } from './cf-history-core.mjs';
import { createRace, contestPosition, createContestScale } from './cf-race.mjs';
import { profileBadge, createSeriesColors } from './cf-profile.mjs';

const $ = id => document.getElementById(id);
const data = window.CF_HISTORY_DATA;
const valid = data?.version === 1 && data.players && Number.isFinite(data.updatedAt) && Number.isFinite(data.startAt);
if (valid) init();
function init() {
  const players = Object.values(data.players).filter(p => (Number.isFinite(p.firstSeen) || Number.isFinite(p.historicalTopTen?.firstAt)) && /^[A-Za-z0-9_.-]{1,64}$/.test(p.handle))
    .map(p => ({ ...p, profile: window.CF_PROFILES_DATA?.players?.[p.handle.toLowerCase()] }));
  if (!players.length) return;
  const startAt = players.reduce((start, p) => (p.events || []).reduce((earliest, event) =>
    Number.isFinite(event.at) && event.at >= 0 && event.at <= p.fetchedAt ? Math.min(earliest, event.at) : earliest, start), data.startAt);
  const colorOverrides = new Map();
  try {
    const saved=JSON.parse(window.localStorage.getItem('cf-history-series-colors-v1'));
    for(const player of players){
      const color=saved?.[player.handle];
      if(typeof color==='string' && /^#[a-f0-9]{6}$/i.test(color))colorOverrides.set(player.handle,color.toLowerCase());
    }
  } catch { /* Custom colors are optional when local storage is unavailable. */ }
  let seriesColors=createSeriesColors(players,Object.fromEntries(colorOverrides));
  let palette = seriesColors.colors();
  const changeTimeline = contestChangeTimeline(players);
  const inactiveTimes=activityBoundaries(players);
  const eventCache=new Map(), legendSwatches=[];
  const changeFor = (contest,handle) => contest?.changes.has(handle) ? contest.changes.get(handle) : 0;
  const shown = new Set(players.map(p => p.handle));
  let days = [], index = 0, timer = null;
  let events=[], ratedEvents=[], ordinalTimeline=[], selectedAt=null, rangeStart=0, previousStart=null, lastWindowStart=null, pausedTarget=false;
  let customWindowDays = 90;
  let windowMode = $('chart-window').value || 'm3';
  const completeFetches=players.filter(p=>p.events?.length && !p.error && Number.isFinite(p.fetchedAt)).map(p=>p.fetchedAt);
  // A backfill can fetch new members later than the existing homepage cohort.
  const end = Math.min(data.updatedAt,...completeFetches);
  let trackingMode = 'auto';
  const maxTopCount = Math.max(10,players.length);
  let topCount = 10;
  let tracked = new Set(standings(players,end).slice(0,topCount).map(row=>row.player.handle));
  try {
    const saved=JSON.parse(window.localStorage.getItem('cf-history-tracking-v1'));
    if(saved && Array.isArray(saved.handles)){
      const known=new Set(players.map(player=>player.handle));
      tracked=new Set(saved.handles.filter(handle=>known.has(handle)));
      trackingMode=saved.mode==='custom'?'custom':'auto';
      if(Number.isInteger(saved.topCount) && saved.topCount>=1 && saved.topCount<=maxTopCount)topCount=saved.topCount;
    }
  } catch { /* Browsers may disable local storage; selection still works. */ }
  let draftTracked = new Set(tracked), poolInactiveTimes = inactiveTimes;
  const trackingInputs = [], legendLabels = [];
  const customTracking = () => trackingMode === 'custom';
  const trackingPool = () => customTracking()?players.filter(player=>tracked.has(player.handle)):players;
  const trackingLimit = () => customTracking()?tracked.size:topCount;
  $('tracking-top-count').value=String(topCount);
  $('tracking-top-count').max=String(maxTopCount);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let raceMode = 'curve';
  const race = createRace({container:$('race-stage'), chart:$('race-shared-chart'), players, colors:palette, reducedMotion:()=>reducedMotion.matches,
    onBarScale:value=>{if(raceMode==='bar')$('race-scale-end').textContent=`${value} / 最近一场变化`;},
    onRecord:record=>{
      for(const key of ['score','holder','age','note'])$('bar-record-'+key).textContent=record[key];
      $('bar-record-holder').title=record.holder;
    }});
  function setRaceMode(mode) {
    raceMode = mode;
    const curve = mode === 'curve';
    $('race-view').setAttribute('data-mode', mode);
    $('race-view').setAttribute('aria-label', curve ? '动态 Rating 曲线榜' : '动态 Rating 条形榜');
    $('race-mode-curve').setAttribute('aria-pressed', String(curve));
    $('race-mode-bar').setAttribute('aria-pressed', String(!curve));
    $('race-scale-start').textContent = 'Rating';
    $('race-scale-start').hidden=curve;
    $('race-scale-end').textContent = curve ? '选手 / Rating / 最近一场变化' : 'Rating / 最近一场变化';
    $('bar-scale-control').hidden=curve;
    $('curve-scale-control').hidden=!curve;
    $('bar-contest-title').hidden=false;
    $('bar-record').hidden=curve;
    $('race-curve-hint').hidden = !curve;
    $('race-bar-hint').hidden = curve;
    $('race-scope').textContent = `当前前 ${topCount} 名 · 掉榜后淡出 · 非历史全球榜`;
    $('race-eyebrow').textContent = `TRACKED PLAYERS / TOP ${topCount}`;
    if(customTracking()){
      $('race-scope').textContent=`自定义 ${tracked.size} 位 · 所选用户组内排名`;
      $('race-eyebrow').textContent='CUSTOM TRACKING';
    }
    $('shared-chart-title').textContent=customTracking()?'自定义追踪用户 Rating 历史曲线':`当前前 ${topCount} 名选手 Rating 历史曲线`;
    $('shared-chart-description').textContent=customTracking()?'显示所有所选用户的历史分数；缺失数据不连接，活跃筛选仍然生效。':`当前前 ${topCount} 名选手共用时间和 Rating 刻度，掉榜后淡出，重回榜单后滑入。`;
  }
  for (const mode of ['curve', 'bar']) $('race-mode-' + mode).addEventListener('click', () => {
    setRaceMode(mode);
    render(Boolean(timer));
  });
  setRaceMode('curve');
  const formatTime = stamp => new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',dateStyle:'short',timeStyle:'short'}).format(stamp*1000);
  $('coverage').textContent = `${dateKey(startAt)} 起回溯 · ${players.length} 位追踪选手`;
  const failed = players.filter(p => p.error || !p.events);
  const missingProfiles = players.filter(p => !p.profile || p.profile.error);
  $('data-status').textContent = `最近更新 ${formatTime(data.updatedAt)} UTC+8 · ${players.length} 位永久追踪 · ${data.snapshots.length} 次主页记录${failed.length ? ` · ${failed.length} 位历史更新失败，缺失时段不推算` : ''}${Date.now()/1000-end>DAY?' · 快照超过一天，请刷新':''}`;
  if (end < data.updatedAt) $('data-status').textContent += ` · 共同历史截止 ${formatTime(end)} UTC+8`;
  if(missingProfiles.length)$('data-status').textContent+=` · ${missingProfiles.length} 位头像／资料未完整加载，保留占位或旧资料`;
  const backfill = data.historicalBackfill;
  if (backfill && Number.isFinite(backfill.from) && Number.isFinite(backfill.through)) {
    const historical = players.filter(p => p.historicalTopTen).length;
    const added = players.filter(p => p.historicalTopTen && !Number.isFinite(p.firstSeen)).length;
    $('backfill-status').hidden = false;
    $('backfill-status').textContent = `历史成员补全：${dateKey(backfill.from)} 至 ${dateKey(backfill.through)}，已扫描 ${backfill.contests} 场比赛，重建出 ${historical} 位曾进入近六个月活跃前十的选手，新增 ${added} 位。按官方公开的比赛 Rating 变化重建，并列第十全部纳入；${backfill.unavailableContests.length} 场未提供 Rating 变化。该时段之外仍未补全；被删除账号、历史改名或官方撤回的数据可能存在缺口。这些记录不会冒充下方的主页实抓快照。`;
    const inaccessible = backfill.inaccessibleContests || [];
    if (inaccessible.length) {
      $('backfill-status').textContent += ` 其中 ${inaccessible.length} 场已核实为“公开接口不可获取”（${inaccessible.map(c => `#${c.id}`).join('、')}），保留缺失标记，不视作 Rating 变化为 0。`;
    }
  }
  for (const [i,p] of players.entries()) {
    const label = document.createElement('label'), input = document.createElement('input'), swatch = document.createElement('i');
    input.type = 'checkbox'; input.checked = true;
    swatch.style.setProperty('--series', palette[i % palette.length]);
    legendSwatches.push(swatch);
    legendLabels.push({label,handle:p.handle});
    label.append(input,swatch,document.createTextNode(p.handle));
    input.addEventListener('change',()=>{ input.checked ? shown.add(p.handle) : shown.delete(p.handle); draw(); });
    $('legend').append(label);
  }
  function saveTracking(){
    try { window.localStorage.setItem('cf-history-tracking-v1',JSON.stringify({mode:trackingMode,handles:[...tracked],topCount})); }
    catch { /* Persistence is optional. */ }
  }
  function showTrackingSelection(){
    const query=$('tracking-search').value.trim().toLowerCase();
    let matches=0;
    for(const {handle,label,input} of trackingInputs){
      input.checked=draftTracked.has(handle);
      label.hidden=!handle.toLowerCase().includes(query);
      if(!label.hidden)matches++;
    }
    $('tracking-no-results').hidden=matches>0;
    $('tracking-count').textContent=`已勾选 ${draftTracked.size} 位 / 本地档案 ${players.length} 位`;
    $('tracking-mode').value=trackingMode;
    $('tracking-picker').hidden=!customTracking();
    $('tracking-summary').textContent=customTracking()?`正在追踪 ${tracked.size} 位用户`:`曲线、条形均显示前 ${topCount} 名`;
    $('tracking-current').textContent=`选中当前前 ${topCount} 名`;
    $('skip-quiet-label').textContent=customTracking()?'过滤不影响所选用户的比赛':`过滤不影响前 ${topCount} 名的比赛`;
    for(const {label,handle} of legendLabels)label.hidden=customTracking()&&!tracked.has(handle);
  }
  // Picker profiles describe the latest cache, independently of the playback date.
  const currentUsers=players.map(player=>{
    const rating=ratingAt(player,player.fetchedAt)?.rating;
    return {player,rating:Number.isFinite(rating)?rating:null};
  }).sort((a,b)=>(b.rating??-Infinity)-(a.rating??-Infinity)||a.player.handle.localeCompare(b.player.handle));
  function pickerText(value,rating,className){
    const node=document.createElement('span'),style=cfStyle(rating);
    node.className=className;node.style.color=style.color;
    if(style.black){
      const initial=document.createElement('span');initial.className='player-initial';initial.textContent=value[0];
      node.append(initial,document.createTextNode(value.slice(1)));
    }else node.textContent=value;
    return node;
  }
  for(const {player,rating} of currentUsers){
    const label=document.createElement('label'),input=document.createElement('input');
    const name=pickerText(player.handle,rating,'tracking-user-name');
    const score=pickerText(rating===null?'暂无':String(rating),rating,'tracking-user-rating');
    label.className='tracking-user';input.type='checkbox';input.setAttribute('data-handle',player.handle);
    name.title=player.handle;score.title=rating===null?'暂无 Rating 数据':`最新缓存 Rating：${rating}`;
    input.setAttribute('aria-label',`${player.handle}，${score.title}`);
    input.addEventListener('change',()=>{input.checked?draftTracked.add(player.handle):draftTracked.delete(player.handle);showTrackingSelection();});
    label.append(input,profileBadge(player),name,score);$('tracking-users').append(label);
    trackingInputs.push({handle:player.handle,label,input});
  }
  $('tracking-search').addEventListener('input',showTrackingSelection);
  function applyTopCount(){
    const value=Number($('tracking-top-count').value);
    const valid=Number.isInteger(value) && value>=1 && value<=maxTopCount;
    $('tracking-top-count').setAttribute('aria-invalid',String(!valid));
    $('tracking-top-error').hidden=valid;
    $('tracking-top-error').textContent=valid?'':`请输入 1 至 ${maxTopCount} 之间的整数。`;
    if(!valid)return false;
    if(value===topCount)return true;
    topCount=value;saveTracking();showTrackingSelection();
    if(!customTracking()){
      eventCache.clear();setRaceMode(raceMode);range(selectedAt);
    }
    return true;
  }
  $('tracking-top-count').addEventListener('change',applyTopCount);
  $('tracking-current').addEventListener('click',()=>{
    if(!applyTopCount())return;
    draftTracked=new Set(standings(players,selectedAt??end,$('active-only').checked).slice(0,topCount).map(row=>row.player.handle));
    showTrackingSelection();
  });
  $('tracking-clear').addEventListener('click',()=>{draftTracked.clear();showTrackingSelection();});
  $('tracking-apply').addEventListener('click',()=>{
    tracked=new Set(draftTracked);trackingMode='custom';eventCache.clear();saveTracking();showTrackingSelection();setRaceMode(raceMode);range(selectedAt);
  });
  $('tracking-mode').addEventListener('change',()=>{
    trackingMode=$('tracking-mode').value==='custom'?'custom':'auto';
    draftTracked=new Set(tracked);saveTracking();showTrackingSelection();setRaceMode(raceMode);range(selectedAt);
  });
  showTrackingSelection();
  for(const player of [...players].sort((a,b)=>a.handle.localeCompare(b.handle))){
    const option=document.createElement('option');option.value=player.handle;option.textContent=player.handle;
    $('series-color-users').append(option);
  }
  $('series-color-user').value=players.find(player=>player.handle.toLowerCase()==='jiangly')?.handle || players[0].handle;
  function selectedColorPlayer(){
    const handle=$('series-color-user').value.trim().toLowerCase();
    return players.find(player=>player.handle.toLowerCase()===handle);
  }
  function showColorSelection(){
    const player=selectedColorPlayer();
    $('series-color-user-error').hidden=Boolean(player);
    $('series-color-user').setAttribute('aria-invalid',String(!player));
    $('series-color-apply').disabled=!player;
    if(!player){$('series-color-reset').disabled=true;$('series-color-status').textContent='输入 ID 或从建议中选择选手';return;}
    const handle=player.handle,index=players.indexOf(player);
    const color=colorOverrides.get(handle) || palette[index];
    $('series-color-picker').value=color;$('series-color-hex').value=color;
    $('series-color-reset').disabled=!colorOverrides.has(handle);
    $('series-color-status').textContent=`${handle} · ${colorOverrides.has(handle)?'自定义颜色':'默认配色'} · 已自定义 ${colorOverrides.size} 位选手`;
    $('series-color-error').hidden=true;$('series-color-hex').setAttribute('aria-invalid','false');
  }
  function applyColors(){
    try { window.localStorage.setItem('cf-history-series-colors-v1',JSON.stringify(Object.fromEntries(colorOverrides))); }
    catch { /* Current-page colors still work without persistence. */ }
    stop();seriesColors=createSeriesColors(players,Object.fromEntries(colorOverrides));render();showColorSelection();
  }
  $('series-color-user').addEventListener('change',showColorSelection);
  $('series-color-user').addEventListener('input',showColorSelection);
  $('series-color-picker').addEventListener('input',()=>{$('series-color-hex').value=$('series-color-picker').value;});
  $('series-color-apply').addEventListener('click',()=>{
    const player=selectedColorPlayer(),color=$('series-color-hex').value.trim();
    if(!player){showColorSelection();return;}
    const invalid=!/^#[a-f0-9]{6}$/i.test(color);
    $('series-color-error').hidden=!invalid;$('series-color-hex').setAttribute('aria-invalid',String(invalid));
    if(invalid)return;
    $('series-color-user').value=player.handle;
    colorOverrides.set(player.handle,color.toLowerCase());applyColors();
  });
  $('series-color-reset').addEventListener('click',()=>{
    const player=selectedColorPlayer();if(!player){showColorSelection();return;}
    $('series-color-user').value=player.handle;colorOverrides.delete(player.handle);applyColors();
  });
  showColorSelection();
  function stop() { timer=null; pausedTarget=false; race.pause(); $('play').textContent='播放'; }
  function range(preserveAt) {
    stop();
    const period = $('period').value;
    const start = period === 'all' ? startAt : Math.max(startAt,end-(Number(period)-1)*DAY);
    rangeStart=start;previousStart=null;
    const pool=trackingPool();
    const key=`${trackingMode}:${trackingLimit()}:${[...tracked].sort().join(',')}:${$('active-only').checked}:${$('skip-quiet').checked}`;
    poolInactiveTimes=customTracking()?activityBoundaries(pool):inactiveTimes;
    if(!eventCache.has(key)){
      const changes=customTracking()?contestChangeTimeline(pool):changeTimeline;
      const contests=$('skip-quiet').checked?relevantContestTimeline(pool,changes,$('active-only').checked,trackingLimit()):changes;
      eventCache.set(key,leaderboardTimeline(pool,contests,$('active-only').checked,trackingLimit(),poolInactiveTimes));
    }
    events=eventCache.get(key);
    ratedEvents=events.filter(event=>event.contests.length);
    ordinalTimeline=events.map(event=>event.at);
    days=[start,...events.filter(event=>event.at>start && event.at<=end).map(event=>event.at)];
    if(days.at(-1)<end)days.push(end);
    selectedAt=Number.isFinite(preserveAt)?Math.max(start,Math.min(end,preserveAt)):end;
    index=Math.max(0,days.findLastIndex(t=>t<=selectedAt));
    $('range-days').textContent=String(Math.ceil((end-start)/DAY)+1);
    $('day-slider').max=String(days.length-1); $('day-slider').disabled=false;
    $('day-picker').min=dateKey(start); $('day-picker').max=dateKey(end); $('day-picker').disabled=false;
    $('play').disabled=!events.some(event=>event.at>start && event.at<=end);
    render();
  }
  function nameLink(handle, rating) {
    const link=document.createElement('a'), style=cfStyle(rating);
    link.href='https://codeforces.com/profile/'+encodeURIComponent(handle); link.target='_blank'; link.rel='noopener noreferrer';
    link.className='player-link'; link.style.color=style.color;
    if(style.black){const initial=document.createElement('span');initial.className='player-initial';initial.textContent=handle[0];link.append(initial,document.createTextNode(handle.slice(1)));}
    else link.textContent=handle;
    return link;
  }
  function chartWindow() {
    const mode = windowMode, at = selectedAt;
    const start=mode==='full'?rangeStart:rollingHistoryWindow(at,startAt,mode,customWindowDays).start;
    let samples=contestWindowSamples(events,Math.min(start,previousStart??start),at);
    if($('active-only').checked)samples=[...new Set([...samples,...poolInactiveTimes.filter(t=>t>=samples[0]&&t<=at)])].sort((a,b)=>a-b);
    const viewport=[contestPosition(ordinalTimeline,start),contestPosition(ordinalTimeline,mode==='full'?end:at)];
    if(viewport[1]<=viewport[0])samples=[at];
    return {start,end:at,samples,timeline:samples,weights:[],mode,
      viewport,
      recordStart:rangeStart};
  }
  function render(animate = false) {
    const at=selectedAt;
    const latestContest = latestContestAt(ratedEvents,at);
    $('change-contest').replaceChildren(document.createTextNode(latestContest ? '变化对应场次：' : '尚无计分比赛，变化为 0。'));
    for (const [i,contest] of (latestContest?.contests || []).entries()) {
      if(i)$('change-contest').append(document.createTextNode(' / '));
      const link=document.createElement('a');link.href=`https://codeforces.com/contest/${contest.contestId}`;
      link.target='_blank';link.rel='noopener noreferrer';link.textContent=contest.name;
      $('change-contest').append(link);
    }
    if(latestContest)$('change-contest').append(document.createTextNode(` · ${dateKey(latestContest.at)} · 未参加该场为 0`));
    const currentEvent=events.find(event=>event.at===at);
    $('bar-contest-title').textContent=currentEvent?.exits?.length && !currentEvent.contests.length
      ? '不活跃选手退出' : latestContest?.contests.map(contest=>contest.name || `Contest ${contest.contestId}`).join(' / ') || '尚无计分比赛';
    $('bar-contest-title').title=$('bar-contest-title').textContent;
    const window = chartWindow();
    $('window-summary').textContent = `图中历史：${dateKey(window.start)} 至 ${dateKey(window.end)}${window.mode === 'full' ? ' · 固定回溯范围' : ' · 随所选日期移动'}`;
    $('race-shared-chart').setAttribute('data-window-start', dateKey(window.start));
    $('race-shared-chart').setAttribute('data-window-end', dateKey(window.end));
    $('day-slider').value=String(index); $('day-picker').value=dateKey(at);
    $('selected-date').textContent=`${dateKey(at)} · 追踪组内排名`;
    const pool=trackingPool();
    const rows=standings(pool,at,$('active-only').checked);
    palette=seriesColors.update(rows.slice(0,trackingLimit()).map(row=>row.player.handle));
    legendSwatches.forEach((swatch,i)=>swatch.style.setProperty('--series',palette[i]));
    const chartRows = $('active-only').checked ? standings(pool, at) : rows;
    const curveHandles = new Set(rows.slice(0, trackingLimit()).map(row => row.player.handle));
    const ranks = new Map(rows.map(row => [row.player.handle, row.rank]));
    for (const row of chartRows) {
      row.exiting = !curveHandles.has(row.player.handle);
      row.exitReason = $('active-only').checked && !row.value.active ? '已不活跃，退出当前榜单' : `已掉出前 ${trackingLimit()} 名`;
      row.rank = ranks.get(row.player.handle);
      row.change = changeFor(latestContest,row.player.handle);
      row.changeKey = latestContest?.key || 'none';
      row.history = window.samples.map(t => {
        const value = ratingAt(row.player, t);
        return value && (!$('active-only').checked || value.active) ? value.rating : null;
      });
    }
    for (const row of rows) Object.assign(row, chartRows.find(candidate => candidate.player.handle === row.player.handle));
    const contests = events.filter(event=>event.at>=Math.min(window.start,previousStart??window.start) && event.at<=at)
      .flatMap(event=>[
        ...event.contests.map(contest=>({...contest,at:event.at,changes:[...(contest.changes || event.changes)].map(([handle,delta])=>({handle,delta}))})),
        ...(event.exits?.length?[{at:event.at,exits:event.exits}]:[]),
      ]);
    const stats = historyWindowStats(pool, window.recordStart, at);
    const bounds = visibleRatingBounds(chartRows.map(row=>{
      const first=ratingAt(row.player,window.start);
      return {...row,history:[first && (!$('active-only').checked || first.active)?first.rating:null,
        ...row.history.filter((_,i)=>window.samples[i]>=window.start)]};
    }),trackingLimit());
    const viewKey = `${trackingMode}:${trackingLimit()}:${[...tracked].sort().join(',')}:${days[0]}:${days.at(-1)}:${window.mode}:${customWindowDays}`;
    race.update(rows,{animate:animate && $('view').value==='race',duration:speed(),continuous:Boolean(timer),onComplete:timer?advance:undefined,mode:raceMode,barScale:$('bar-scale').value==='record'?'record':'current',curveScale:$('curve-scale').value==='current'?'current':'record',displayLimit:trackingLimit(),days:window.samples,timeline:window.timeline,timeWeights:window.weights,ordinalTimeline,viewport:window.viewport,seriesColors:palette,viewKey,chartRows,contests,bounds,record:stats.record});
    lastWindowStart=window.start;if(!timer)previousStart=window.start;
    $('race-date').textContent=dateKey(at).replaceAll('-',' / ');
    $('race-date').dateTime=dateKey(at);
    $('race-empty').hidden=rows.length>0;
    $('race-empty').textContent=customTracking()&&!tracked.size?'请在自定义追踪中勾选用户，并点击“应用选择”。':'该日期没有符合条件的记录。';
    const rangeEvents=events.filter(event=>event.at>=rangeStart && event.at<=end);
    $('race-progress').textContent=ordinalTimeline.length?`${Math.floor(contestPosition(ordinalTimeline,at))+1} · 本范围 ${rangeEvents.filter(event=>event.contests.length).length} 场比赛 / ${rangeEvents.filter(event=>event.exits?.length).length} 次退出`:'暂无有效事件';
    const known=pool.filter(p=>ratingAt(p,at)).length;
    $('ranking-summary').textContent=`${rows.length} 位参与当前排名 / ${pool.length} 位追踪；${pool.length-known} 位尚无该日可靠记录。变化取上方最近计分场次，未参加为 0。此排名不是当时官网全球排名。`;
    $('history-rows').replaceChildren();
    for(const row of rows){
      const tr=document.createElement('tr'), rank=document.createElement('td'), who=document.createElement('td'), score=document.createElement('td'), delta=document.createElement('td'), event=document.createElement('td');
      rank.textContent=String(row.rank).padStart(2,'0'); who.className='history-player';who.append(profileBadge(row.player),nameLink(row.player.handle,row.value.rating));score.textContent=row.value.rating;
      const change=row.change;
      delta.textContent=change===null?'—':change>0?'+'+change:String(change); delta.className=change>0?'gain':change<0?'loss':'';
      const link=document.createElement('a');link.href=`https://codeforces.com/contest/${row.value.event.contestId}`;link.target='_blank';link.rel='noopener noreferrer';link.textContent=row.value.event.name || `Contest ${row.value.event.contestId}`;
      event.append(link,document.createTextNode(` · ${dateKey(row.value.event.at)}${row.value.active?'':' · 非活跃'}`));
      tr.append(rank,who,score,delta,event);$('history-rows').append(tr);
    }
    if($('view').value==='chart')draw();
  }
  function draw(){
    const svg=$('history-chart'), ns='http://www.w3.org/2000/svg';
    svg.replaceChildren();
    function el(tag,attrs,text){const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));if(text!==undefined)e.textContent=text;svg.append(e);return e;}
    el('title',{id:'chart-title'},$('metric').value==='rank'?'追踪组内排名历史曲线（非全球排名）':'追踪选手 Rating 历史曲线');
    el('desc',{id:'chart-description'},'每日阶梯曲线，缺失数据不连接；准确数值可通过日期控件和下方表格读取。');
    const rankMode=$('metric').value==='rank', active=$('active-only').checked;
    const window=chartWindow(), elapsed=window.samples, timeline=window.timeline;
    const pool=trackingPool(),poolHandles=new Set(pool.map(p=>p.handle));
    const ranks=elapsed.map(t=>new Map(standings(pool,t,active).map(r=>[r.player.handle,r.rank])));
    const series=players.map((p,i)=>({p,i,values:elapsed.map((t,j)=>{const v=ratingAt(p,t);return !v || (active&&!v.active)?null:rankMode?ranks[j].get(p.handle):v.rating;})})).filter(s=>poolHandles.has(s.p.handle)&&shown.has(s.p.handle));
    const values=series.flatMap(s=>s.values.filter(Number.isFinite));
    const record=historyWindowStats(pool,window.recordStart,selectedAt).record;
    const high=rankMode?Math.max(2,pool.length):(record?.rating??3000);
    const low=rankMode?1:Math.min(high-1,Math.floor(((values.length?values.reduce((a,b)=>Math.min(a,b),Infinity):2000)-50)/100)*100);
    svg.setAttribute('data-rating-high',rankMode?'':String(high));
    const scale=createContestScale(ordinalTimeline,window.viewport), x=t=>65+(scale(t)-60)/504*950;
    const y=v=>rankMode?25+(v-low)/(high-low)*275:300-(v-low)/(high-low)*275;
    for(let n=0;n<=5;n++){const value=low+(high-low)*n/5,py=y(value);el('line',{x1:65,x2:1015,y1:py,y2:py,class:'chart-grid'});el('text',{x:53,y:py+4,'text-anchor':'end',class:'chart-label'},Math.round(value));}
    for(let n=0;n<=3;n++){const i=Math.round(window.viewport[0]+(window.viewport[1]-window.viewport[0])*n/3),t=ordinalTimeline[i];if(t!==undefined)el('text',{x:x(t),y:325,'text-anchor':n===0?'start':n===3?'end':'middle',class:'chart-label'},String(i+1));}
    const defs=document.createElementNS(ns,'defs'),clip=document.createElementNS(ns,'clipPath'),rect=document.createElementNS(ns,'rect');
    clip.setAttribute('id','comparison-plot');
    for(const [key,value] of Object.entries({x:65,y:20,width:950,height:282}))rect.setAttribute(key,String(value));
    clip.append(rect);defs.append(clip);svg.append(defs);
    for(const {p,i,values:points} of series){
      let path='',previous=false;
      points.forEach((v,j)=>{if(!Number.isFinite(v)){previous=false;return;}
        path+=(previous?` H${x(elapsed[j])} V${y(v)}`:` M${x(elapsed[j])},${y(v)}`);previous=true;});
      const line=el('path',{d:path,fill:'none',stroke:palette[i%palette.length],'stroke-width':shown.size===1?3:1.8,'clip-path':'url(#comparison-plot)'});
      const title=document.createElementNS(ns,'title');title.textContent=p.handle;line.append(title);
      const value=points.at(-1);
      if(Number.isFinite(value))el('circle',{cx:x(selectedAt),cy:y(value),r:3,fill:palette[i%palette.length]});
    }
    el('line',{x1:x(selectedAt),x2:x(selectedAt),y1:20,y2:302,class:'chart-cursor'});
  }
  function changeWindow() {
    const custom = $('chart-window').value === 'custom';
    $('custom-window-control').hidden = !custom;
    const value = Number($('custom-window-days').value);
    const invalid = custom && (!Number.isInteger(value) || value < 1 || value > 36500);
    $('window-error').hidden = !invalid;
    $('custom-window-days').setAttribute('aria-invalid', String(invalid));
    if (invalid) return;
    if (custom) customWindowDays = value;
    windowMode = $('chart-window').value;
    render(Boolean(timer));
  }
  $('chart-window').addEventListener('change',changeWindow);
  $('custom-window-days').addEventListener('input',changeWindow);
  $('custom-window-days').addEventListener('change',changeWindow);
  $('day-slider').addEventListener('input',()=>{stop();index=Number($('day-slider').value);selectedAt=days[index];render(true);});
  $('day-picker').addEventListener('change',()=>{const at=Math.min(end,dayEnd($('day-picker').value));if(Number.isFinite(at)&&at>=rangeStart){stop();selectedAt=at;index=Math.max(0,days.findLastIndex(t=>t<=at));render(true);}});
  $('period').addEventListener('change',()=>range());$('metric').addEventListener('change',draw);$('active-only').addEventListener('change',()=>range(selectedAt));
  $('skip-quiet').addEventListener('change',()=>range(selectedAt));
  function speed(){return (Number($('play-speed').value)||1000)*1.5;}
  function advance(){
    if(!timer)return;
    const next=events.find(event=>event.at>selectedAt && event.at<=end);
    if(!next){stop();return;}
    previousStart=lastWindowStart;selectedAt=next.at;index=days.indexOf(selectedAt);
    render(true);
  }
  function run(resume=false){
    $('play').textContent='暂停';timer=true;
    if(resume)render(true);else advance();
  }
  function togglePlayback(){if($('play').disabled)return;if(timer){stop();pausedTarget=true;return;}const resume=pausedTarget;pausedTarget=false;if(!resume && !events.some(event=>event.at>selectedAt && event.at<=end)){index=0;selectedAt=days[0];render();}run(resume);}
  $('play').addEventListener('click',togglePlayback);
  const playbackSpace=event=>(event.code==='Space'||event.key===' ')&&!event.altKey&&!event.ctrlKey&&!event.metaKey&&!event.isComposing &&
    (event.target===$('play') || event.target===$('day-slider') || !event.target?.closest?.('input,textarea,select,button,a,[contenteditable]:not([contenteditable="false"]),[role="button"]'));
  document.addEventListener('keydown',event=>{
    if(!playbackSpace(event))return;
    event.preventDefault();
    if(!event.repeat)togglePlayback();
  });
  // Suppress the focused button's native Space click as well as page scrolling.
  document.addEventListener('keyup',event=>{if(playbackSpace(event))event.preventDefault();});
  $('play-speed').addEventListener('change',()=>{if(timer){stop();run(true);}});
  $('bar-scale').addEventListener('change',()=>{stop();render();});
  $('curve-scale').addEventListener('change',()=>{stop();render();});
  $('view').addEventListener('change',()=>{
    stop();const chart=$('view').value==='chart';$('race-view').hidden=chart;
    // Move the same controls so comparison mode keeps its date and progress inputs.
    $(chart?'comparison-playback-slot':'race-playback-slot').append($('playback-controls'));
    for(const id of ['chart-view','chart-hint','metric-control','legend'])$(id).hidden=!chart;
    render();
  });
  document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();render();}});
  reducedMotion.addEventListener('change',()=>{stop();render();});
  window.addEventListener('pagehide',()=>{stop();race.destroy();});
  const snapshots=data.snapshots;
  snapshots.forEach((s,i)=>{const option=document.createElement('option');option.value=i;option.textContent=formatTime(s.at);$('snapshot').append(option);});
  function showSnapshot(){const s=snapshots[Number($('snapshot').value)];if(!s)return;$('snapshot-note').textContent=s.scope==='six-months'?'实际主页抓取记录 · 近六个月活跃口径（按官方 Rating 更新时间重建）。':'旧主页实际记录 · 曾使用一个月 API 筛选，仅为追踪来源，不是六个月官网榜单。';$('snapshot-rows').replaceChildren();for(const r of s.rows){const li=document.createElement('li'),rating=document.createElement('span');li.value=r.rank;rating.className='snapshot-rating';rating.textContent=r.rating;const player=players.find(p=>p.handle.toLowerCase()===r.handle.toLowerCase())||{handle:r.handle};li.append(profileBadge(player),nameLink(r.handle,r.rating),rating);$('snapshot-rows').append(li);}}
  if(snapshots.length){$('snapshot').disabled=false;$('snapshot').value=String(snapshots.length-1);showSnapshot();}
  $('snapshot').addEventListener('change',showSnapshot);
  range();
  showColorSelection();
}
