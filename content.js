// AccessLens Lite — Content Script (Chrome MV3)
const MSG = {
  GET_STATE: "ALL.GET_STATE",
  INIT_CONTENT: "ALL.INIT_CONTENT"
};

let lastPrefs = null;
let mo = null;
let debounceTimer = null;

// Utilities

function setVar(name, value) {
  document.documentElement.style.setProperty(name, String(value));
}
function clearVar(name) {
  document.documentElement.style.removeProperty(name);
}

function ensureStylesheet() {
  if (document.getElementById("__all_base_styles")) return;
  const link = document.createElement("link");
  link.id = "__all_base_styles";
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("accessibility.css");
  document.documentElement.appendChild(link);
}

// Skip link

let skipLinkEl = null;

function ensureSkipLink(enabled) {
  if (!enabled) {
    if (skipLinkEl) {
      skipLinkEl.remove();
      skipLinkEl = null;
    }
    return;
  }
  if (!skipLinkEl) {
    skipLinkEl = document.createElement("a");
    skipLinkEl.href = "#__all_main_content";
    skipLinkEl.className = "all-skip-link";
    skipLinkEl.textContent = "Skip to main content";

    document.body.insertBefore(skipLinkEl, document.body.firstChild);
  }

  let mainTarget =
    document.querySelector("main, [role='main'], article, #main") ||
    document.body;
  if (!mainTarget.id) mainTarget.id = "__all_main_content";
}

// Reduce motion / pause media
let __allMotionStyle = null;

function setReduceMotion(reduce, pauseMedia) {
  if (!reduce && !pauseMedia) {
    document.documentElement.classList.remove("all-reduce-motion");
    if (__allMotionStyle) {
      __allMotionStyle.remove();
      __allMotionStyle = null;
    }
    return;
  }

  document.documentElement.classList.toggle("all-reduce-motion", !!reduce);

  if (!__allMotionStyle) {
    __allMotionStyle = document.createElement("style");
    __allMotionStyle.id = "__all_motion_patch";
    document.documentElement.appendChild(__allMotionStyle);
  }

  __allMotionStyle.textContent = `
    html.all-reduce-motion * {
      scroll-behavior: auto !important;
      scroll-snap-type: none !important;
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
      transition-delay: 0ms !important;
    }
  `;

  if (pauseMedia) pauseMediaElements(); else restoreMediaElements();
}

function applyMotionPrefs(m) {
  document.documentElement.classList.toggle("all-no-snaps", !!m.noScrollSnap);
  document.documentElement.classList.toggle("all-no-parallax", !!m.noParallax);
}

