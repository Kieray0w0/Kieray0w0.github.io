(() => {
  const sources = {
    codeforces: { id: 'cf', profile: 'https://codeforces.com/profile/' },
    atcoder: { id: 'atc', profile: 'https://atcoder.jp/users/' },
  };
  for (const [platform, { id, profile }] of Object.entries(sources)) {
    const list = document.getElementById(`${id}-ranking-list`);
    const status = document.getElementById(`${id}-ranking-status`);
    if (!list || !status) continue;
    const data = window.RANKINGS_DATA?.platforms?.[platform];
    const rows = data?.rows;
    if (data?.scope !== (platform === 'codeforces' ? 'six-months' : 'active') || !Array.isArray(rows) || rows.length !== 10 || !rows.every(row =>
      row && typeof row.handle === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(row.handle) &&
      Number.isSafeInteger(row.rating) && row.rating > 0 &&
      Number.isSafeInteger(row.rank) && row.rank > 0 &&
      /^#[0-9a-f]{6}$/i.test(row.color) &&
      (row.countryCode === undefined || (typeof row.countryCode === 'string' && /^[A-Z]{2}$/.test(row.countryCode))) &&
      (row.badge === undefined || ['champion', 'gold', 'silver', 'bronze'].includes(row.badge)) &&
      (row.firstLetterBlack === undefined || typeof row.firstLetterBlack === 'boolean'))) {
      status.textContent = '暂无可用快照；请使用本地“刷新数据”，或查看官方榜单。';
      continue;
    }
    const fragment = document.createDocumentFragment();
    for (const row of rows) {
      const item = document.createElement('li');
      const place = document.createElement('span');
      place.className = 'rating-place';
      place.textContent = String(row.rank);
      const link = document.createElement('a');
      link.href = profile + encodeURIComponent(row.handle);
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = row.handle;
      link.style.color = row.color;
      if (platform === 'codeforces' && row.firstLetterBlack) {
        const initial = document.createElement('span');
        initial.className = 'rating-initial';
        initial.textContent = row.handle[0];
        link.replaceChildren(initial, document.createTextNode(row.handle.slice(1)));
      }
      link.title = row.handle;
      const rating = document.createElement('span');
      rating.className = 'rating-value';
      rating.textContent = row.rating;
      let user = link;
      if (platform === 'atcoder' && (row.countryCode || row.badge)) {
        user = document.createElement('span');
        user.className = 'atc-rating-user';
        if (row.countryCode) {
          const flagLink = document.createElement('a');
          flagLink.className = 'atc-country-link';
          flagLink.href = `https://atcoder.jp/ranking?contestType=algo&f.Country=${row.countryCode}`;
          flagLink.target = '_blank';
          flagLink.rel = 'noopener noreferrer';
          flagLink.title = `国家／地区：${row.countryCode}`;
          const flag = document.createElement('img');
          flag.src = `assets/atcoder-rankings/flag/${row.countryCode}.png`;
          flag.alt = row.countryCode;
          flag.width = flag.height = 16;
          flagLink.append(flag);
          user.append(flagLink);
        }
        if (row.badge) {
          const crown = document.createElement('img');
          crown.className = 'atc-rating-crown';
          crown.src = `assets/atcoder-rankings/icon/crown_${row.badge}.png`;
          crown.alt = `AtCoder ${row.badge} crown`;
          crown.title = crown.alt;
          crown.width = crown.height = 16;
          user.append(crown);
        }
        user.append(link);
      }
      item.append(place, user, rating);
      fragment.append(item);
    }
    list.replaceChildren(fragment);
    const stamp = Date.parse(data.updatedAt);
    const date = Number.isFinite(stamp) ? new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).format(stamp) : '时间未知';
    const stale = !Number.isFinite(stamp) || Date.now() - stamp > 86400000;
    status.textContent = `快照 ${date} UTC+8${data.error ? ' · 更新失败，保留上次结果' : stale ? ' · 已超过一天，请刷新' : ' · 非实时'}`;
  }
})();
