// AccessLens Lite — Background (Chrome MV3)

// Messages
const MSG = {
  GET_STATE: "ALL.GET_STATE",
  APPLY_PRESET: "ALL.APPLY_PRESET",
  CLEAR: "ALL.CLEAR",
  INIT_CONTENT: "ALL.INIT_CONTENT",
  SET_PREFS: "ALL.SET_PREFS"
};

const SKEY = "ALL_PREFS_V1";

// Defaults
const DEFAULT_PREFS = {
  preset: "none", // none | custom | low-vision | color-blind | motion-sensitive | keyboard-only | reading-comfort
  typography: { minFontSizePx: 16, lineHeight: 1.6, letterSpacingEm: 0.02, wordSpacingEm: 0.04, maxMeasureCh: 80 },
  contrast: { underlineLowContrastLinks: true, minRatio: 4.5 },

  // Motion defaults — OFF by default
  motion: {
    reduceMotion: false,
    pauseMedia: false,
    disableScrollSnap: false,
    stopParallax: false,
    pauseSVG: false,
    pauseLottie: false,
    freezeGifs: false
  },

  keyboard: {
    strongFocusRing: true,
    skipToContent: true,
    navigateSections: false,
    patchInteractive: false
  },

  readingTools: { ruler: false, rulerHeightPx: 28, focusMode: false, focusPaddingPx: 12 },

  colorBlind: {
    simulate: "off",          // off | deuteranopia | protanopia | tritanopia
    strength: 60,             // 0-100
    applyToImages: false,     // exclude <img>/<video>/<canvas> by default
    redundantCues: true,      // add extra link cues etc.
    alwaysUnderline: false,   // force underline on all links
    visitedDashed: false,     // dashed underline for :visited
    audit: false,             // highlight color-only cues (simple audit)
    paletteRemap: false       // placeholder flag (not heavy-handed)
  }
};

// Presets
const PRESETS = {
  "low-vision": {
    preset: "low-vision",
    // No motion block — LV does NOT change motion.
    typography: { minFontSizePx: 26, lineHeight: 1.6, letterSpacingEm: 0.06, wordSpacingEm: 0.1, maxMeasureCh: 84 },
    contrast: { underlineLowContrastLinks: true, minRatio: 7.0 },
    keyboard: { strongFocusRing: true, skipToContent: true, navigateSections: true, patchInteractive: true },
    motion: {
      reduceMotion:     false,
      pauseMedia:       false,
      disableScrollSnap:false,
      stopParallax:     false,
      pauseSVG:         false,
      pauseLottie:      false,
      freezeGifs:       false
    }
  },

  "color-blind": {
    preset: "color-blind",
    colorBlind: {
      simulate: "deuteranopia",
      strength: 60,
      applyToImages: false,
      redundantCues: true,
      alwaysUnderline: false,
      visitedDashed: false,
      audit: false,
      paletteRemap: false
    },
    contrast: { underlineLowContrastLinks: true, minRatio: 4.5 },
    keyboard: { strongFocusRing: true, skipToContent: true, navigateSections: true, patchInteractive: true }
  },

  "motion-sensitive": {
    preset: "motion-sensitive",
    motion: {
      reduceMotion: true,
      pauseMedia: true,
      disableScrollSnap: true,
      stopParallax: true,
      pauseSVG: true,
      pauseLottie: true,
      freezeGifs: false
    },
    keyboard: { strongFocusRing: true, skipToContent: true, navigateSections: true, patchInteractive: true }
  },

  "keyboard-only": {
    preset: "keyboard-only",
    keyboard: { strongFocusRing: true, skipToContent: true, navigateSections: true, patchInteractive: true },
    motion: { reduceMotion: true }
  },

  "reading-comfort": {
    preset: "reading-comfort",
    typography: { minFontSizePx: 17, lineHeight: 1.7 },
    readingTools: { focusMode: true, focusPaddingPx: 16 },
    keyboard: { strongFocusRing: true, skipToContent: true, navigateSections: true, patchInteractive: true }
  }
};

// Utils
function deepMerge(dst, src) {
  for (const k of Object.keys(src)) {
    if (src[k] && typeof src[k] === "object" && !Array.isArray(src[k])) {
      dst[k] = deepMerge(dst[k] || {}, src[k]);
    } else {
      dst[k] = src[k];
    }
  }
  return dst;
}

async function getPrefs() {
  const obj = await chrome.storage.sync.get(SKEY);
  return Object.keys(obj).length ? obj[SKEY] : structuredClone(DEFAULT_PREFS);
}
async function setPrefs(prefs) {
  await chrome.storage.sync.set({ [SKEY]: prefs });
}

// Build new prefs = preset fields + defaults for the rest (no carryover from previous preset)
function applyPresetClean(preset) {
  const out = structuredClone(DEFAULT_PREFS);
  // For every top-level key in the preset, merge it over the defaults for that key
  for (const k of Object.keys(preset)) {
    if (k === "preset") continue; // set explicitly below
    if (k in out) {
      out[k] = deepMerge(structuredClone(out[k]), preset[k]);
    } else {
      out[k] = structuredClone(preset[k]);
    }
  }
  out.preset = preset.preset || "none";
  return out;
}

// Router
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg.type) {
        case MSG.GET_STATE: {
          const prefs = await getPrefs();
          sendResponse({ ok: true, prefs });
          break;
        }
        case MSG.APPLY_PRESET: {
          const preset = PRESETS[msg.presetKey];
          if (!preset) return sendResponse({ ok: false, error: "Unknown preset" });

          // IMPORTANT: Clean application — preset + defaults (no previous-preset leftovers)
          const merged = applyPresetClean(preset);

          await setPrefs(merged);
          if (sender?.tab?.id) chrome.tabs.sendMessage(sender.tab.id, { type: MSG.INIT_CONTENT });
          sendResponse({ ok: true });
          break;
        }
        case MSG.SET_PREFS: {
          const base = await getPrefs();
          const patch = msg.patch || {};
          const merged = deepMerge(structuredClone(base), patch);
          merged.preset = "custom";
          await setPrefs(merged);
          if (sender?.tab?.id) chrome.tabs.sendMessage(sender.tab.id, { type: MSG.INIT_CONTENT });
          sendResponse({ ok: true });
          break;
        }
        case MSG.CLEAR: {
          const cleared = deepMerge(structuredClone(DEFAULT_PREFS), { preset: "none" });
          await setPrefs(cleared);
          if (sender?.tab?.id) chrome.tabs.sendMessage(sender.tab.id, { type: MSG.INIT_CONTENT });
          sendResponse({ ok: true });
          break;
        }
        default:
          sendResponse({ ok: false, error: "Unknown message" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // async
});