function pauseMediaElements() {
  // videos & audio
  document.querySelectorAll("video, audio").forEach(el => {
    try {
      if (!el.__allPausedByExt && !el.paused) {
        el.pause();
        el.__allPausedByExt = true;
      }
    } catch {}
  });

  // HTML5 autoplay via mutation or attributes
  document.querySelectorAll("video[autoplay], audio[autoplay]").forEach(el => {
    try {
      el.__allHadAutoplay = el.hasAttribute("autoplay") ? "1" : "0";
      el.removeAttribute("autoplay");
    } catch {}
  });

  // Lottie / Bodymovin
  try {
    if (window.bodymovin?.animationItems) {
      window.bodymovin.animationItems.forEach(a => {
        try {
          if (!a.__allPausedByExt) {
            a.pause?.();
            a.__allPausedByExt = true;
          }
        } catch {}
      });
    }
  } catch {}
  try {
    if (window.lottie?.getRegisteredAnimations) {
      window.lottie.getRegisteredAnimations().forEach(a => {
        try {
          if (!a.__allPausedByExt) {
            a.pause?.();
            a.__allPausedByExt = true;
          }
        } catch {}
      });
    }
  } catch {}

  // animated GIFs: swap src
  document.querySelectorAll("img").forEach(img => {
    try {
      const src = img.src || "";
      if (!src) return;
      if (/\.(gif)(\?|#|$)/i.test(src)) {
        if (!img.dataset.__allFrozenGif) {
          img.dataset.__allFrozenGif = "1";
          img.dataset.allGifSrc = src;
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          const tmp = new Image();
          tmp.crossOrigin = "anonymous";
          tmp.onload = () => {
            canvas.width = tmp.width;
            canvas.height = tmp.height;
            ctx.drawImage(tmp, 0, 0);
            img.src = canvas.toDataURL("image/png");
          };
          tmp.src = src;
        }
      }
    } catch {}
  });
}

function restoreMediaElements() {
  // restore video/audio
  document.querySelectorAll("video, audio").forEach(el => {
    try {
      if (el.__allPausedByExt) {
        el.play?.();
        el.__allPausedByExt = false;
      }
    } catch {}
  });

  // restore autoplay
  document.querySelectorAll("video, audio").forEach(el => {
    try {
      if (el.__allHadAutoplay === "1") {
        el.setAttribute("autoplay", "");
      }
      delete el.__allHadAutoplay;
    } catch {}
  });

  // Lottie / Bodymovin
  try {
    if (window.bodymovin?.animationItems) {
      window.bodymovin.animationItems.forEach(a => {
        try {
          if (a.__allPausedByExt) {
            a.play?.();
            a.__allPausedByExt = false;
          }
        } catch {}
      });
    }
  } catch {}
  try {
    if (window.lottie?.getRegisteredAnimations) {
      window.lottie.getRegisteredAnimations().forEach(a => {
        try {
          if (a.__allPausedByExt) {
            a.play?.();
            a.__allPausedByExt = false;
          }
        } catch {}
      });
    }
  } catch {}

  // unfreeze GIFs
  document.querySelectorAll("img[data-all-gif-src]").forEach(img => {
    try {
      if (img.dataset.__allFrozenGif === "1" && img.dataset.allGifSrc) {
        img.src = img.dataset.allGifSrc;
      }
      delete img.dataset.__allFrozenGif;
      delete img.dataset.allGifSrc;
    } catch {}
  });
}

function restoreMotionEffects() {
  setReduceMotion(false, false);
}

// -----------------------------
// Reading tools: ruler + dimmer
// -----------------------------
let rulerEl = null;
let dimEl = null;
let moveHandler = null;

function setReadingTools(rt) {
  const useRuler = !!rt.ruler;
  const useFocusMode = !!rt.focusMode;

  if (!useRuler) {
    if (rulerEl) {
      rulerEl.remove();
      rulerEl = null;
      if (moveHandler) {
        document.removeEventListener("mousemove", moveHandler);
        document.removeEventListener("touchmove", moveHandler);
        moveHandler = null;
      }
    }
  } else {
    if (!rulerEl) {
      rulerEl = document.createElement("div");
      rulerEl.className = "all-reading-ruler";
      document.body.appendChild(rulerEl);

      moveHandler = ev => {
        let clientY = 0;
        if (ev.touches?.length) clientY = ev.touches[0].clientY;
        else clientY = ev.clientY ?? 0;
        const h = parseFloat(getComputedStyle(rulerEl).height) || 32;
        rulerEl.style.transform = `translateY(${clientY - h / 2}px)`;
      };
      document.addEventListener("mousemove", moveHandler, { passive: true });
      document.addEventListener("touchmove", moveHandler, { passive: true });
    }
  }

  if (!useFocusMode) {
    document.documentElement.classList.remove("all-focus-mode");
    if (dimEl) {
      dimEl.remove();
      dimEl = null;
    }
  } else {
    document.documentElement.classList.add("all-focus-mode");
    if (!dimEl) {
      dimEl = document.createElement("div");
      dimEl.className = "all-focus-dim";
      document.body.appendChild(dimEl);
    }
  }
}

// -----------------------------
// Keyboard helpers
// -----------------------------
let patched = [];
let navSections = [];
let navIndex = 0;
let navHotkeysEnabled = false;

function patchInteractiveFocus() {
  unpatchInteractiveFocus();
  const candidates = [...document.querySelectorAll("a, button, [role='button'], input, textarea, select, [tabindex]")];
  for (const el of candidates) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    if (!el.hasAttribute("tabindex")) {
      el.setAttribute("data-all-tab", "1");
      el.tabIndex = 0;
      patched.push(el);
    }
  }
}

function unpatchInteractiveFocus() {
  patched.forEach(el => {
    try {
      if (el.getAttribute("data-all-tab") === "1") {
        el.removeAttribute("tabindex");
        el.removeAttribute("data-all-tab");
      }
    } catch {}
  });
  patched = [];
}

function collectNavigables() {
  // Prefer main/article/role=main, but fall back to body
  const root =
    document.querySelector("main") ||
    document.querySelector("article") ||
    document.querySelector("div[role='main']") ||
    document.body;

  // First try good semantic sections/headings under root
  let nodes = Array.from(
    root.querySelectorAll("section, h1, h2, h3")
  );

  // If still nothing, fallback to all h2/h3 in the document
  if (!nodes.length) {
    nodes = Array.from(document.querySelectorAll("h1, h2, h3"));
  }

  // Filter out obvious non-content regions (header/nav/footer/aside, hidden, tiny)
  nodes = nodes.filter(el => {
    const badAncestor = el.closest("header, nav, footer, aside");
    if (badAncestor) return false;

    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;

    const rect = el.getBoundingClientRect();
    if (!rect || rect.height < 20 || rect.width < 100) return false;

    return true;
  });

  navSections = nodes;
  navIndex = 0;
}

