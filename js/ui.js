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
      { value: "ja",   label: t("settings.lang.ja") },
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

// Promise-based confirm dialog — a themed replacement for window.confirm()
// that doesn't look like a 1995 OS popup, respects light/dark + reduced-
// motion, and is keyboard-accessible (Enter/Esc + Tab cycles within the
// dialog).
//
// Usage:
//   if (await showConfirm({ message: "Reset?", confirmLabel: "Reset", destructive: true })) {
//     // user confirmed
//   }
//
// Options:
//   message       — body text (required)
//   title         — optional bold heading above the message
//   confirmLabel  — primary button label (defaults to t("modal.confirm"))
//   cancelLabel   — secondary button label (defaults to t("modal.cancel"))
//   destructive   — when true, confirm button gets a red tint AND default
//                   focus goes to Cancel (safer for accidental Enter
//                   presses on destructive actions)
//
// Returns: Promise<boolean> — true if confirmed, false if cancelled (via
// Cancel button, Escape, or backdrop click).
//
// Concurrency: only one modal is shown at a time. If a second showConfirm
// is called while one is open, the existing one auto-resolves to false
// before the new one opens.
let activeModalCleanup = null;

export function showConfirm({ title, message, confirmLabel, cancelLabel, destructive = false }) {
  // Auto-dismiss any in-flight modal so the second caller doesn't get
  // stuck behind it. The dismissed one resolves to false.
  if (activeModalCleanup) activeModalCleanup(false);

  return new Promise((resolve) => {
    const prevFocus = document.activeElement;

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.setAttribute("role", "presentation");

    const card = document.createElement("div");
    card.className = "modal-card";
    card.setAttribute("role", "alertdialog");
    card.setAttribute("aria-modal", "true");

    if (title) {
      const titleEl = document.createElement("h3");
      titleEl.className = "modal-title";
      titleEl.id = "modal-title";
      titleEl.textContent = title;
      card.setAttribute("aria-labelledby", "modal-title");
      card.appendChild(titleEl);
    }

    const msgEl = document.createElement("p");
    msgEl.className = "modal-message";
    msgEl.id = "modal-message";
    msgEl.textContent = message;
    card.appendChild(msgEl);
    card.setAttribute("aria-describedby", "modal-message");

    const actions = document.createElement("div");
    actions.className = "modal-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "modal-btn modal-cancel";
    cancelBtn.textContent = cancelLabel ?? t("modal.cancel");
    actions.appendChild(cancelBtn);
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "modal-btn modal-confirm" + (destructive ? " is-destructive" : "");
    confirmBtn.textContent = confirmLabel ?? t("modal.confirm");
    actions.appendChild(confirmBtn);
    card.appendChild(actions);

    backdrop.appendChild(card);
    document.body.appendChild(backdrop);

    function close(result) {
      // Idempotent — multiple paths (Esc, click, button) all funnel here.
      if (!backdrop.parentNode) return;
      backdrop.remove();
      document.removeEventListener("keydown", onKey, true);
      activeModalCleanup = null;
      if (prevFocus && typeof prevFocus.focus === "function") {
        // Restore focus so a keyboard-only user lands back where they were.
        try { prevFocus.focus(); } catch { /* element may have detached */ }
      }
      resolve(result);
    }
    activeModalCleanup = close;

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      } else if (e.key === "Tab") {
        // Focus trap inside the dialog — cycle between Cancel + Confirm.
        const focusables = [cancelBtn, confirmBtn];
        const idx = focusables.indexOf(document.activeElement);
        const next = idx === -1
          ? 0
          : e.shiftKey
            ? (idx - 1 + focusables.length) % focusables.length
            : (idx + 1) % focusables.length;
        focusables[next].focus();
        e.preventDefault();
      }
    }

    cancelBtn.addEventListener("click", () => close(false));
    confirmBtn.addEventListener("click", () => close(true));
    // Backdrop click cancels — but only when the click landed on the
    // backdrop itself, not bubbled up from inside the card.
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close(false);
    });
    document.addEventListener("keydown", onKey, true);

    // Default focus: destructive actions default to Cancel (safer for
    // an accidental Enter press); non-destructive defaults to Confirm.
    requestAnimationFrame(() => {
      (destructive ? cancelBtn : confirmBtn).focus();
    });
  });
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
