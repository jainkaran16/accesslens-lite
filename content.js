// AccessLens Lite — Content Script (Chrome MV3)
const MSG = { GET_STATE: "ALL.GET_STATE", INIT_CONTENT: "ALL.INIT_CONTENT" };

let lastPrefs = null;
let mo = null;
let debounceTimer = null;

function setVar(name, val) { document.documentElement.style.setProperty(name, val); }
function clearVar(name) { document.documentElement.style.removeProperty(name); }

/* ---------- Skip link ---------- */
function ensureSkipLink(enabled) {
  const id="__accesslens_skip", mainId="__accesslens_main"; const el=document.getElementById(id);
  if(!enabled){ el?.remove(); return; }
  const insert=()=>{ if(document.getElementById(id))return;
    const a=document.createElement("a"); a.id=id; a.href=`#${mainId}`; a.textContent="Skip to content"; a.className="__accesslens_skip";
    document.body.prepend(a);
    if(!document.getElementById(mainId)){ const main=document.querySelector("main,[role='main']")||document.body; if(!main.id) main.id=mainId; }
  };
  if(document.body) insert(); else requestAnimationFrame(insert);
}

/* ---------- Legacy motion helper (kept) ---------- */
function setReduceMotion(enabled, pauseMedia) {
  document.documentElement.classList.toggle("all-reduce-motion", !!enabled);
  if (enabled && pauseMedia) {
    document.querySelectorAll("video, audio").forEach(m => { try{m.pause();}catch{} if (m.tagName==="VIDEO") m.autoplay=false; });
  }
}

/* ---------- Restore motion effects when motion flags are OFF ---------- */
function restoreMotionEffects(){
  // clear motion patch CSS
  try { if (typeof __allMotionStyle !== "undefined" && __allMotionStyle) __allMotionStyle.textContent = ""; } catch {}

  // restore autoplay + resume those paused by us
  document.querySelectorAll("video, audio").forEach(el=>{
    try {
      if (el.dataset.allHadAutoplay === "1") {
        el.setAttribute("autoplay", "");
      } else if (el.dataset.allHadAutoplay === "0") {
        el.removeAttribute("autoplay");
      }
      delete el.dataset.allHadAutoplay;

      if (el.dataset.allPausedByExt === "1") {
        el.play?.().catch(()=>{});
      }
      delete el.dataset.allPausedByExt;
    } catch {}
  });

  // unpause SVG
  document.querySelectorAll("svg").forEach(svg=>{
    try { if (typeof svg.unpauseAnimations==="function") svg.unpauseAnimations(); } catch {}
  });

  // resume lottie/bodymovin
  document.querySelectorAll("lottie-player").forEach(lp=>{
    try {
      if (lp.dataset.allPausedByExt === "1") lp.play?.();
      lp.removeAttribute("autoplay");
      delete lp.dataset.allPausedByExt;
    } catch{}
  });
  try {
    if (window.bodymovin?.animationItems) window.bodymovin.animationItems.forEach(a=>{ try{ if (a.__allPausedByExt) { a.play?.(); a.__allPausedByExt=false; } }catch{} });
    if (window.lottie?.getRegisteredAnimations) window.lottie.getRegisteredAnimations().forEach(a=>{ try{ if (a.__allPausedByExt) { a.play?.(); a.__allPausedByExt=false; } }catch{} });
  } catch {}

  // unfreeze GIFs
  document.querySelectorAll("img[data-all-gif-src]").forEach(img=>{
    try {
      if (img.dataset.__allFrozenGif === "1" && img.dataset.allGifSrc) {
        img.src = img.dataset.allGifSrc;
      }
      delete img.dataset.__allFrozenGif;
      delete img.dataset.allGifSrc;
    } catch {}
  });
}

