// AccessLens Lite — Popup (Chrome MV3)
const MSG = {
  GET_STATE: "ALL.GET_STATE",
  APPLY_PRESET: "ALL.APPLY_PRESET",
  CLEAR: "ALL.CLEAR",
  INIT_CONTENT: "ALL.INIT_CONTENT",
  SET_PREFS: "ALL.SET_PREFS"
};

const $ = s => document.querySelector(s);
const status = $("#status");
const presetSel = $("#preset");
const customBox = $("#customBox");

const fields = {
  typoFont: $("#typoFont"),
  typoLH: $("#typoLH"),
  typoLS: $("#typoLS"),
  typoWS: $("#typoWS"),
  // NEW: Max measure (ch)
  typoMeasure: $("#typoMeasure"),

  // Motion 
  reduceMotion: $("#reduceMotion"),
  pauseMedia: $("#pauseMedia"),
  disableSnap: $("#disableSnap"),
  stopParallax: $("#stopParallax"),
  pauseSVG: $("#pauseSVG"),
  pauseLottie: $("#pauseLottie"),
  freezeGifs: $("#freezeGifs"),

  // Keyboard
  strongFocus: $("#strongFocus"),
  skipToContent: $("#skipToContent"),
  navigateSections: $("#navigateSections"),
  patchInteractive: $("#patchInteractive"),

  // Reading Tools
  ruler: $("#ruler"),
  rulerH: $("#rulerH"),
  focusMode: $("#focusMode"),
  focusPad: $("#focusPad"),

  // Contrast
  underlineLinks: $("#underlineLinks"),
  minRatio: $("#minRatio"),

  // Colour-blind Assist
  cbSim: $("#cbSim"),
  cbStrength: $("#cbStrength"),
  cbImages: $("#cbImages"),
  cbCues: $("#cbCues"),
  alwaysUnderline: $("#alwaysUnderline"),
  visitedDashed: $("#visitedDashed"),
  cbAudit: $("#cbAudit")
};

function send(msg){ return new Promise(resolve => chrome.runtime.sendMessage(msg, resolve)); }

// Safely notify the active tab (avoids errors on chrome://, Web Store, PDFs, etc.)
async function notifyActiveTabInit() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const url = tab.url || "";
    const allowed = /^(https?:|file:)/i.test(url); // file:// needs "Allow access to file URLs"
    if (!allowed) return;

    chrome.tabs.sendMessage(tab.id, { type: MSG.INIT_CONTENT }, () => {
      // Swallow common errors if receiving end doesn't exist
      void chrome.runtime.lastError;
    });
  } catch {
    /* no-op */
  }
}

async function refresh(){
  const res = await send({ type: MSG.GET_STATE });
  if(!res?.ok){ status.textContent = "Unable to load state."; return; }
  const p = res.prefs || {};

  presetSel.value = p.preset || "none";

  // Typography
  fields.typoFont.value    = p.typography?.minFontSizePx ?? 16;
  fields.typoLH.value      = p.typography?.lineHeight ?? 1.6;
  fields.typoLS.value      = p.typography?.letterSpacingEm ?? 0.02;
  fields.typoWS.value      = p.typography?.wordSpacingEm ?? 0.04;
  // NEW: Max measure (ch)
  fields.typoMeasure.value = p.typography?.maxMeasureCh ?? 80;

  // Motion
  fields.reduceMotion.checked = !!p.motion?.reduceMotion;
  fields.pauseMedia.checked   = !!p.motion?.pauseMedia;
  fields.disableSnap.checked  = !!p.motion?.disableScrollSnap;
  fields.stopParallax.checked = !!p.motion?.stopParallax;
  fields.pauseSVG.checked     = !!p.motion?.pauseSVG;
  fields.pauseLottie.checked  = !!p.motion?.pauseLottie;
  fields.freezeGifs.checked   = !!p.motion?.freezeGifs;

  // Keyboard
  fields.strongFocus.checked      = !!p.keyboard?.strongFocusRing;
  fields.skipToContent.checked    = !!p.keyboard?.skipToContent;
  fields.navigateSections.checked = !!p.keyboard?.navigateSections;
  fields.patchInteractive.checked = !!p.keyboard?.patchInteractive;

  // Reading Tools
  fields.ruler.checked     = !!p.readingTools?.ruler;
  fields.rulerH.value      = p.readingTools?.rulerHeightPx ?? 28;
  fields.focusMode.checked = !!p.readingTools?.focusMode;
  fields.focusPad.value    = p.readingTools?.focusPaddingPx ?? 12;

  // Contrast
  fields.underlineLinks.checked = !!p.contrast?.underlineLowContrastLinks;
  fields.minRatio.value         = p.contrast?.minRatio ?? 4.5;

  // Colour-blind Assist
  fields.cbSim.value            = p.colorBlind?.simulate ?? "off";
  fields.cbStrength.value       = p.colorBlind?.strength ?? 60;
  fields.cbImages.checked       = !!p.colorBlind?.applyToImages;
  fields.cbCues.checked         = !!p.colorBlind?.redundantCues;
  fields.alwaysUnderline.checked= !!p.colorBlind?.alwaysUnderline;
  fields.visitedDashed.checked  = !!p.colorBlind?.visitedDashed;
  fields.cbAudit.checked        = !!p.colorBlind?.audit;

  status.textContent = JSON.stringify(p, null, 2);
  customBox.open = presetSel.value === "custom";
}

