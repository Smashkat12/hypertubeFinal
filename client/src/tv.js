// TV mode: a 10-foot UI for smart-TV browsers and TV boxes. The whole app is scaled so it lays
// out like a 1280px-wide screen (1.5x on a 1080p TV, 3x on 4K), focus is clearly highlighted, and
// the remote's arrows / OK / Back move between items. On automatically for TV browsers; anyone
// can switch it on or off from the profile menu (remembered per device).

const TV_UA = /SmartTV|SMART-TV|Tizen|Web0S|webOS|NetCast|BRAVIA|HbbTV|\bAFT[A-Z]|CrKey|Android TV|GoogleTV|AppleTV|Roku|VIDAA|Vizio/i;
const LAYOUT_WIDTH = 1280;

const pref = () => {
  try {
    return localStorage.getItem("nf-tv");
  } catch (e) {
    return null;
  }
};
export const isTv = () => (pref() === "1" ? true : pref() === "0" ? false : TV_UA.test(navigator.userAgent));

const apply = () => {
  const on = isTv();
  const root = document.documentElement;
  const zoom = on ? Math.max(1, window.innerWidth / LAYOUT_WIDTH) : 1;
  root.classList.toggle("tv", on);
  root.style.zoom = on ? String(zoom) : "";
  // vw/vh would be multiplied by the zoom too; the stylesheet uses these instead (1vw/1vh by default)
  root.style.setProperty("--vw", on ? `${window.innerWidth / zoom / 100}px` : "");
  root.style.setProperty("--vh", on ? `${window.innerHeight / zoom / 100}px` : "");
};

export const setTv = (on) => {
  try {
    localStorage.setItem("nf-tv", on ? "1" : "0");
  } catch (e) {}
  apply();
};

// ---- remote-control (D-pad) navigation ----
const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';
const usable = (el) => {
  if (el.closest(".nf-card-hover")) return false; // hover-only buttons on cards
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
};

// nearest focusable element in a direction (rows scroll horizontally, so off-screen ones count)
const move = (dir) => {
  const all = Array.from(document.querySelectorAll(FOCUSABLE)).filter(usable);
  const cur = document.activeElement && document.activeElement !== document.body && usable(document.activeElement) ? document.activeElement : null;
  let target = null;
  if (!cur) target = all[0];
  else {
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    let best = Infinity;
    all.forEach((el) => {
      if (el === cur || cur.contains(el) || el.contains(cur)) return;
      const b = el.getBoundingClientRect();
      const dx = b.left + b.width / 2 - ax;
      const dy = b.top + b.height / 2 - ay;
      const horizontal = dir === "left" || dir === "right";
      const main = { left: a.left - b.right, right: b.left - a.right, up: a.top - b.bottom, down: b.top - a.bottom }[dir];
      const cross = Math.abs(horizontal ? dy : dx);
      if (main < -4) return; // not in that direction
      const score = Math.max(0, main) + cross * 2;
      if (score < best) {
        best = score;
        target = el;
      }
    });
  }
  if (target) {
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }
};

const KEYS = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
const BACK_CODES = [10009, 461]; // Samsung Tizen, LG webOS remote "Back"

const onKey = (e) => {
  if (!isTv()) return;
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "");
  const inPlayer = /^\/watch\//.test(window.location.pathname);
  if (BACK_CODES.includes(e.keyCode) || (e.key === "Backspace" && !typing)) {
    e.preventDefault();
    window.history.back();
    return;
  }
  if (inPlayer) return; // the player handles its own keys (seek, play/pause, volume)
  if (KEYS[e.key] && !(typing && (e.key === "ArrowLeft" || e.key === "ArrowRight"))) {
    e.preventDefault();
    move(KEYS[e.key]);
  } else if (e.key === "Enter" && !typing && !e.defaultPrevented) {
    const el = document.activeElement;
    // native buttons/links already activate on Enter; clickable divs need a nudge
    if (el && el !== document.body && !/^(A|BUTTON)$/.test(el.tagName)) {
      e.preventDefault();
      el.click();
    }
  }
};

export const initTv = () => {
  apply();
  window.addEventListener("resize", apply);
  window.addEventListener("keydown", onKey);
};