/* ========== Robust motion patch (reversible) ========== */
let __allMotionStyle = null;
function applyMotionPrefs(m) {
  const rm       = !!m.reduceMotion;
  const snapOff  = !!m.disableScrollSnap;
  const parallax = !!m.stopParallax;

  document.documentElement.classList.toggle("all-reduce-motion", rm);
  document.documentElement.classList.toggle("all-no-snaps", snapOff);
  document.documentElement.classList.toggle("all-no-parallax", parallax);

  if (!__allMotionStyle) {
    __allMotionStyle = document.createElement("style");
    __allMotionStyle.id = "__all_motion_patch";
    document.documentElement.appendChild(__allMotionStyle);
  }
  const cssChunks = [];

  if (rm) {
    cssChunks.push(`
      :root { view-transition-name: none !important; }
      * { animation-play-state: paused !important; }
      html, body { scroll-behavior: auto !important; }
      html.all-reduce-motion::view-transition-old(*),
      html.all-reduce-motion::view-transition-new(*) {
        animation-duration: 0s !important; animation-delay: 0s !important;
      }
    `);
  }
  if (snapOff) {
    cssChunks.push(`* { scroll-snap-type:none!important; scroll-snap-align:none!important; scroll-snap-stop:normal!important; }`);
  }
  if (parallax) {
    cssChunks.push(`
      *[style*="background-attachment:fixed"] { background-attachment: scroll !important; }
      [data-parallax], .parallax, [class*="parallax"] { transform:none!important; will-change:auto!important; }
    `);
  }

  // If no motion flags are on, clear the patch CSS so site styles resume
  __allMotionStyle.textContent = cssChunks.length ? cssChunks.join("\n") : "";

  // ── Media (reversible) ──────────────────────────────────────────────
  if (m.pauseMedia) {
    document.querySelectorAll("video, audio").forEach(el=>{
      try {
        // Remember original autoplay so we can restore
        if (!el.dataset.allHadAutoplay) {
          el.dataset.allHadAutoplay = el.hasAttribute("autoplay") ? "1" : "0";
        }
        el.autoplay = false;
        el.removeAttribute("autoplay");

        // If it was playing, mark so we can resume later
        const wasPlaying = !el.paused && !el.ended;
        if (wasPlaying) el.dataset.allPausedByExt = "1";
        el.pause?.();
      } catch {}
    });
  }

  // SVG: pause only (do NOT remove animate nodes) so it’s reversible
  if (m.pauseSVG) {
    document.querySelectorAll("svg").forEach(svg=>{
      try { if (typeof svg.pauseAnimations==="function") svg.pauseAnimations(); } catch {}
    });
  }

  // Lottie/bodymovin: pause and mark so we can resume
  if (m.pauseLottie) {
    document.querySelectorAll("lottie-player").forEach(lp=>{
      try {
        if (!lp.dataset.allPausedByExt) lp.dataset.allPausedByExt = "1";
        lp.pause?.();
        lp.setAttribute("autoplay","false");
      } catch{}
    });
    try {
      if (window.bodymovin?.animationItems) window.bodymovin.animationItems.forEach(a=>{ try{ a.pause?.(); a.__allPausedByExt = true; }catch{} });
      if (window.lottie?.getRegisteredAnimations) window.lottie.getRegisteredAnimations().forEach(a=>{ try{ a.pause?.(); a.__allPausedByExt = true; }catch{} });
    } catch {}
  }

  // GIFs: freeze by swapping to first-frame dataURL, but keep original src to restore
  if (m.freezeGifs) {
    document.querySelectorAll('img[src$=".gif"], img[src*=".gif?"]').forEach(img=>{
      if (img.dataset.__allFrozenGif) return;
      try {
        const c=document.createElement("canvas");
        const ctx=c.getContext("2d",{willReadFrequently:true});
        const i=new Image();
        i.crossOrigin="anonymous"; i.decoding="async";

        if (!img.dataset.allGifSrc) img.dataset.allGifSrc = img.src;

        i.onload=()=>{
          try{
            c.width=i.naturalWidth; c.height=i.naturalHeight; ctx.drawImage(i,0,0);
            const dataURL = c.toDataURL("image/png");
            if (dataURL && dataURL.startsWith("data:image/png")) {
              img.src = dataURL;
              img.dataset.__allFrozenGif = "1";
            } else {
              delete img.dataset.allGifSrc;
            }
          }catch{}
        };
        i.onerror=()=>{ try{ delete img.dataset.allGifSrc; }catch{} };
        i.src=img.src;
      } catch {}
    });
  }
  // ───────────────────────────────────────────────────────────────────
}