function clearNavigables() {
  navSections = [];
  navIndex = 0;
}

function bindNavHotkeys(enabled) {
  navHotkeysEnabled = !!enabled;
  if (!bindNavHotkeys.bound) {
    document.addEventListener("keydown", ev => {
      if (!navHotkeysEnabled) return;
      if (!ev.altKey || !ev.shiftKey) return;
      if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;

      if (!navSections.length) return;
      ev.preventDefault();
      if (ev.key === "ArrowDown") {
        navIndex = Math.min(navSections.length - 1, navIndex + 1);
      } else {
        navIndex = Math.max(0, navIndex - 1);
      }

      const target = navSections[navIndex];
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        if (typeof target.focus === "function") target.focus();
      }
    });
    bindNavHotkeys.bound = true;
  }
}

// Color-blind simulation
let __allCBStyle = null;

function cbDisable() {
  if (__allCBStyle) {
    __allCBStyle.remove();
    __allCBStyle = null;
  }
  document.documentElement.classList.remove(
    "all-cb-deut",
    "all-cb-prot",
    "all-cb-trit",
    "all-cb-sim",
    "all-cb-noimg"
  );
  document.documentElement.style.filter = "";
}

function setCBMatrix(type, strength) {
  if (!__allCBStyle) {
    __allCBStyle = document.createElement("style");
    __allCBStyle.id = "__all_cb_patch";
    document.documentElement.appendChild(__allCBStyle);
  }
  document.documentElement.classList.add("all-cb-sim");
  document.documentElement.classList.remove("all-cb-deut", "all-cb-prot", "all-cb-trit");

  const s = Math.max(0, Math.min(100, strength ?? 60)) / 100;
  let matrix = "1 0 0 0 0   0 1 0 0 0   0 0 1 0 0   0 0 0 1 0";

  if (type === "deuteranopia") {
    document.documentElement.classList.add("all-cb-deut");
    const r = 0.625 * s + 1 * (1 - s);
    const g = 0.7 * s;
    const b = 0 * s;
    matrix = `${r} ${g} ${b} 0 0
              0.7 0.3 0 0 0
              0 0.3 0.7 0 0
              0 0 0 1 0`;
  } else if (type === "protanopia") {
    document.documentElement.classList.add("all-cb-prot");
    matrix = `0.567 0.433 0 0 0
              0.558 0.442 0 0 0
              0 0.242 0.758 0 0
              0 0 0 1 0`;
  } else if (type === "tritanopia") {
    document.documentElement.classList.add("all-cb-trit");
    matrix = `0.95 0.05 0 0 0
              0 0.433 0.567 0 0
              0 0.475 0.525 0 0
              0 0 0 1 0`;
  }

  __allCBStyle.textContent = `
    html.all-cb-sim {
      filter: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><filter id='all_cb'><feColorMatrix type='matrix' values='${matrix.replace(
        /\s+/g,
        " "
      )}'/></filter></svg>#all_cb") !important;
    }
  `;
}

// Redundant cues & contrast
function applyCues(cb) {
  document.documentElement.classList.toggle("al-always-underline", !!cb.alwaysUnderline);
  document.documentElement.classList.toggle("al-visited-dash", !!cb.visitedDashed);

  const audit = !!cb.audit;
  document.querySelectorAll("a").forEach(a => {
    if (!a.href) return;
    const cs = getComputedStyle(a);
    const color = cs.color;
    const textDecoration = cs.textDecorationLine || "";
    const border = cs.borderBottomWidth || "";
    const bg = cs.backgroundColor || "transparent";
    const hasVisual =
      textDecoration.includes("underline") ||
      parseFloat(border) > 0 ||
      bg !== "transparent";
    if (!hasVisual && audit) {
      a.classList.add("all-audit-color-only");
    } else {
      a.classList.remove("all-audit-color-only");
    }
  });
}

