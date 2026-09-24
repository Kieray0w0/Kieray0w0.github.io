"use strict";

(() => {
  const data = window.CCF_DEADLINE_DATA;
  const filter = document.querySelector("#ccf-category-filter");
  const body = document.querySelector("#ccf-deadline-rows");
  const nextPanel = document.querySelector("#next-ccf-deadline");
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const duration = milliseconds => {
    const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor(seconds % 86400 / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const rest = seconds % 60;
    return `${days ? `${days} 天 ` : ""}${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  };
  const selected = () => (data?.deadlines || []).filter(item =>
    item.deadline > Date.now() && (filter.value === "all" || item.category === filter.value));
  function updateCountdowns() {
    const now = Date.now();
    document.querySelectorAll("[data-ccf-deadline]").forEach(output => {
      const remaining = Number(output.dataset.ccfDeadline) - now;
      output.textContent = remaining > 0 ? duration(remaining) : "已截止";
      output.closest("tr")?.classList.toggle("deadline-passed", remaining <= 0);
    });
    const next = selected()[0];
    nextPanel.hidden = !next;
    if (!next) return;
    const link = document.querySelector("#next-ccf-link");
    link.href = next.url;
    link.textContent = `${next.title} ${next.year} · ${next.round}`;
    document.querySelector("#ccf-countdown").textContent = duration(next.deadline - now);
  }
  function render() {
    body.replaceChildren();
    if (!data?.deadlines || !data?.categories) {
      const cell = body.insertRow().insertCell();
      cell.colSpan = 6; cell.className = "empty-row";
      cell.textContent = "CCF DDL 数据未生成，请在本地运行 update_ccf_deadlines.py。";
      nextPanel.hidden = true;
      return;
    }
    const rows = selected();
    for (const item of rows) {
      const row = body.insertRow();
      const category = document.createElement("span");
      category.className = "ccf-category-tag";
      category.textContent = item.category;
      category.title = item.categoryName;
      row.insertCell().append(category);
      const link = document.createElement("a");
      link.href = item.url; link.target = "_blank"; link.rel = "noopener noreferrer";
      link.textContent = `${item.title} ${item.year}`; link.title = item.description;
      row.insertCell().append(link);
      const translatedTitle = row.insertCell();
      translatedTitle.className = "ccf-title-zh";
      translatedTitle.textContent = item.titleZh || "中文译名待补充";
      const time = document.createElement("time");
      time.dateTime = new Date(item.deadline).toISOString();
      time.textContent = formatter.format(item.deadline);
      row.insertCell().append(time);
      const countdown = document.createElement("output");
      countdown.className = "ccf-row-countdown";
      countdown.dataset.ccfDeadline = item.deadline;
      row.insertCell().append(countdown);
      row.insertCell().textContent = item.round;
    }
    if (!rows.length) {
      const cell = body.insertRow().insertCell();
      cell.colSpan = 6; cell.className = "empty-row";
      cell.textContent = "当前分类没有已公布且尚未截止的 CCF A 会议 DDL。";
    }
    const updated = Number.isFinite(data.generatedAt) ? formatter.format(data.generatedAt) : "未知";
    const pending = (data.pending || []).filter(item => filter.value === "all" || item.category === filter.value).length;
    document.querySelector("#ccf-data-status").textContent =
      `快照更新：${updated}（UTC+8） · 收录 ${data.venueCount} 个 CCF A 会议 · ${rows.length} 个未来截止${pending ? ` · ${pending} 个待公布` : ""}`;
    updateCountdowns();
  }
  filter.addEventListener("change", render);
  render();
  setInterval(updateCountdowns, 1000);
})();
