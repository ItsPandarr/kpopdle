import { DIFFICULTIES, MODES, ENTITIES } from "./config.js";
import { t } from "./i18n.js";

// Render a radio-style toggle group as a set of <button role="radio">.
// `options` = [{value, label}].
function renderToggleGroup(rootEl, options, current, onChange) {
  rootEl.innerHTML = "";
  for (const { value, label } of options) {
    const btn = document.createElement("button");
    const active = value === current;
    btn.className = "toggle-btn" + (active ? " is-active" : "");
    btn.textContent = label;
    btn.dataset.value = value;
    btn.type = "button";
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", active ? "true" : "false");
    // -1 for inactive so arrow-key roving focus works; 0 for active.
    btn.tabIndex = active ? 0 : -1;
    btn.addEventListener("click", () => onChange(value));
    btn.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
      e.preventDefault();
      const buttons = Array.from(rootEl.querySelectorAll(".toggle-btn"));
      const i = buttons.indexOf(btn);
      let next;
      if (e.key === "Home") next = 0;
      else if (e.key === "End") next = buttons.length - 1;
      else if (e.key === "ArrowRight") next = (i + 1) % buttons.length;
      else next = (i - 1 + buttons.length) % buttons.length;
      buttons[next].focus();
      onChange(buttons[next].dataset.value);
    });
    rootEl.appendChild(btn);
  }
}

export function attachEntityToggle(rootEl, currentEntity, onChange) {
  renderToggleGroup(
    rootEl,
    ENTITIES.map((e) => ({ value: e, label: t(`toggle.entity.${e}`) })),
    currentEntity,
    onChange,
  );
}

export function attachModeToggle(rootEl, currentMode, onChange) {
  renderToggleGroup(
    rootEl,
    MODES.map((m) => ({ value: m, label: t(`toggle.mode.${m}`) })),
    currentMode,
    onChange,
  );
}

export function attachDifficultyToggle(rootEl, current, onChange) {
  renderToggleGroup(
    rootEl,
    DIFFICULTIES.map((d) => ({ value: d, label: t(`toggle.difficulty.${d}`) })),
    current,
    onChange,
  );
}

export function attachThemeToggle(rootEl, current, onChange) {
  renderToggleGroup(
    rootEl,
    [
      { value: "auto",  label: t("settings.theme.auto") },
      { value: "light", label: t("settings.theme.light") },
      { value: "dark",  label: t("settings.theme.dark") },
    ],
    current,
    onChange,
  );
}

function onOffOptions() {
  return [
    { value: "off", label: t("settings.toggle.off") },
    { value: "on",  label: t("settings.toggle.on") },
  ];
}
export function attachCbToggle(rootEl, current, onChange) {
  renderToggleGroup(rootEl, onOffOptions(), current, onChange);
}
export function attachCalmToggle(rootEl, current, onChange) {
  renderToggleGroup(rootEl, onOffOptions(), current, onChange);
}
export function attachFilterToggle(rootEl, current, onChange) {
  renderToggleGroup(rootEl, onOffOptions(), current, onChange);
}
export function attachLangToggle(rootEl, current, onChange) {
  renderToggleGroup(
    rootEl,
    [
      { value: "auto", label: t("settings.lang.auto") },
      { value: "en",   label: t("settings.lang.en") },
      { value: "ko",   label: t("settings.lang.ko") },
    ],
    current,
    onChange,
  );
}

export function setActive(rootEl, value) {
  for (const btn of rootEl.querySelectorAll(".toggle-btn")) {
    const active = btn.dataset.value === value;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-checked", active ? "true" : "false");
    btn.tabIndex = active ? 0 : -1;
  }
}

// Settings popover. Opens on button click; closes on outside click or Escape.
// Returns { open(), close(), toggle() } in case callers want to drive it.
export function attachSettingsMenu({ button, panel }) {
  function setOpen(open) {
    panel.hidden = !open;
    button.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) {
      // Focus the first focusable control in the panel.
      const first = panel.querySelector("button, [tabindex]:not([tabindex='-1'])");
      first?.focus();
    }
  }
  button.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(panel.hidden);
  });
  document.addEventListener("click", (e) => {
    if (panel.hidden) return;
    if (panel.contains(e.target) || button.contains(e.target)) return;
    setOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !panel.hidden) {
      setOpen(false);
      button.focus();
    }
  });
  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(panel.hidden),
  };
}

// Apply theme/cb preferences to <html>. `theme` ∈ {"auto","light","dark"}.
export function applyTheme(theme) {
  if (theme === "light" || theme === "dark") {
    document.documentElement.dataset.theme = theme;
  } else {
    delete document.documentElement.dataset.theme;
  }
}
export function applyCb(cb) {
  if (cb === "on") {
    document.documentElement.dataset.cb = "on";
  } else {
    delete document.documentElement.dataset.cb;
  }
}
export function applyCalm(calm) {
  if (calm === "on") {
    document.documentElement.dataset.calm = "on";
  } else {
    delete document.documentElement.dataset.calm;
  }
}

export function formatCountdownToUTCMidnight() {
  const now = new Date();
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  const ms = next - now;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