function luminanceFromCSSColor(color) {
  const ctx =
    luminanceFromCSSColor._ctx ||
    (luminanceFromCSSColor._ctx = (() => {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      return c.getContext("2d");
    })());
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  const toLinear = v => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const R = toLinear(r);
  const G = toLinear(g);
  const B = toLinear(b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(fg, bg) {
  const L1 = luminanceFromCSSColor(fg);
  const L2 = luminanceFromCSSColor(bg);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

function underlineLowContrastLinks(minRatio) {
  const ratio = minRatio ?? 4.5;
  document.querySelectorAll("a").forEach(a => {
    if (!a.href) return;
    const cs = getComputedStyle(a);
    const color = cs.color;
    const bg =
      cs.backgroundColor === "rgba(0, 0, 0, 0)"
        ? getComputedStyle(a.parentElement || document.body).backgroundColor
        : cs.backgroundColor;
    const cr = contrastRatio(color, bg);
    if (cr < ratio) {
      a.classList.add("all-low-contrast");
    } else {
      a.classList.remove("all-low-contrast");
    }
  });
}

function clearLowContrastUnderline() {
  document.querySelectorAll(".all-low-contrast").forEach(a =>
    a.classList.remove("all-low-contrast")
  );
}

function clearUnclampMarks() {
  document.querySelectorAll("[data-all-unclamp]").forEach(el =>
    el.removeAttribute("data-all-unclamp")
  );
}

function markReadingContainerForLowVision() {
  if (!document.body) return;

  const existing = document.querySelector("[data-all-measure]");
  if (existing) return;

  let candidate =
    document.querySelector("main") ||
    document.querySelector("article") ||
    document.querySelector("div[role='main']");

  if (!candidate) {
    let maxArea = 0;
    for (const el of Array.from(document.body.children)) {
      const r = el.getBoundingClientRect();
      const area = r.width * r.height;
      if (!area || !isFinite(area)) continue;
      if (area > maxArea) {
        maxArea = area;
        candidate = el;
      }
    }
  }

  if (candidate) {
    candidate.setAttribute("data-all-measure", "1");
  }
}

// Low Vision
let __allLVStyle = null;

function applyFocusNotObscured() {
  // sticky header padding
  const tops = [...document.querySelectorAll("*")].filter(el => {
    const cs = getComputedStyle(el);
    if (!["fixed", "sticky"].includes(cs.position)) return false;
    const r = el.getBoundingClientRect();
    if (r.top > 8) return false;
    if (r.height < 40 || r.width < 200) return false;
    return r.left <= 40 && r.right >= window.innerWidth - 40;
  });
  const h = tops.length
    ? Math.min(200, Math.max(...tops.map(el => el.getBoundingClientRect().height)))
    : 0;

  if (!__allLVStyle) {
    __allLVStyle = document.createElement("style");
    __allLVStyle.id = "__all_lv_patch";
    document.documentElement.appendChild(__allLVStyle);
  }

  const pad = h ? `${Math.ceil(h) + 8}px` : "";
  document.documentElement.style.scrollPaddingTop = pad;

  __allLVStyle.textContent = `
    ${
      h
        ? `
      html.all-lowvision :is(h1,h2,h3,h4,h5,h6,a[name],a[id],[id]) {
        scroll-margin-top: ${Math.ceil(h) + 8}px !important;
      }
    `
        : ``
    }

    /* Low Vision now only adjusts typography via CSS variables set in applyPrefs(). */
  `;

  // re-check once in case late banners appear
  clearTimeout(applyFocusNotObscured._t);
  applyFocusNotObscured._t = setTimeout(() => {
    const again = [...document.querySelectorAll("*")].some(el => {
      const cs = getComputedStyle(el);
      if (!["fixed", "sticky"].includes(cs.position)) return false;
      const r = el.getBoundingClientRect();
      if (r.top > 8) return false;
      if (r.height < 40 || r.width < 200) return false;
      return r.left <= 40 && r.right >= window.innerWidth - 40;
    });
    if (again) applyFocusNotObscured();
  }, 2000);
}

// Main application of prefs
function applyPrefs(p) {
  p = p || {};
  const t = p.typography || {};
  const k = p.keyboard || {};
  const m = p.motion || {};
  const rt = p.readingTools || {};
  const co = p.contrast || {};
  const cb = p.colorBlind || {};

  lastPrefs = p;
  const active = p.preset && p.preset !== "none";
  document.documentElement.classList.toggle("all-enabled", !!active);

  // Typography
  setVar("--all-min-font", `${(t.minFontSizePx ?? 26)}px`);
  setVar("--all-line-height", t.lineHeight ?? 1.6);
  setVar("--all-letter-spacing", (t.letterSpacingEm ?? 0.02) + "em");
  setVar("--all-word-spacing", (t.wordSpacingEm ?? 0.04) + "em");

  // Low vision toggle + reading width
  const isLowVision = p.preset === "low-vision";
  document.documentElement.classList.toggle("all-lowvision", isLowVision);
  setVar("--all-max-measure", `${(t.maxMeasureCh ?? 84)}ch`);
  if (isLowVision) {
    applyFocusNotObscured();
    markReadingContainerForLowVision();
  } else {
    document.documentElement.style.scrollPaddingTop = "";
    clearUnclampMarks();
    document
      .querySelectorAll("[data-all-measure]")
      .forEach(n => n.removeAttribute("data-all-measure"));
  }

  // Keyboard
  document.documentElement.classList.toggle("all-strong-focus", !!k.strongFocusRing);
  ensureSkipLink(!!k.skipToContent);

  unpatchInteractiveFocus();
  clearNavigables();
  if (k.patchInteractive) patchInteractiveFocus();
  if (k.navigateSections) collectNavigables();
  bindNavHotkeys(!!k.navigateSections);

  // Motion
  const anyMotion =
    !!(m.reduceMotion || m.pauseMedia || m.noScrollSnap || m.noParallax);
  applyMotionPrefs(m);
  setReduceMotion(!!m.reduceMotion, !!m.pauseMedia);

  if (!anyMotion) {
    restoreMotionEffects();
  }

  // Reading tools
  setVar("--all-ruler-height", `${(rt.rulerHeightPx ?? 28)}px`);
  setVar("--all-focus-padding", `${(rt.focusPaddingPx ?? 12)}px`);
  setReadingTools(rt);

  // Color-blind Assist
  cbDisable();
  if (cb.simulate && cb.simulate !== "off") {
    setCBMatrix(cb.simulate, cb.strength ?? 60);
    document.documentElement.classList.toggle("all-cb-noimg", !cb.applyToImages);
  }
  if (
    cb.redundantCues ||
    cb.alwaysUnderline ||
    cb.visitedDashed ||
    cb.audit
  )
    applyCues(cb);

  // Link contrast helper
  clearLowContrastUnderline();
  if (co.underlineLowContrastLinks)
    underlineLowContrastLinks(co.minRatio ?? 4.5);
}

function clearAll() {
  lastPrefs = { preset: "none" };
  document.documentElement.classList.remove(
    "all-enabled",
    "all-strong-focus",
    "all-reduce-motion",
    "all-focus-mode",
    "all-cb-deut",
    "all-cb-prot",
    "all-cb-trit",
    "all-lowvision",
    "all-cb-sim",
    "all-cb-noimg",
    "al-always-underline",
    "al-visited-dash",
    "all-no-snaps",
    "all-no-parallax"
  );
  clearVar("--all-min-font");
  clearVar("--all-line-height");
  clearVar("--all-letter-spacing");
  clearVar("--all-word-spacing");
  clearVar("--all-ruler-height");
  clearVar("--all-focus-padding");
  clearVar("--all-max-measure");
  document.documentElement.style.scrollPaddingTop = "";
  document.documentElement.style.filter = "";
  clearUnclampMarks();
  document
    .querySelectorAll("[data-all-measure]")
    .forEach(el => el.removeAttribute("data-all-measure"));

  restoreMotionEffects();

  ensureSkipLink(false);
  unpatchInteractiveFocus();
  clearNavigables();
  bindNavHotkeys(false);

  if (rulerEl) {
    rulerEl.remove();
    rulerEl = null;
    if (moveHandler) {
      document.removeEventListener("mousemove", moveHandler);
      document.removeEventListener("touchmove", moveHandler);
      moveHandler = null;
    }
  }
  if (dimEl) {
    dimEl.remove();
    dimEl = null;
  }

  clearLowContrastUnderline();
  document
    .querySelectorAll(".all-audit-color-only")
    .forEach(a => a.classList.remove("all-audit-color-only"));
}

function getState() {
  return new Promise(resolve =>
    chrome.runtime.sendMessage({ type: MSG.GET_STATE }, resolve)
  );
}

async function init() {
  const res = await getState();
  if (!res?.ok) return;
  const p = res.prefs || { preset: "none" };
  lastPrefs = p;

  if (!p || p.preset === "none") clearAll();
  else {
    ensureStylesheet();
    applyPrefs(p);
  }

  if (mo) mo.disconnect();
  mo = new MutationObserver(() => {
    if (!lastPrefs || lastPrefs.preset === "none") return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        applyPrefs(lastPrefs);
      } finally {
        debounceTimer = null;
      }
    }, 200);
  });
  mo.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true,
    attributes: false
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === MSG.INIT_CONTENT) {
    init().then(() => sendResponse({ ok: true }));
    return true;
  }
});

init();