/* ---------- Contrast helper ---------- */
function srgbToLin(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}
function luminance([r,g,b]){return 0.2126*srgbToLin(r)+0.7152*srgbToLin(g)+0.0722*srgbToLin(b)}
function contrast(fg,bg){const L1=Math.max(fg,bg)+0.05,L2=Math.min(fg,bg)+0.05;return L1/L2}
function parseRGB(str){const m=str.match(/\d+/g);return m?m.slice(0,3).map(Number):[0,0,0]}
function underlineLowContrastLinks(minRatio=4.5){
  const links=document.querySelectorAll("a");
  links.forEach(a=>a.classList.remove("all-low-contrast-underline"));
  links.forEach(a=>{
    const cs=getComputedStyle(a); if(cs.visibility==="hidden"||cs.display==="none")return;
    const fg=luminance(parseRGB(cs.color));
    let bgCol=cs.backgroundColor, node=a;
    while((bgCol==="rgba(0, 0, 0, 0)"||bgCol==="transparent")&&node.parentElement){ node=node.parentElement; bgCol=getComputedStyle(node).backgroundColor; }
    const bg=luminance(parseRGB(bgCol||"rgb(255,255,255)"));
    if(contrast(fg,bg)<minRatio)a.classList.add("all-low-contrast-underline");
  });
}
function clearLowContrastUnderline(){document.querySelectorAll("a.all-low-contrast-underline").forEach(a=>a.classList.remove("all-low-contrast-underline"));}

/* ---------- Reading tools ---------- */
let rulerEl=null, dimEl=null, moveHandler=null;
function setReadingTools(rt){
  const root=document.documentElement;
  root.classList.toggle("all-focus-mode",!!rt.focusMode);
  if(rt.focusMode){ if(!dimEl){ dimEl=document.createElement("div"); dimEl.className="all-dim-overlay"; document.body.appendChild(dimEl);} }
  else if(dimEl){ dimEl.remove(); dimEl=null; }
  if(rt.ruler){
    if(!rulerEl){
      rulerEl=document.createElement("div"); rulerEl.className="all-ruler"; document.body.appendChild(rulerEl);
      moveHandler=(e)=>{const h=parseInt(getComputedStyle(document.documentElement).getPropertyValue("--all-ruler-height"))||28;
        const y=(e.clientY||(e.touches?.[0]?.clientY||0))-h/2; rulerEl.style.top=`${Math.max(0,y)}px`;};
      document.addEventListener("mousemove",moveHandler,{passive:true});
      document.addEventListener("touchmove",moveHandler,{passive:true});
    }
  } else if(rulerEl){
    rulerEl.remove(); rulerEl=null;
    if(moveHandler){document.removeEventListener("mousemove",moveHandler);document.removeEventListener("touchmove",moveHandler);moveHandler=null;}
  }
}

/* ---------- Keyboard helpers ---------- */
const patchedInteractive = new Set();
function isVisible(el){ const cs=getComputedStyle(el); if(cs.visibility==="hidden"||cs.display==="none")return false; const r=el.getBoundingClientRect(); return r.width>0&&r.height>0; }
function isNaturallyFocusable(el){ if(el.matches("a[href], button, input, select, textarea, details, [tabindex]"))return true; if(el.hasAttribute("contenteditable"))return true; return false; }
function looksInteractive(el){ return el.hasAttribute("onclick")||el.matches("[role='button'],[role='link'],[role='tab'],[role='menuitem']")||el.matches("a, button, input, select, textarea, summary")||el.getAttribute("aria-pressed")!=null||el.getAttribute("aria-expanded")!=null; }
function patchInteractiveFocus(){ document.querySelectorAll("*").forEach(el=>{ if(!isVisible(el))return; if(!looksInteractive(el))return; if(isNaturallyFocusable(el))return;
  el.setAttribute("tabindex","0"); el.classList.add("all-patched-focus");
  const handler=(ev)=>{ if(ev.key==="Enter"||ev.key===" "){ ev.preventDefault(); el.click?.(); } };
  el.addEventListener("keydown",handler); patchedInteractive.add({el,handler});
});}
function unpatchInteractiveFocus(){ document.querySelectorAll(".all-patched-focus").forEach(el=>{ el.classList.remove("all-patched-focus"); if(el.getAttribute("tabindex")==="0") el.removeAttribute("tabindex"); });
  for(const item of patchedInteractive){ try{ item.el.removeEventListener("keydown",item.handler);}catch{} } patchedInteractive.clear();
}