$("#apply").addEventListener("click", async ()=>{
  const key = presetSel.value;
  if (key === "none") {
    await send({ type: MSG.CLEAR });
  } else if (key === "custom") {
    await saveCustom();
  } else {
    const r = await send({ type: MSG.APPLY_PRESET, presetKey: key });
    if (!r?.ok) return;
  }
  await notifyActiveTabInit();
  refresh();
});

$("#clear").addEventListener("click", async ()=>{
  await send({ type: MSG.CLEAR });
  await notifyActiveTabInit();
  refresh();
});

$("#saveCustom").addEventListener("click", async ()=>{
  await saveCustom();
  await notifyActiveTabInit();
  refresh();
});

presetSel.addEventListener("change", ()=>{
  customBox.open = presetSel.value === "custom";
});

async function saveCustom(){
  const patch = {
    typography: {
      minFontSizePx:  num(fields.typoFont, 16),
      lineHeight:     num(fields.typoLH, 1.6),
      letterSpacingEm:num(fields.typoLS, 0.02),
      wordSpacingEm:  num(fields.typoWS, 0.04),
      // NEW: persist Max measure (ch)
      maxMeasureCh:   num(fields.typoMeasure, 80)
    },
    motion: {
      reduceMotion:      bool(fields.reduceMotion),
      pauseMedia:        bool(fields.pauseMedia),
      disableScrollSnap: bool(fields.disableSnap),
      stopParallax:      bool(fields.stopParallax),
      pauseSVG:          bool(fields.pauseSVG),
      pauseLottie:       bool(fields.pauseLottie),
      freezeGifs:        bool(fields.freezeGifs)
    },
    keyboard: {
      strongFocusRing:  bool(fields.strongFocus),
      skipToContent:    bool(fields.skipToContent),
      navigateSections: bool(fields.navigateSections),
      patchInteractive: bool(fields.patchInteractive)
    },
    readingTools: {
      ruler:          bool(fields.ruler),
      rulerHeightPx:  num(fields.rulerH, 28),
      focusMode:      bool(fields.focusMode),
      focusPaddingPx: num(fields.focusPad, 12)
    },
    contrast: {
      underlineLowContrastLinks: bool(fields.underlineLinks),
      minRatio: num(fields.minRatio, 4.5)
    },
    colorBlind: {
      simulate:        fields.cbSim.value || "off",
      strength:        num(fields.cbStrength, 60),
      applyToImages:   bool(fields.cbImages),
      redundantCues:   bool(fields.cbCues),
      alwaysUnderline: bool(fields.alwaysUnderline),
      visitedDashed:   bool(fields.visitedDashed),
      audit:           bool(fields.cbAudit)
    }
  };
  await send({ type: MSG.SET_PREFS, patch });
  presetSel.value = "custom";
}

function num(input, fallback){ const v = parseFloat(input.value); return Number.isFinite(v) ? v : fallback; }
function bool(input){ return !!input.checked; }

refresh();
