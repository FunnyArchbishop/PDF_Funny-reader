"use strict";

(() => {
  const storageKey = "stdoverwatch-reader:preferences";
  const modes = ["system", "light", "dark"];
  const accents = ["auto", "violet", "blue", "green", "amber"];
  const styles = ["studio", "retro", "cyber", "coast", "botanical", "bauhaus", "ink", "custom"];
  const color = (value, fallback) => /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
  const system = matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;
  let saved;
  try { saved = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch {}
  const preferences = {
    mode: modes.includes(saved?.mode) ? saved.mode : "system",
    accent: accents.includes(saved?.accent) ? saved.accent : "auto",
    style: styles.includes(saved?.style) ? saved.style : "studio",
    customInk: color(saved?.customInk, "#7153a3"),
    customPaper: color(saved?.customPaper, "#d2cbe0"),
    manifestBase: typeof saved?.manifestBase === "string" ? saved.manifestBase : ""
  };

  const imageKey = storageKey + ":background";
  let background = "";
  try {
    const stored = localStorage.getItem(imageKey);
    if (stored && /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(stored)) background = stored;
  } catch {}
  function applyTheme() {
    root.dataset.theme = preferences.mode === "system" ? (system.matches ? "dark" : "light") : preferences.mode;
    root.dataset.accent = preferences.accent;
    root.dataset.style = preferences.style;
    root.style.setProperty("--user-ink", preferences.customInk);
    root.style.setProperty("--user-paper", preferences.customPaper);
    root.style.setProperty("--user-image", background ? 'url("' + background + '")' : "none");
  }

  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch {}
  }

  applyTheme();
  system.addEventListener("change", applyTheme);
  document.addEventListener("DOMContentLoaded", () => {
    const $ = id => document.getElementById(id);
    const settings = $("settings-dialog");
    const mode = $("theme-mode"), accent = $("theme-accent"), base = $("manifest-base");
    mode.value = preferences.mode;
    const choices = document.querySelectorAll('input[name="reader-style"]');
    function syncStyle() {
      for (const choice of choices) choice.checked = choice.value === preferences.style;
      const custom = preferences.style === "custom";
      $("custom-style").hidden = !custom;
      accent.parentElement.hidden = custom;
      $("remove-style-image").hidden = !background;
    }
    for (const choice of choices) choice.onchange = () => {
      preferences.style = choice.value;
      applyTheme(); syncStyle(); save();
    };
    for (const [id, key] of [["custom-ink", "customInk"], ["custom-paper", "customPaper"]]) {
      $(id).value = preferences[key];
      $(id).oninput = () => { preferences[key] = $(id).value; applyTheme(); save(); };
    }
    let imageRequest = 0;
    $("style-image").onchange = async event => {
      const file = event.target.files[0];
      event.target.value = "";
      if (!file) return;
      const request = ++imageRequest;
      let bitmap;
      try {
        if (!["image/webp","image/png","image/jpeg"].includes(file.type)) throw new Error();
        bitmap = await createImageBitmap(file);
        if (request !== imageRequest) return;
        const scale = Math.min(1, 1440 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL("image/webp", .8);
        localStorage.setItem(imageKey, data);
        background = data;
        applyTheme(); syncStyle();
        $("style-status").textContent = "背景图已保存到此浏览器";
      } catch { $("style-status").textContent = "无法保存图片，请试试较小的 PNG、JPEG 或 WebP 图片。"; }
      finally { bitmap?.close(); }
    };
    $("remove-style-image").onclick = () => {
      imageRequest++;
      localStorage.removeItem(imageKey);
      background = "";
      $("style-status").textContent = "";
      applyTheme(); syncStyle();
    };
    syncStyle();
    accent.value = preferences.accent;
    base.value = preferences.manifestBase;
    mode.onchange = () => { preferences.mode = mode.value; applyTheme(); save(); };
    accent.onchange = () => { preferences.accent = accent.value; applyTheme(); save(); };
    base.onchange = () => { preferences.manifestBase = base.value.trim(); save(); };
    $("settings-button").onclick = () => {
      $("setting-pdf").hidden = $("reader-panel").hidden || $("pdf-tools").hidden;
      settings.showModal();
    };
    $("help-button").onclick = () => $("help-dialog").showModal();
  }, {once: true});
})();