let navIndex=[], navCurrent=-1; const navTagged=new Set();
function collectNavigables(){ const nodes=document.querySelectorAll("h1,h2,h3,h4,h5,h6,main,section,article,p,li,[role='heading']");
  navIndex=[]; nodes.forEach(el=>{ if(!isVisible(el))return; const had=el.hasAttribute("tabindex"); if(!had) el.setAttribute("tabindex","-1"); el.classList.add("all-nav-target"); navIndex.push(el); navTagged.add(el); });}
function clearNavigables(){ for(const el of navTagged){ if(el.getAttribute("tabindex")==="-1") el.removeAttribute("tabindex"); el.classList.remove("all-nav-target"); } navTagged.clear(); navIndex=[]; navCurrent=-1; }
function focusByIndex(i){ if(navIndex.length===0)return; navCurrent=(i+navIndex.length)%navIndex.length; const el=navIndex[navCurrent]; try{el.focus({preventScroll:false});}catch{el.focus();} el.scrollIntoView({block:"center",inline:"nearest",behavior:"smooth"}); }
function nextNavigable(){ focusByIndex(navCurrent+1); } function prevNavigable(){ focusByIndex(navCurrent-1); }
function bindNavHotkeys(enabled){ document.removeEventListener("keydown",navKeydownHandler,true); if(enabled){ document.addEventListener("keydown",navKeydownHandler,true); } }
function navKeydownHandler(e){ if(e.altKey&&e.shiftKey&&!e.ctrlKey&&!e.metaKey){ if(e.key==="ArrowDown"){e.preventDefault();nextNavigable();} else if(e.key==="ArrowUp"){e.preventDefault();prevNavigable();} } }

/* ===================== Low Vision — typography-only (no layout clamping) ===================== */

let __allLVStyle = null;

function clearUnclampMarks() {
  document.querySelectorAll('[data-all-unclamp]').forEach(el => el.removeAttribute('data-all-unclamp'));
}

/* Low Vision now: only sticky-header padding + heading scroll margins; no width/column shaping */
function applyFocusNotObscured() {
  // sticky header padding
  const tops = [...document.querySelectorAll('*')].filter(el => {
    const cs = getComputedStyle(el);
    if (!['fixed','sticky'].includes(cs.position)) return false;
    const r = el.getBoundingClientRect();
    if (r.top > 8) return false;
    if (r.height < 40 || r.width < 200) return false;
    return r.left <= 40 && r.right >= (window.innerWidth - 40);
  });
  const h = tops.length ? Math.min(200, Math.max(...tops.map(el => el.getBoundingClientRect().height))) : 0;

  // ensure any previous marks are cleared so nothing remains narrowed
  document.querySelectorAll('[data-all-measure]').forEach(n => n.removeAttribute('data-all-measure'));
  clearUnclampMarks();

  if (!__allLVStyle) {
    __allLVStyle = document.createElement('style');
    __allLVStyle.id = "__all_lv_patch";
    document.documentElement.appendChild(__allLVStyle);
  }

  const pad = h ? `${Math.ceil(h)+8}px` : "";
  document.documentElement.style.scrollPaddingTop = pad;

  __allLVStyle.textContent = `
    ${h ? `
      html.all-lowvision :is(h1,h2,h3,h4,h5,h6,a[name],a[id],[id]) {
        scroll-margin-top: ${Math.ceil(h)+8}px !important;
      }
    ` : ``}

    /* Low Vision now only adjusts typography via CSS variables set in applyPrefs(). */
  `;

  // re-check once in case late banners appear
  clearTimeout(applyFocusNotObscured._t);
  applyFocusNotObscured._t = setTimeout(() => {
    const again = [...document.querySelectorAll('*')].some(el => {
      const cs = getComputedStyle(el);
      if (!['fixed','sticky'].includes(cs.position)) return false;
      const r = el.getBoundingClientRect();
      return r.top <= 8 && r.height >= 40 && r.width > 200;
    });
    if (again) applyFocusNotObscured();
  }, 600);
}

