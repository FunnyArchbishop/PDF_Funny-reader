"use strict";

(() => {
  const storageKey = "stdoverwatch-reader:preferences";
  const modes = ["system", "light", "dark"];
  const accents = ["violet", "blue", "green", "amber"];
  const system = matchMedia("(prefers-color-scheme: dark)");
  const root = document.documentElement;
  let saved;
  try { saved = JSON.parse(localStorage.getItem(storageKey) || "null"); } catch {}
  const preferences = {
    mode: modes.includes(saved?.mode) ? saved.mode : "system",
    accent: accents.includes(saved?.accent) ? saved.accent : "violet",
    manifestBase: typeof saved?.manifestBase === "string" ? saved.manifestBase : ""
  };

  function applyTheme() {
    root.dataset.theme = preferences.mode === "system" ? (system.matches ? "dark" : "light") : preferences.mode;
    root.dataset.accent = preferences.accent;
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
