"use strict";

(() => {
  const font = document.getElementById("subtitle-font");
  const size = document.getElementById("subtitle-size");
  const label = document.getElementById("subtitle-size-value");
  const status = document.getElementById("subtitle-settings-status");
  const targets = [document.getElementById("voice-subtitle"), document.getElementById("subtitle-style-preview")];
  if (!font || !size || targets.some(target => !target)) return;
  const key = "subtitle-appearance";
  const fonts = new Map([
    ["web", null],
    ["classic", '"Segoe UI", "Microsoft YaHei", sans-serif'],
    ["archive", 'Georgia, "Times New Roman", SimSun, "Songti SC", serif'],
    ["yahei", '"Microsoft YaHei", "Segoe UI", sans-serif'],
    ["simsun", 'SimSun, "Songti SC", serif'],
    ["kaiti", 'KaiTi, STKaiti, serif'],
    ["mono", 'Consolas, "Microsoft YaHei", monospace'],
  ]);
  function sanitize(value) {
    return { font: fonts.has(value?.font) ? value.font : "archive",
      size: Number.isInteger(value?.size) && value.size >= 10 && value.size <= 32 ? value.size : 14 };
  }
  function apply(value) {
    const prefs = sanitize(value);
    font.value = prefs.font;
    size.value = String(prefs.size);
    label.textContent = `${prefs.size} px`;
    for (const target of targets) {
      target.style.setProperty("--caption-size", `${prefs.size}px`);
      target.style.setProperty("--caption-en-style", prefs.font === "archive" ? "italic" : "normal");
      if (prefs.font === "web") target.style.removeProperty("--caption-font");
      else target.style.setProperty("--caption-font", fonts.get(prefs.font));
    }
    return prefs;
  }
  function parse(value) { try { return JSON.parse(value); } catch { return null; } }
  try { apply(parse(localStorage.getItem(key))); }
  catch {
    apply(null);
    status.hidden = false;
    status.textContent = "浏览器存储不可用，字幕设置仅在当前页面生效。";
  }
  function change() {
    const prefs = apply({ font: font.value, size: Number(size.value) });
    try { localStorage.setItem(key, JSON.stringify(prefs)); status.hidden = true; }
    catch { status.hidden = false; status.textContent = "无法保存字幕设置，本次调整仍然有效。"; }
  }
  font.addEventListener("change", change);
  size.addEventListener("input", change);
  window.addEventListener("storage", event => {
    if (event.key === key || event.key === null) apply(parse(event.newValue));
  });
})();