/* ---------- Colour-blind Assist (unchanged logic) ---------- */
const CB_MATS = {
  deuteranopia: [0.625,0.375,0.000, 0.700,0.300,0.000, 0.000,0.300,0.700],
  protanopia:   [0.567,0.433,0.000, 0.558,0.442,0.000, 0.000,0.242,0.758],
  tritanopia:   [0.950,0.050,0.000, 0.000,0.433,0.567,  0.000,0.475,0.525]
};
let cbFilterEl = null, cbMatrixEl = null;
function ensureCBFilter(){
  if (cbFilterEl && cbMatrixEl && document.contains(cbFilterEl)) return;
  const svg = document.getElementById("__all_cb_svg");
  if (svg) { cbFilterEl = svg.querySelector("#__all_cb_filter"); cbMatrixEl = svg.querySelector("#__all_cb_matrix"); }
  if (!cbFilterEl) {
    const s = document.createElementNS("http://www.w3.org/2000/svg","svg");
    s.setAttribute("id","__all_cb_svg"); s.setAttribute("style","position:absolute;width:0;height:0;overflow:hidden");
    const f = document.createElementNS("http://www.w3.org/2000/svg","filter");
    f.setAttribute("id","__all_cb_filter");
    const m = document.createElementNS("http://www.w3.org/2000/svg","feColorMatrix");
    m.setAttribute("id","__all_cb_matrix"); m.setAttribute("type","matrix");
    f.appendChild(m); s.appendChild(f); document.body.appendChild(s);
    cbFilterEl = f; cbMatrixEl = m;
  }
}
function setCBMatrix(type, strengthPct){
  ensureCBFilter();
  const t = CB_MATS[type]; if (!t){ cbDisable(); return; }
  const s = Math.max(0, Math.min(100, strengthPct||0)) / 100;
  const ident = [1,0,0, 0,1,0, 0,0,1];
  const mat = ident.map((v,i)=> v*(1-s) + t[i]*s);
  const vals = [
    mat[0], mat[1], mat[2], 0, 0,
    mat[3], mat[4], mat[5], 0, 0,
    mat[6], mat[7], mat[8], 0, 0,
    0, 0, 0, 1, 0
  ].map(n=>Number(n).toFixed(6)).join(' ');
  cbMatrixEl.setAttribute("values", vals);
  document.documentElement.style.filter = "url(#__all_cb_filter)";
  document.documentElement.classList.add("all-cb-sim");
}
function cbDisable(){
  document.documentElement.style.filter = "";
  document.documentElement.classList.remove("all-cb-sim","all-cb-noimg","al-always-underline","al-visited-dash");
  document.querySelectorAll(".all-audit-color-only").forEach(el=>el.classList.remove("all-audit-color-only"));
}
function applyCues(p){
  document.documentElement.classList.toggle("al-always-underline", !!p.alwaysUnderline);
  document.documentElement.classList.toggle("al-visited-dash", !!p.visitedDashed);
  if (p.audit){
    document.querySelectorAll("a").forEach(a=>{
      const cs = getComputedStyle(a);
      const isUnderlined = (cs.textDecorationLine||"").includes("underline");
      if (!isUnderlined) a.classList.add("all-audit-color-only");
    });
  } else {
    document.querySelectorAll(".all-audit-color-only").forEach(a=>a.classList.remove("all-audit-color-only"));
  }
}

