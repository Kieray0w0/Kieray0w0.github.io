"use strict";

(() => {
  const platforms = { codeforces: "Codeforces", atcoder: "AtCoder", nowcoder: "牛客竞赛" };
  const hosts = { codeforces: "codeforces.com", atcoder: "atcoder.jp", nowcoder: "ac.nowcoder.com" };
  const day = 86400000;
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const clockDateFormatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric", weekday: "long",
  });
  const clockTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const lunarFormatter = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric",
  });
  const lunarDays = ["", "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十", "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十", "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十"];
  const filter = document.querySelector("#platform-filter");
  const status = document.querySelector("#data-status");
  const clock = document.querySelector("#live-clock");
  const clockDate = clock.querySelector(".clock-date");
  const clockTime = clock.querySelector(".clock-time");
  const clockLunar = clock.querySelector(".clock-lunar");
  const verdictLabels = {
    OK: "AC", WRONG_ANSWER: "WA", TIME_LIMIT_EXCEEDED: "TLE",
    MEMORY_LIMIT_EXCEEDED: "MLE", RUNTIME_ERROR: "RE",
    COMPILATION_ERROR: "CE", IDLENESS_LIMIT_EXCEEDED: "ILE",
    PRESENTATION_ERROR: "PE", OUTPUT_LIMIT_EXCEEDED: "OLE",
  };
  const isSelectedSeries = (contest, platform) => {
    if (platform === "nowcoder") return contest.name.includes("挑战赛");
    if (platform === "atcoder") return /^https:\/\/atcoder\.jp\/contests\/(?:arc|agc)[\w-]*$/.test(contest.url);
    return /\bDiv\.?\s*1\b/i.test(contest.name);
  };
  let scheduledContests = [];
  function updateCountdown() {
    const now = Date.now();
    const next = scheduledContests.find((contest) => contest.start > now);
    const panel = document.querySelector("#next-contest");
    panel.hidden = !next;
    if (!next) return;
    const link = document.querySelector("#next-contest-link");
    link.href = next.url;
    link.textContent = `${platforms[next.platform]} · ${next.name}`;
    const remaining = Math.max(0, Math.ceil((next.start - now) / 1000));
    const days = Math.floor(remaining / 86400);
    const hours = Math.floor(remaining % 86400 / 3600);
    const minutes = Math.floor(remaining % 3600 / 60);
    const seconds = remaining % 60;
    document.querySelector("#contest-countdown").textContent = `${days ? `${days} 天 ` : ""}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function render() {
    const now = Date.now();
    const data = window.CONTEST_DATA;
    const contests = [];
    const messages = [];
    let warning = false;
    for (const [key, label] of Object.entries(platforms)) {
      if (filter.value !== "all" && filter.value !== key) continue;
      const source = data?.sources?.[key];
      if (!source || !Number.isFinite(source.updatedAt)) {
        messages.push(`${label}：暂无可用数据，请使用上方官方入口。`);
        warning = true;
        continue;
      }
      const stale = now - source.updatedAt > day;
      messages.push(`${label}：${formatter.format(source.updatedAt)} 更新${source.error ? "（最近获取失败，保留旧数据）" : stale ? "（快照已超过 24 小时，请核对官方赛程）" : ""}`);
      warning ||= stale || Boolean(source.error);
      for (const contest of source.contests || []) {
        if (!isSelectedSeries(contest, key)) continue;
        try {
          const url = new URL(contest.url);
          if (url.protocol !== "https:" || url.hostname !== hosts[key]) continue;
          if (!Number.isFinite(contest.start) || !Number.isFinite(contest.end) || contest.end <= contest.start) continue;
          contests.push({ ...contest, platform: key });
        } catch { /* Ignore malformed source links. */ }
      }
    }
    status.textContent = messages.join("\n");
    status.classList.toggle("warning", warning);
    scheduledContests = [...contests].sort((a, b) => a.start - b.start);
    updateCountdown();
    renderCalendar(new Date(), true);

    for (const kind of ["upcoming", "recent"]) {
      const rows = contests.filter((contest) => kind === "upcoming"
        ? contest.end > now
        : contest.end <= now);
      rows.sort((a, b) => kind === "upcoming" ? a.start - b.start : b.end - a.end);
      if (kind === "recent") rows.splice(20);
      const body = document.querySelector(`#${kind}-contests`);
      body.replaceChildren();
      for (const contest of rows) {
        const row = body.insertRow();
        const platform = document.createElement("span");
        platform.className = `platform-tag ${contest.platform}`;
        platform.textContent = platforms[contest.platform];
        row.insertCell().append(platform);
        const link = document.createElement("a");
        link.href = contest.url;
        link.textContent = contest.name;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        row.insertCell().append(link);
        const time = document.createElement("time");
        time.dateTime = new Date(contest.start).toISOString();
        time.textContent = formatter.format(contest.start);
        row.insertCell().append(time);
        const minutes = Math.round((contest.end - contest.start) / 60000);
        row.insertCell().textContent = `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
        const state = contest.end <= now ? "finished" : contest.start <= now ? "running" : "upcoming";
        const badge = document.createElement("span");
        badge.className = `status-tag ${state}`;
        badge.textContent = { finished: "已结束", running: "进行中", upcoming: "未开始" }[state];
        row.insertCell().append(badge);
      }
      if (!body.children.length) {
        const cell = body.insertRow().insertCell();
        cell.colSpan = 5;
        cell.className = "empty-row";
        cell.textContent = warning ? "暂无可显示的赛程，部分快照缺失或过期，请查看官方页面。" : "当前快照中没有符合此时间范围的比赛。";
      }
    }
  }

  filter.addEventListener("change", render);
  let calendarDay = "";
  let selectedCalendarDate = "";
  let calendarDates = new Map();
  const lunarCalendarFormatter = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", { timeZone: "UTC", month: "numeric", day: "numeric" });
  function calendarFestivals(date) {
    const fixed = { "1-1": "元旦", "2-14": "情人节", "3-8": "妇女节", "3-12": "植树节", "5-1": "劳动节", "5-4": "青年节", "6-1": "儿童节", "7-1": "建党节", "8-1": "建军节", "9-10": "教师节", "10-1": "国庆节", "12-25": "圣诞节" };
    const lunar = { "1-1": "春节", "1-15": "元宵节", "2-2": "龙抬头", "5-5": "端午节", "7-7": "七夕", "7-15": "中元节", "8-15": "中秋节", "9-9": "重阳节", "12-8": "腊八节" };
    const parts = Object.fromEntries(lunarCalendarFormatter.formatToParts(date).map(p => [p.type, p.value]));
    const tomorrow = Object.fromEntries(lunarCalendarFormatter.formatToParts(new Date(date.getTime() + day)).map(p => [p.type, p.value]));
    return [fixed[`${date.getUTCMonth() + 1}-${date.getUTCDate()}`], lunar[`${parts.month}-${parts.day}`],
      tomorrow.month === "1" && tomorrow.day === "1" ? "除夕" : null].filter(Boolean);
  }
  function showCalendarDate(key) {
    const info = calendarDates.get(key);
    if (!info) return;
    selectedCalendarDate = key;
    document.querySelectorAll("#calendar-weeks button[data-date]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.date === key));
    });
    const details = document.querySelector("#calendar-details");
    details.replaceChildren();
    const title = document.createElement("h3");
    title.textContent = `${key} · 周${info.weekday}`;
    details.append(title);
    const labels = document.createElement("p");
    labels.className = "calendar-guide";
    const arrangement = info.holiday ? `${info.holiday.name} · ${info.holiday.isOffDay ? "放假" : "调休上班"}` : "";
    labels.textContent = [...new Set([arrangement, ...info.festivals.filter(name => name !== info.holiday?.name)].filter(Boolean))].join(" / ") || "无特别节日标注";
    details.append(labels);
    if (!info.contests.length) {
      const empty = document.createElement("p");
      empty.className = "calendar-guide";
      empty.textContent = "当前赛程快照中没有该日比赛。";
      details.append(empty);
    }
    for (const contest of info.contests) {
      const item = document.createElement("div");
      item.className = `calendar-detail-event ${contest.platform}`;
      const link = document.createElement("a");
      link.href = contest.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `${platforms[contest.platform]} · ${contest.name}`;
      const time = document.createElement("small");
      time.textContent = `${formatter.format(contest.start)} 至 ${formatter.format(contest.end)} (UTC+8)`;
      item.append(link, time);
      details.append(item);
    }
  }
  function renderCalendar(now, force = false) {
    // Use UTC arithmetic on the UTC+8 calendar date, independent of device timezone/DST.
    const local = new Date(now.getTime() + 8 * 3600000);
    const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    const key = new Date(today).toISOString().slice(0, 10);
    if (calendarDay === key && !force) return;
    calendarDay = key;
    const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * day;
    const start = monday - 7 * day;
    const end = start + 20 * day;
    const formatDate = stamp => {
      const date = new Date(stamp);
      return `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
    };
    document.querySelector("#calendar-range").textContent = `${formatDate(start)} – ${formatDate(end)}`;
    const body = document.querySelector("#calendar-weeks");
    body.replaceChildren();
    calendarDates = new Map();
    const holidayData = window.CALENDAR_DATA?.years || {};
    const visibleYears = new Set();
    for (let week = 0; week < 3; week++) {
      const row = body.insertRow();
      if (week === 1) row.className = "current-week";
      const heading = document.createElement("th");
      heading.scope = "row";
      heading.textContent = ["上周", "本周", "下周"][week];
      row.append(heading);
      for (let weekday = 0; weekday < 7; weekday++) {
        const stamp = start + (week * 7 + weekday) * day;
        const date = new Date(stamp);
        const cell = row.insertCell();
        if (weekday >= 5) cell.className = "weekend";
        const dateKey = date.toISOString().slice(0, 10);
        visibleYears.add(String(date.getUTCFullYear()));
        const holiday = holidayData[date.getUTCFullYear()]?.days?.[dateKey];
        const festivals = calendarFestivals(date);
        const startUTC = stamp - 8 * 3600000;
        const contests = scheduledContests.filter(contest => contest.start < startUTC + day && contest.end > startUTC);
        calendarDates.set(dateKey, { weekday: "一二三四五六日"[weekday], holiday, festivals, contests });
        if (holiday) cell.classList.add(holiday.isOffDay ? "day-off" : "workday");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "calendar-date";
        button.dataset.date = dateKey;
        button.setAttribute("aria-label", `${formatDate(stamp)}，${contests.length} 场比赛${holiday ? `，${holiday.isOffDay ? "放假" : "调休上班"}` : ""}`);
        button.addEventListener("click", () => showCalendarDate(dateKey));
        const time = document.createElement("time");
        time.dateTime = dateKey;
        time.title = formatDate(stamp);
        time.setAttribute("aria-label", `${formatDate(stamp)} 周${"一二三四五六日"[weekday]}`);
        if (stamp === today) time.setAttribute("aria-current", "date");
        if (stamp === today) button.classList.add("is-today");
        const month = document.createElement("small");
        month.textContent = weekday === 0 || date.getUTCDate() === 1 ? `${date.getUTCMonth() + 1}月` : "";
        const number = document.createElement("b");
        number.textContent = date.getUTCDate();
        time.append(month, number);
        button.append(time);
        if (holiday) {
          const badge = document.createElement("span");
          badge.className = holiday.isOffDay ? "holiday-off" : "holiday-work";
          badge.textContent = holiday.isOffDay ? "休" : "班";
          button.append(badge);
        }
        cell.append(button);
        const festival = document.createElement("div");
        festival.className = "calendar-festival";
        festival.textContent = festivals.join(" / ") || (holiday?.isOffDay ? holiday.name : "");
        cell.append(festival);
        if (contests.length) {
          const count = document.createElement("small");
          count.className = "calendar-contest-count";
          count.textContent = `${contests.length}赛`;
          button.append(count);
          const events = document.createElement("div");
          events.className = "calendar-events";
          for (const contest of contests) {
            const link = document.createElement("a");
            link.className = `calendar-event ${contest.platform}`;
            link.href = contest.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            let shortName;
            if (contest.platform === "atcoder") shortName = new URL(contest.url).pathname.split("/").pop().toUpperCase();
            else if (contest.platform === "nowcoder") shortName = `挑战赛 ${contest.name.match(/挑战赛\s*(\d+)/)?.[1] || ""}`;
            else shortName = `CF ${contest.name.match(/Round\s+(\d+)/i)?.[1] || new URL(contest.url).pathname.split("/").pop()}`;
            const startTime = new Date(contest.start + 8 * 3600000).toISOString().slice(11, 16);
            link.textContent = `${shortName}\n${contest.start < startUTC ? "跨日比赛" : startTime}`;
            link.title = `${contest.name} · ${formatter.format(contest.start)} (UTC+8)`;
            events.append(link);
          }
          cell.append(events);
        }
      }
    }
    const warnings = [...visibleYears].flatMap(year => {
      const data = holidayData[year];
      if (!data || data.status !== "available") return [`${year} 年放假调休数据暂不可用`];
      return data.error ? [`${year} 年节假日更新失败，沿用缓存`] : [];
    });
    document.querySelector("#calendar-holiday-status").textContent = warnings.join("；") || "中国大陆放假调休安排已加载。";
    showCalendarDate(calendarDates.has(selectedCalendarDate) ? selectedCalendarDate : key);
  }
  const updateClock = () => {
    const now = new Date();
    clock.dateTime = now.toISOString();
    clockDate.textContent = `UTC+8 · ${clockDateFormatter.format(now)}`;
    clockTime.textContent = clockTimeFormatter.format(now);
    const lunar = Object.fromEntries(lunarFormatter.formatToParts(now).map((part) => [part.type, part.value]));
    const lunarYear = lunar.yearName ? `${lunar.yearName}年` : `${lunar.relatedYear || ""}年`;
    clockLunar.textContent = `${lunarYear} ${lunar.month || ""}${lunarDays[Number(lunar.day)] || lunar.day || ""}`;
    renderCalendar(now);
    updateCountdown();
  };

  let activityPage = 1;
  let activityPageCount = 1;
  const activityPageSize = document.querySelector("#activity-page-size");
  try {
    const saved = localStorage.getItem("activity-page-size");
    if ([...activityPageSize.options].some(option => option.value === saved)) activityPageSize.value = saved;
  } catch { /* Pagination still works when storage is unavailable. */ }
  function renderActivity() {
    const activity = window.CONTEST_DATA?.activity;
    const hiddenProblems = new Set(window.CONTEST_DATA?.config?.hiddenProblems || []);
    const body = document.querySelector("#activity-contests");
    const activityStatus = document.querySelector("#activity-status");
    const problemFilter = document.querySelector("#activity-filter").value;
    const sort = document.querySelector("#activity-sort").value;
    const contests = [];
    const messages = [];
    let warning = false;
    for (const key of ["codeforces", "atcoder", "nowcoder"]) {
      const source = activity?.[key];
      if (!source || !Number.isFinite(source.updatedAt)) {
        messages.push(`${platforms[key]}：暂无提交数据。`);
        warning = true;
        continue;
      }
      messages.push(`${platforms[key]}：${formatter.format(source.updatedAt)} 更新${source.error ? "（最近获取失败，保留旧数据）" : ""}`);
      warning ||= Boolean(source.error);
      for (const contest of source.contests || []) contests.push({ ...contest, platform: key });
    }
    contests.sort((a, b) => b.start - a.start);
    const entries = contests.flatMap((contest) => contest.problems
      .filter((problem) => !hiddenProblems.has(problem.key))
      .filter((problem) => problemFilter === "all" || !problem.firstAc)
      .map((problem) => ({ contest, problem })));
    if (sort !== "contest") {
      const direction = sort === "difficulty-asc" ? 1 : -1;
      entries.sort((a, b) => {
        const aRating = Number.isFinite(a.problem.rating) ? a.problem.rating : Infinity;
        const bRating = Number.isFinite(b.problem.rating) ? b.problem.rating : Infinity;
        if (aRating === Infinity && bRating === Infinity) return b.contest.start - a.contest.start;
        if (aRating === Infinity) return 1;
        if (bRating === Infinity) return -1;
        return direction * (aRating - bRating) || b.contest.start - a.contest.start;
      });
    }
    activityStatus.textContent = messages.join("\n");
    activityStatus.classList.toggle("warning", warning);
    document.querySelector("#activity-count").textContent = `${new Set(entries.map((entry) => entry.contest.url)).size} 场 · ${entries.length} 题`;
    body.replaceChildren();

    const ratingClass = (rating) => {
      if (!Number.isFinite(rating)) return "";
      if (rating < 400) return "rating-gray";
      if (rating < 800) return "rating-brown";
      if (rating < 1200) return "rating-green";
      if (rating < 1600) return "rating-cyan";
      if (rating < 2000) return "rating-blue";
      if (rating < 2400) return "rating-yellow";
      if (rating < 2800) return "rating-orange";
      return "rating-red";
    };
    const createProblemChip = (problem) => {
      const verdict = problem.status ? (verdictLabels[problem.status] || problem.status) : "";
      const chip = document.createElement("a");
      chip.className = `problem-chip ${verdict === "AC" ? "solved" : verdict ? "failed" : "unattempted"} ${ratingClass(problem.rating)}`;
      chip.href = problem.url;
      chip.target = "_blank";
      chip.rel = "noopener noreferrer";
      const summary = document.createElement("span");
      summary.textContent = `${problem.index} · ${problem.rating ?? "?"}${verdict ? ` · ${verdict}` : ""}`;
      const acceptedAt = document.createElement("small");
      acceptedAt.textContent = problem.firstAc ? `✓ ${formatter.format(problem.firstAc)}` : "—";
      chip.title = `${problem.name} · 难度 ${problem.rating ?? "暂无评分"}${verdict ? ` · 最后提交 ${verdict} · 共 ${problem.attempts} 次` : " · 未尝试"}`;
      chip.append(summary, acceptedAt);
      return chip;
    };
    const addRow = (contest, problemsToShow) => {
      const row = body.insertRow();
      const platform = document.createElement("span");
      platform.className = `platform-tag ${contest.platform}`;
      platform.textContent = platforms[contest.platform];
      row.insertCell().append(platform);
      const contestLink = document.createElement("a");
      contestLink.href = contest.url;
      contestLink.textContent = contest.name;
      contestLink.target = "_blank";
      contestLink.rel = "noopener noreferrer";
      row.insertCell().append(contestLink);
      const time = document.createElement("time");
      time.dateTime = new Date(contest.start).toISOString();
      time.textContent = formatter.format(contest.start);
      row.insertCell().append(time);
      const problems = document.createElement("div");
      problems.className = "problem-list";
      for (const problem of problemsToShow) problems.append(createProblemChip(problem));
      row.insertCell().append(problems);
    };
    // Paginate rendered rows, keeping every contest's problem group together.
    const rows = [];
    if (sort === "contest") {
      const groups = new Map();
      for (const { contest, problem } of entries) {
        if (!groups.has(contest)) {
          const problems = [];
          groups.set(contest, problems);
          rows.push({ contest, problems });
        }
        groups.get(contest).push(problem);
      }
    } else {
      for (const { contest, problem } of entries) rows.push({ contest, problems: [problem] });
    }
    const pageSize = activityPageSize.value === "all" ? Math.max(1, rows.length) : Number(activityPageSize.value);
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    activityPageCount = pageCount;
    activityPage = Math.max(1, Math.min(activityPage, pageCount));
    const start = (activityPage - 1) * pageSize;
    for (const row of rows.slice(start, start + pageSize)) addRow(row.contest, row.problems);
    const unit = sort === "contest" ? "场比赛" : "道题目";
    document.querySelector("#activity-page-info").textContent = rows.length
      ? `第 ${activityPage} / ${pageCount} 页 · 显示 ${start + 1}–${Math.min(start + pageSize, rows.length)} / ${rows.length} ${unit}`
      : "第 0 / 0 页 · 暂无符合条件的数据";
    document.querySelector("#activity-prev").disabled = activityPage <= 1;
    document.querySelector("#activity-next").disabled = activityPage >= pageCount;
    const pageNumbers = document.querySelector("#activity-page-numbers");
    const focusedPage = pageNumbers.contains(document.activeElement) ? document.activeElement.dataset.page : null;
    pageNumbers.replaceChildren();
    if (rows.length) {
      const pages = new Set([1, pageCount]);
      for (let page = Math.max(1, activityPage - 2); page <= Math.min(pageCount, activityPage + 2); page++) pages.add(page);
      const ordered = [...pages].sort((a, b) => a - b);
      let previous = 0;
      for (const page of ordered) {
        if (page - previous === 2) pages.add(previous + 1);
        previous = page;
      }
      previous = 0;
      for (const page of [...pages].sort((a, b) => a - b)) {
        if (page - previous > 1) {
          const gap = document.createElement("span");
          gap.textContent = "…";
          gap.setAttribute("aria-hidden", "true");
          pageNumbers.append(gap);
        }
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.page = String(page);
        button.textContent = String(page);
        button.setAttribute("aria-label", `第 ${page} 页`);
        button.setAttribute("aria-controls", "activity-contests");
        if (page === activityPage) button.setAttribute("aria-current", "page");
        pageNumbers.append(button);
        previous = page;
      }
    }
    if (focusedPage) pageNumbers.querySelector(`[data-page="${activityPage}"]`)?.focus({ preventScroll: true });
    const pageInput = document.querySelector("#activity-page-input");
    pageInput.max = String(pageCount);
    pageInput.value = rows.length ? String(activityPage) : "";
    pageInput.disabled = !rows.length || pageCount === 1;
    pageInput.setCustomValidity("");
    document.querySelector("#activity-page-go").disabled = pageInput.disabled;
    if (!body.children.length) {
      const cell = body.insertRow().insertCell();
      cell.colSpan = 4;
      cell.className = "empty-row";
      cell.textContent = problemFilter === "unaccepted" ? "当前筛选下没有未 AC 的题目。" : "暂未找到 Kieray 的公开比赛提交记录。";
    }
  }

  function initNarcissus(voice) {
    const decoration = document.querySelector("#fixed-narcissus");
    const toggle = document.querySelector("#narcissus-toggle");
    const panel = document.querySelector("#narcissus-panel");
    const sizeInput = document.querySelector("#narcissus-size");
    const speedInput = document.querySelector("#narcissus-speed");
    const sizeValue = document.querySelector("#narcissus-size-value");
    const speedValue = document.querySelector("#narcissus-speed-value");
    const mode = document.querySelector("#narcissus-mode");
    const loading = document.querySelector("#narcissus-loading");
    const hideButton = document.querySelector("#narcissus-hide");
    const backgroundButton = document.querySelector("#narcissus-background");
    const readSetting = (key, fallbackValue) => {
      try {
        return Number(localStorage.getItem(key)) || fallbackValue;
      } catch {
        return fallbackValue;
      }
    };
    const saveSetting = (key, value) => {
      try {
        localStorage.setItem(key, String(value));
      } catch { /* Settings still work for this page load. */ }
    };
    let playbackSpeed = Math.min(3, Math.max(0.25, readSetting("narcissus-speed", 1)));
    const initialSize = Math.min(300, Math.max(50, readSetting("narcissus-size", 100)));
    let characterRenderer;
    const captureButton = document.querySelector("#motion-capture-toggle");
    const captureStatus = document.querySelector("#motion-capture-status");
    const calibrateButton = document.querySelector("#motion-capture-calibrate");
    const capture = window.createFaceCapture({
      video: document.querySelector("#motion-capture-preview"),
      onSample: values => characterRenderer?.updateMotionCapture?.(values),
      onState: ({ active, state, message }) => {
        if (active) voice.stop();
        characterRenderer?.setMotionCapture?.(active);
        captureButton.textContent = active ? "关闭摄像头动捕" : "开启摄像头动捕";
        captureButton.setAttribute("aria-pressed", String(active));
        captureStatus.textContent = message;
        captureStatus.dataset.state = state;
        calibrateButton.hidden = !active || state === "loading";
      },
    });
    const updateCaptureAvailability = () => {
      const supported = Boolean(characterRenderer?.supportsMotionCapture);
      captureButton.disabled = !supported || characterHidden;
      if (!characterRenderer) captureStatus.textContent = "请先等待角色加载完成。";
      else if (!supported) captureStatus.textContent = "夏利的 Spine 模型暂不支持动捕，请切换至 Live2D 角色。";
      else if (characterHidden) captureStatus.textContent = "请先显示角色，再开启动捕。";
      else {
        // Preserve permission errors and the reason capture stopped across resize/visibility updates.
        if (!capture.active && [undefined, "unavailable"].includes(captureStatus.dataset.state)) {
          captureStatus.textContent = "支持头部、眨眼、张嘴；微笑和眉毛依皮肤支持。";
          captureStatus.dataset.state = "ready";
        }
        return;
      }
      captureStatus.dataset.state = "unavailable";
    };
    captureButton.addEventListener("click", () => {
      if (capture.active) capture.stop();
      else if (characterRenderer?.supportsMotionCapture && !isCharacterHidden()) capture.start();
    });
    calibrateButton.addEventListener("click", () => capture.calibrate());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && capture.active) capture.stop("页面已进入后台，摄像头已关闭；返回后需手动开启。");
    });
    window.addEventListener("pagehide", () => capture.stop());
    let characterHidden = readSetting("narcissus-hidden", 0) === 1;
    let backgroundPlayback = true;
    try { backgroundPlayback = localStorage.getItem("narcissus-background") !== "0"; } catch { /* Default enabled. */ }
    const isCharacterHidden = () => characterHidden || (!backgroundPlayback && document.hidden);
    const updateSubtitlePlacement = () => {
      const subtitle = document.querySelector("#voice-subtitle");
      const rect = decoration.getBoundingClientRect();
      const width = document.documentElement.clientWidth;
      const height = window.innerHeight;
      let left = 12;
      let right = 12;
      let bottom = 14;
      let maxHeight = height - 28;
      if (!isCharacterHidden()) {
        const rightSpace = width - rect.right - 24;
        const leftSpace = rect.left - 24;
        // A freely positioned character can leave more room on either side.
        if (Math.max(rightSpace, leftSpace) >= 180) {
          if (rightSpace >= leftSpace) left = rect.right + 12;
          else right = width - rect.left + 12;
        } else if (rect.top >= 104 && rect.top >= height - rect.bottom) {
          bottom = height - rect.top + 12;
          maxHeight = rect.top - 24;
        } else if (height - rect.bottom >= 106) {
          maxHeight = height - rect.bottom - 26;
        }
      }
      left = Math.max(12, Math.min(left, width - 192));
      subtitle.style.setProperty("--subtitle-left", `${left}px`);
      subtitle.style.setProperty("--subtitle-right", `${Math.max(12, right)}px`);
      subtitle.style.setProperty("--subtitle-bottom", `${bottom}px`);
      subtitle.style.setProperty("--subtitle-max-height", `${Math.max(80, maxHeight)}px`);
    };
    let position = { x: 0, y: 0 };
    let drag = null;
    try {
      const saved = JSON.parse(localStorage.getItem("narcissus-position"));
      if (saved && [saved.x, saved.y].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
        position = { x: saved.x, y: saved.y };
      }
    } catch { /* Start at the original bottom-left position. */ }
    const applyPosition = () => {
      const rect = decoration.getBoundingClientRect();
      // Fractions of the available travel preserve edge positions across skins and sizes.
      decoration.style.left = `${position.x * (document.documentElement.clientWidth - rect.width)}px`;
      decoration.style.bottom = `${position.y * (window.innerHeight - rect.height)}px`;
      updateSubtitlePlacement();
    };
    const finishDrag = () => {
      const previous = drag;
      drag = null;
      decoration.classList.remove("is-dragging");
      if (previous?.moved) saveSetting("narcissus-position", JSON.stringify(position));
      if (previous && decoration.hasPointerCapture(previous.id)) decoration.releasePointerCapture(previous.id);
    };
    const refreshPosition = () => { finishDrag(); applyPosition(); };
    window.addEventListener("resize", refreshPosition);
    window.addEventListener("blur", finishDrag);
    document.addEventListener("visibilitychange", () => { if (document.hidden) finishDrag(); });
    const positionObserver = new ResizeObserver(refreshPosition);
    positionObserver.observe(decoration);
    document.querySelector("#narcissus-reset-position").addEventListener("click", () => {
      finishDrag();
      position = { x: 0, y: 0 };
      saveSetting("narcissus-position", JSON.stringify(position));
      applyPosition();
    });
    window.addEventListener("pagehide", event => {
      finishDrag();
      if (!event.persisted) positionObserver.disconnect();
    });
    let playAction = () => false;
    let actionBusy = () => true;
    const applyVisibility = () => {
      const hidden = isCharacterHidden();
      decoration.classList.toggle("is-hidden", hidden);
      decoration.setAttribute("aria-hidden", String(hidden));
      decoration.tabIndex = hidden ? -1 : 0;
      hideButton.textContent = characterHidden ? "显示角色" : "隐藏角色";
      hideButton.setAttribute("aria-pressed", String(characterHidden));
      backgroundButton.textContent = `后台播放：${backgroundPlayback ? "开启" : "关闭"}`;
      backgroundButton.setAttribute("aria-pressed", String(backgroundPlayback));
      characterRenderer?.setVisible(!hidden);
      updateSubtitlePlacement();
      if (hidden) {
        finishDrag();
        voice.stop();
        if (capture.active) capture.stop("角色已隐藏，摄像头已关闭。");
      }
      updateCaptureAvailability();
    };
    applyVisibility();
    hideButton.addEventListener("click", () => {
      characterHidden = !characterHidden;
      saveSetting("narcissus-hidden", characterHidden ? 1 : 0);
      applyVisibility();
    });
    backgroundButton.addEventListener("click", () => {
      backgroundPlayback = !backgroundPlayback;
      saveSetting("narcissus-background", backgroundPlayback ? 1 : 0);
      applyVisibility();
    });
    let silentStreak = 0;
    const interact = () => {
      if (drag || capture.active || isCharacterHidden() || actionBusy() || voice.busy) return;
      const speak = silentStreak >= 2 || Math.random() < 0.5;
      decoration.dataset.interaction = speak ? "voice" : "silent";
      playAction();
      if (speak) voice.play();
      else {
        silentStreak += 1;
        voice.stop();
      }
    };
    decoration.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || !event.isPrimary || drag || isCharacterHidden()) return;
      const rect = decoration.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
        left: rect.left, bottom: window.innerHeight - rect.bottom,
        threshold: event.pointerType === "mouse" ? 6 : 10, moved: false };
      decoration.setPointerCapture(event.pointerId);
    });
    const moveDrag = (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < drag.threshold) return;
      drag.moved = true;
      decoration.classList.add("is-dragging");
      const rect = decoration.getBoundingClientRect();
      const travelX = document.documentElement.clientWidth - rect.width;
      const travelY = window.innerHeight - rect.height;
      // Negative travel lets oversized (up to 300%) models be panned, not lost offscreen.
      position.x = Math.abs(travelX) < 1 ? 0 : Math.max(0, Math.min(1, (drag.left + dx) / travelX));
      position.y = Math.abs(travelY) < 1 ? 0 : Math.max(0, Math.min(1, (drag.bottom - dy) / travelY));
      applyPosition();
    };
    decoration.addEventListener("pointermove", moveDrag);
    decoration.addEventListener("pointercancel", event => { if (drag?.id === event.pointerId) finishDrag(); });
    decoration.addEventListener("lostpointercapture", event => { if (drag?.id === event.pointerId) finishDrag(); });
    decoration.addEventListener("dragstart", event => event.preventDefault());
    decoration.addEventListener("pointerup", (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      moveDrag(event);
      const click = !drag.moved;
      finishDrag();
      if (click) interact();
    });
    decoration.addEventListener("click", (event) => {
      // Physical clicks are handled once on pointerup; retain assistive/keyboard activation.
      if (event.detail === 0) interact();
    });
    decoration.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        interact();
      }
    });
    const interactionTimer = setInterval(interact, 60000);
    window.addEventListener("pagehide", (event) => { if (!event.persisted) clearInterval(interactionTimer); });
    document.addEventListener("visibilitychange", applyVisibility);
    window.addEventListener("pagehide", () => voice.stop());
    const audio = document.querySelector("#narcissus-voice");
    audio.addEventListener("playing", () => {
      silentStreak = 0;
      characterRenderer?.setSpeaking(true);
    });
    for (const event of ["pause", "ended", "error"]) {
      audio.addEventListener(event, () => characterRenderer?.setSpeaking(false));
    }
    const applySize = (value) => {
      finishDrag();
      decoration.style.setProperty("--narcissus-scale", String(value / 100));
      sizeValue.textContent = `${value}%`;
      characterRenderer?.resize();
      applyPosition();
    };
    const applySpeed = (value) => {
      playbackSpeed = value;
      audio.defaultPlaybackRate = value;
      audio.playbackRate = value;
      audio.preservesPitch = true;
      speedValue.textContent = `${Number(value.toFixed(2))}×`;
    };
    sizeInput.value = String(initialSize);
    speedInput.value = String(playbackSpeed);
    applySize(initialSize);
    applySpeed(playbackSpeed);
    toggle.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute("aria-expanded", String(!panel.hidden));
    });
    sizeInput.addEventListener("input", () => {
      const value = Number(sizeInput.value);
      applySize(value);
      saveSetting("narcissus-size", value);
    });
    speedInput.addEventListener("input", () => {
      const value = Number(speedInput.value);
      applySpeed(value);
      saveSetting("narcissus-speed", value);
    });

    const characterSelect = document.querySelector("#character-select");
    const skinSelect = document.querySelector("#skin-select");
    const selectionName = document.querySelector("#character-selection-name");
    const retryButton = document.querySelector("#character-retry");
    const catalog = window.CHARACTER_CATALOG || [];
    const displayName = (item) => `${item.zh} / ${item.en}`;
    let selectionRequest;
    let selectionVersion = 0;
    const chooseSkin = async () => {
      const character = catalog.find(item => item.id === characterSelect.value);
      const skin = character?.skins.find(item => item.id === skinSelect.value);
      if (!skin) return;
      finishDrag();
      const version = ++selectionVersion;
      if (capture.active) capture.stop("已切换角色，摄像头已关闭。");
      selectionRequest?.abort();
      characterRenderer?.destroy();
      characterRenderer = null;
      updateCaptureAvailability();
      selectionRequest = new AbortController();
      const request = selectionRequest;
      const current = () => version === selectionVersion && !request.signal.aborted;
      voice.setVoices([]);
      silentStreak = 0;
      playAction = () => false;
      actionBusy = () => true;
      decoration.dataset.character = character.id;
      decoration.dataset.skin = skin.id;
      decoration.dataset.renderer = "loading";
      decoration.setAttribute("aria-label", `单击播放${displayName(character)}的动作或语音，按住拖动位置`);
      selectionName.textContent = `${displayName(character)} · ${displayName(skin)}`;
      loading.hidden = false;
      retryButton.hidden = true;
      speedInput.disabled = false;
      saveSetting(`character-skin:${character.id}`, skin.id);
      const report = (text) => { if (current()) { mode.textContent = text; loading.textContent = text; } };
      report(`加载 ${displayName(character)}…`);
      let voiceError = "";
      const voicesReady = (async () => {
        try {
          const response = await fetch(skin.voices, { signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]) });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const records = (await response.json()).voices;
          if (!Array.isArray(records) || !records.length) throw new Error("语音清单为空");
          if (current()) voice.setVoices(records, displayName(character));
        } catch (error) {
          if (current()) voiceError = `语音加载失败：${error.message}`;
        }
      })();
      const options = {
        container: decoration, skin, signal: request.signal,
        getSpeed: () => playbackSpeed, getScale: () => Number(sizeInput.value) / 100,
        getBackgroundPlayback: () => backgroundPlayback, status: report,
      };
      const attach = (controller, type) => {
        if (!current()) { controller.destroy(); return; }
        characterRenderer = controller;
        decoration.dataset.renderer = type;
        loading.hidden = true;
        playAction = () => controller.playSpecial();
        actionBusy = () => controller.busy;
        applyVisibility();
        controller.onError = (error) => {
          if (!current()) return;
          if (capture.active) capture.stop("角色显示中断，摄像头已关闭。", "error");
          voice.stop();
          controller.destroy();
          characterRenderer = null;
          updateCaptureAvailability();
          playAction = () => false;
          actionBusy = () => true;
          loading.hidden = false;
          report(`角色显示中断：${error.message}`);
          retryButton.hidden = false;
        };
      };
      try {
        const create = skin.type === "spine" ? window.createCharacterSpine : window.createNarcissusLive2D;
        if (location.protocol === "file:") throw new Error("请双击 start_local.bat 打开多角色模型");
        const controller = await create(options);
        attach(controller, skin.type);
      } catch (error) {
        if (!current()) return;
        decoration.dataset.renderer = "error";
        report(`加载失败：${error.message}。请确认通过 HTTPS 或 start_local.bat 打开后重试。`);
        retryButton.hidden = false;
      }
      await voicesReady;
      if (current() && voiceError) {
        mode.textContent += ` · ${voiceError}`;
        retryButton.hidden = false;
      }
    };
    const chooseCharacter = () => {
      const character = catalog.find(item => item.id === characterSelect.value);
      if (!character) return;
      skinSelect.replaceChildren(...character.skins.map(skin => new Option(displayName(skin), skin.id)));
      try {
        const saved = localStorage.getItem(`character-skin:${character.id}`);
        if (character.skins.some(skin => skin.id === saved)) skinSelect.value = saved;
      } catch { /* Default to the first skin. */ }
      chooseSkin();
    };
    characterSelect.replaceChildren(...catalog.map(character => new Option(displayName(character), character.id)));
    characterSelect.addEventListener("change", chooseCharacter);
    skinSelect.addEventListener("change", chooseSkin);
    retryButton.addEventListener("click", chooseSkin);
    window.addEventListener("pagehide", event => {
      if (!event.persisted) { selectionRequest?.abort(); characterRenderer?.destroy(); }
    });
    if (catalog.length) {
      characterSelect.value = catalog[Math.floor(Math.random() * catalog.length)].id;
      chooseCharacter();
    } else reportMissingCatalog();
    function reportMissingCatalog() { mode.textContent = loading.textContent = "角色目录加载失败，请刷新重试"; }
  }

  function initNarcissusVoice() {
    let voices = [];
    let characterName = "";
    const audio = document.querySelector("#narcissus-voice");
    const subtitle = document.querySelector("#voice-subtitle");
    const label = document.querySelector("#voice-label");
    const english = document.querySelector("#voice-en");
    const chinese = document.querySelector("#voice-zh");
    const notice = document.querySelector("#voice-notice");
    let lastIndex = -1;
    let subtitleTimer;
    let loadTimer;
    let shownAt = 0;
    let readingTime = 8000;
    let starting = false;
    let playbackLocked = false;
    let requestId = 0;
    audio.volume = 0.9;
    const hideSubtitle = () => {
      subtitle.hidden = true;
    };
    const playbackFailed = (message) => {
      requestId += 1;
      playbackLocked = false;
      starting = false;
      clearTimeout(loadTimer);
      clearTimeout(subtitleTimer);
      audio.pause();
      notice.textContent = message;
      notice.hidden = false;
      // Retain the bilingual text instead of flashing it and immediately hiding it.
    };
    const pickVoice = () => {
      if (voices.length === 1) return 0;
      let index;
      do index = Math.floor(Math.random() * voices.length);
      while (index === lastIndex);
      return index;
    };
    const playRandomVoice = async () => {
      if (!voices.length || playbackLocked || starting || !audio.paused) return false;
      playbackLocked = true;
      const request = ++requestId;
      starting = true;
      clearTimeout(subtitleTimer);
      clearTimeout(loadTimer);
      const index = pickVoice();
      const voice = voices[index];
      lastIndex = index;
      audio.pause();
      audio.src = voice.audioMp3 || voice.audio;
      audio.currentTime = 0;
      label.textContent = [characterName, voice.label].filter(Boolean).join(" · ");
      english.textContent = voice.en;
      chinese.textContent = voice.zh;
      notice.hidden = true;
      shownAt = performance.now();
      readingTime = Math.min(20000, Math.max(8000, voice.zh.length * 110));
      subtitle.hidden = false;
      loadTimer = setTimeout(() => {
        if (request === requestId && starting) playbackFailed("语音加载超时，请检查网络后再次点击角色。");
      }, 20000);
      try {
        await audio.play();
        return request === requestId;
      } catch (error) {
        if (request === requestId) {
          playbackFailed(error.name === "NotAllowedError"
            ? "浏览器限制了自动播放，请点击角色启用语音。"
            : "语音暂时无法播放，请检查网络或浏览器音频支持后重试。");
        }
        return false;
      } finally {
        if (request === requestId) { starting = false; clearTimeout(loadTimer); }
      }
    };
    audio.addEventListener("ended", () => {
      playbackLocked = false;
      starting = false;
      clearTimeout(subtitleTimer);
      clearTimeout(loadTimer);
      subtitleTimer = setTimeout(hideSubtitle, Math.max(2500, readingTime - (performance.now() - shownAt)));
    });
    audio.addEventListener("error", () => {
      if (playbackLocked) playbackFailed("语音文件加载失败，请检查网络后再次点击角色。");
    });
    audio.addEventListener("pause", () => {
      if (playbackLocked && !starting && !audio.ended) {
        playbackFailed("语音被浏览器中断，请点击角色重新播放。");
      }
    });
    return {
      play: playRandomVoice,
      setVoices(records, name = "") {
        this.stop();
        voices = records.filter(record => record.audio || record.audioMp3);
        characterName = name;
        lastIndex = -1;
        audio.removeAttribute("src");
        audio.load();
      },
      get busy() { return playbackLocked || starting || !audio.paused; },
      stop() {
        requestId += 1;
        starting = false;
        playbackLocked = false;
        clearTimeout(subtitleTimer);
        clearTimeout(loadTimer);
        audio.pause();
        notice.hidden = true;
        hideSubtitle();
      },
    };
  }
  updateClock();
  render();
  renderActivity();
  initNarcissus(initNarcissusVoice());
  document.querySelector("#activity-filter").addEventListener("change", (event) => {
    if (event.target.value === "unaccepted" && document.querySelector("#activity-sort").value === "contest") {
      document.querySelector("#activity-sort").value = "difficulty-asc";
    }
    activityPage = 1;
    renderActivity();
  });
  document.querySelector("#activity-sort").addEventListener("change", () => {
    activityPage = 1;
    renderActivity();
  });
  activityPageSize.addEventListener("change", () => {
    activityPage = 1;
    try { localStorage.setItem("activity-page-size", activityPageSize.value); } catch { /* Optional preference. */ }
    renderActivity();
  });
  document.querySelector("#activity-prev").addEventListener("click", () => {
    activityPage--;
    renderActivity();
  });
  document.querySelector("#activity-next").addEventListener("click", () => {
    activityPage++;
    renderActivity();
  });
  document.querySelector("#activity-page-numbers").addEventListener("click", event => {
    const button = event.target.closest("button[data-page]");
    if (!button) return;
    activityPage = Number(button.dataset.page);
    renderActivity();
  });
  const pageInput = document.querySelector("#activity-page-input");
  pageInput.addEventListener("input", () => pageInput.setCustomValidity(""));
  document.querySelector("#activity-page-jump").addEventListener("submit", event => {
    event.preventDefault();
    if (pageInput.disabled) return;
    const page = Number(pageInput.value);
    if (!Number.isSafeInteger(page) || page < 1 || page > activityPageCount) {
      pageInput.setCustomValidity(`请输入 1 至 ${activityPageCount} 之间的整数页码。`);
      pageInput.reportValidity();
      return;
    }
    activityPage = page;
    renderActivity();
  });
  setInterval(updateClock, 1000);
  setInterval(render, 60000);
})();
