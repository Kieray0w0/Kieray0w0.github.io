const localAsset = value => typeof value === 'string' && /^assets\/cf-profiles\/[a-f0-9]{64}\.(png|jpg|gif|webp)$/.test(value);

// Curated from cached avatars, with distinct defaults where no avatar color is available.
const avatarColors = new Map([
  ['jiangly', '#a65de0'], ['benq', '#75b92c'], ['kevin114514', '#bd8770'],
  ['maroonrk', '#800000'], ['tourist', '#ef5350'], ['zjy2008', '#32b5d2'],
  ['elysion', '#df8f9c'], ['ormlis', '#737d8f'], ['um_nik', '#c29442'],
  ['strapple', '#2485f4'], ['turmax', '#ff9b20'], ['jiangbowen', '#16bca4'], ['heuristica', '#f34fac'],
  ['hos.lyric', '#ff0000'],
]);
const fallbackColors = ['#2485f4', '#16bca4', '#ff9b20', '#f34fac', '#6368ef', '#00a9da', '#ff7040'];

function lab(hex) {
  const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
  const [r,g,b]=rgb, f=v=>v>.008856?Math.cbrt(v):7.787*v+16/116;
  const x=f((r*.4124+g*.3576+b*.1805)/.95047), y=f(r*.2126+g*.7152+b*.0722), z=f((r*.0193+g*.1192+b*.9505)/1.08883);
  return [116*y-16,500*(x-y),200*(y-z)];
}
const colorDistance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const luminance=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
  .map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
  .reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);

export function createSeriesColors(players, overrides = {}) {
  const pinned = new Map([['jiangly','#a65de0'],['maroonrk','#800000'],['hos.lyric','#ff0000']]);
  const fixed = new Map();
  for (const player of players) {
    const override = overrides?.[player.handle];
    const color = typeof override === 'string' && /^#[a-f0-9]{6}$/i.test(override)
      ? override.toLowerCase() : pinned.get(player.handle.toLowerCase());
    if (color) fixed.set(player.handle,color);
  }
  const candidates=[];
  for(let h=0;h<360;h+=3) for(const light of [.3,.4,.5,.6]) {
    const saturation=.8, a=saturation*Math.min(light,1-light);
    const component=n=>{const k=(n+h/30)%12;return light-a*Math.max(-1,Math.min(k-3,9-k,1));};
    const color='#'+[0,8,4].map(n=>Math.round(component(n)*255).toString(16).padStart(2,'0')).join('');
    if(luminance(color)<=.3)candidates.push({color,lab:lab(color)});
  }
  const assigned=new Map(fixed), active=new Set();
  for(const player of [...players].sort((a,b)=>a.handle.localeCompare(b.handle))) {
    if (fixed.has(player.handle)) continue;
    const preferred=profileSeriesColor(player);
    const used=new Set(assigned.values());
    assigned.set(player.handle, !used.has(preferred)?preferred:candidates.find(c=>!used.has(c.color)).color);
  }
  return {
    colors:()=>players.map(player=>assigned.get(player.handle)),
    update(handles) {
      // Reserve explicit colors even while hidden. User-chosen duplicates are
      // intentional; automatic colors must not steal these reserved values.
      const next=new Set(handles), chosen=new Map(fixed);
      const choose=handle=>{
        if(chosen.has(handle))return;
        const preferred=assigned.get(handle), others=[...new Set(chosen.values())].map(lab);
        const separation=color=>others.length?Math.min(...others.map(other=>colorDistance(lab(color),other))):Infinity;
        if(luminance(preferred)<=.3 && separation(preferred)>=30){chosen.set(handle,preferred);return;}
        const preferredLab=lab(preferred);
        const best=candidates.filter(c=>![...chosen.values()].includes(c.color)).reduce((best,c)=>{
          const distance=others.length?Math.min(...others.map(other=>colorDistance(c.lab,other))):100;
          const score=distance-colorDistance(c.lab,preferredLab)*.035;
          return !best || score>best.score?{...c,score}:best;
        },null);
        chosen.set(handle,best.color);
      };
      for(const handle of handles.filter(handle=>active.has(handle)&&!chosen.has(handle)))chosen.set(handle,assigned.get(handle));
      for(const handle of handles)choose(handle);
      // Hidden series must also remain distinct in the manual comparison view.
      const used=new Set(chosen.values());
      for(const player of players) if(!next.has(player.handle) && !fixed.has(player.handle)) {
        let color=assigned.get(player.handle);
        if(used.has(color))color=candidates.find(c=>!used.has(c.color)).color;
        assigned.set(player.handle,color);used.add(color);
      }
      for(const [handle,color] of chosen)assigned.set(handle,color);
      active.clear();for(const handle of handles)active.add(handle);
      return this.colors();
    },
  };
}

export function profileSeriesColor(player) {
  const handle = player.handle.toLowerCase();
  if (avatarColors.has(handle)) return avatarColors.get(handle);
  let hash = 0;
  for (const char of handle) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return fallbackColors[hash % fallbackColors.length];
}

export function profileBadge(player) {
  const badge = document.createElement('span'); badge.className = 'profile-badge';
  const avatar = document.createElement('span'); avatar.className = 'profile-avatar';
  const fallback = document.createElement('span'); fallback.textContent = player.handle.slice(0, 2).toUpperCase();
  avatar.append(fallback);
  const profile = player.profile || {};
  if (localAsset(profile.avatar)) {
    const img = document.createElement('img'); img.src = profile.avatar; img.alt = '';
    img.addEventListener('error', () => { img.hidden = true; });
    avatar.append(img);
  }
  const flag = document.createElement('span'); flag.className = 'profile-flag';
  flag.title = profile.country ? `CF 公开国家／地区：${profile.country}`
    : profile.error && !profile.updatedAt ? '国家／地区资料暂不可用' : 'CF 未填写国家／地区';
  if (localAsset(profile.flag)) {
    const img = document.createElement('img'); img.src = profile.flag; img.alt = profile.country || '国家／地区';
    img.addEventListener('error', () => { img.hidden = true; flag.append(document.createTextNode('?')); });
    flag.append(img);
  } else {
    flag.textContent = profile.country ? '·' : '?';
    flag.setAttribute('role', 'img'); flag.setAttribute('aria-label', flag.title);
  }
  badge.title = `${player.handle} · 当前公开资料${profile.error ? '（更新失败，保留旧资料）' : ''}`;
  badge.append(avatar, flag);
  return badge;
}