/* ---------- Apply / Clear ---------- */
function applyPrefs(p){
  p = p || {};
  const t  = p.typography   || {};
  const k  = p.keyboard     || {};
  const m  = p.motion       || {};
  const rt = p.readingTools || {};
  const co = p.contrast     || {};
  const cb = p.colorBlind   || {};

  lastPrefs = p;
  const active = p.preset && p.preset !== "none";
  document.documentElement.classList.toggle("all-enabled", !!active);

  // Typography
  setVar("--all-min-font", `${(t.minFontSizePx ?? 26)}px`);
  setVar("--all-line-height", (t.lineHeight ?? 1.6));
  setVar("--all-letter-spacing", `${(t.letterSpacingEm ?? 0.06)}em`);
  setVar("--all-word-spacing", `${(t.wordSpacingEm ?? 0.1)}em`);

  // Low Vision
  const isLowVision = p.preset === "low-vision";
  document.documentElement.classList.toggle("all-lowvision", isLowVision);
  // Keep a sensible fallback so first-run LV isn't skinny (no actual clamping now).
  setVar("--all-max-measure", `${(t.maxMeasureCh ?? 84)}ch`);
  if (isLowVision) applyFocusNotObscured(); else {
    document.documentElement.style.scrollPaddingTop = "";
    clearUnclampMarks();
  }

  // Keyboard
  document.documentElement.classList.toggle("all-strong-focus", !!k.strongFocusRing);
  ensureSkipLink(!!k.skipToContent);

  // helpers
  unpatchInteractiveFocus();
  clearNavigables();
  if (k.patchInteractive) patchInteractiveFocus();
  if (k.navigateSections) collectNavigables();
  bindNavHotkeys(!!k.navigateSections);

  // Motion
  const anyMotion =
    !!(m.reduceMotion || m.disableScrollSnap || m.stopParallax ||
       m.pauseMedia   || m.pauseSVG         || m.pauseLottie   || m.freezeGifs);

  applyMotionPrefs(m);
  setReduceMotion(!!m.reduceMotion, !!m.pauseMedia);

  // If current preset has no motion flags, actively restore anything we paused earlier
  if (!anyMotion) {
    restoreMotionEffects();
  }

  // Reading tools
  setVar("--all-ruler-height", `${(rt.rulerHeightPx ?? 28)}px`);
  setVar("--all-focus-padding", `${(rt.focusPaddingPx ?? 12)}px`);
  setReadingTools(rt);

  // Colour-blind Assist
  cbDisable();
  if (cb.simulate && cb.simulate !== "off") {
    setCBMatrix(cb.simulate, cb.strength ?? 60);
    document.documentElement.classList.toggle("all-cb-noimg", !cb.applyToImages);
  }
  if (cb.redundantCues || cb.alwaysUnderline || cb.visitedDashed || cb.audit) applyCues(cb);

  // Link contrast helper
  clearLowContrastUnderline();
  if (co.underlineLowContrastLinks) underlineLowContrastLinks(co.minRatio ?? 4.5);
}

function clearAll(){
  lastPrefs = { preset: "none" };
  document.documentElement.classList.remove(
    "all-enabled","all-strong-focus","all-reduce-motion","all-focus-mode",
    "all-cb-deut","all-cb-prot","all-cb-trit","all-lowvision",
    "all-cb-sim","all-cb-noimg","al-always-underline","al-visited-dash",
    "all-no-snaps","all-no-parallax"
  );
  clearVar("--all-min-font"); clearVar("--all-line-height"); clearVar("--all-letter-spacing"); clearVar("--all-word-spacing");
  clearVar("--all-ruler-height"); clearVar("--all-focus-padding"); clearVar("--all-max-measure");
  document.documentElement.style.scrollPaddingTop = ""; document.documentElement.style.filter = "";
  clearUnclampMarks();

  // Restore motion effects (same as when anyMotion===false)
  restoreMotionEffects();

  ensureSkipLink(false);
  bindNavHotkeys(false); unpatchInteractiveFocus(); clearNavigables();

  if(rulerEl){rulerEl.remove();rulerEl=null;if(moveHandler){document.removeEventListener("mousemove",moveHandler);document.removeEventListener("touchmove",moveHandler);moveHandler=null;}}
  if(dimEl){dimEl.remove();dimEl=null;}

  clearLowContrastUnderline();
  document.querySelectorAll(".all-audit-color-only").forEach(a=>a.classList.remove("all-audit-color-only"));
}

function getState(){ return new Promise(resolve=>chrome.runtime.sendMessage({type:MSG.GET_STATE},resolve)); }

async function init(){
  const res = await getState(); if (!res?.ok) return;
  const p = res.prefs || { preset: "none" }; lastPrefs = p;

  if (!p || p.preset === "none") clearAll(); else applyPrefs(p);

  if (mo) mo.disconnect();
  mo = new MutationObserver(() => {
    if (!lastPrefs || lastPrefs.preset === "none") return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { try{ applyPrefs(lastPrefs); } finally { debounceTimer=null; } }, 200);
  });
  mo.observe(document.documentElement || document.body, { childList: true, subtree: true, attributes: false });
}

chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
  if(msg.type===MSG.INIT_CONTENT){ init().then(()=>sendResponse({ok:true})); return true; }
});

init();
