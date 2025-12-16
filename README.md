# AccessLens Lite

A Chrome MV3 extension that makes any site easier to read and navigate—fast, respectful, and reversible.  
Presets for **Low-Vision**, **Motion-Sensitive**, **Color-Blind**, **Keyboard-Only**, and **Reading-Comfort**, plus a **Custom** mode for fine-tuning typography, contrast, and reading tools.

---

## ✨ Features

- **Typography controls:** minimum font size, line/word/letter spacing, optional max measure (ch).
- **Reading aids:** highlight ruler, focus dimmer, strong focus ring, “Skip to content,” section navigation.
- **Contrast & link clarity:** underline low-contrast links, visited differentiation.
- **Motion controls:** pause/limit CSS animations, scroll-snap, parallax, video/audio/SVG/Lottie, reversible GIF freeze.
- **Color-blind assist:** simulation filters (deuteranopia/protanopia/tritanopia), redundant link cues.
- **Reading-Comfort preset:** optional light/dark/sepia theme, paragraph rhythm, ragged-right (no justify), no hyphenation, optional image softening, tame sticky bars.
- **Scoped & safe:** no heavy DOM rewrites; all changes are injected CSS/patches and fully reversible.

---

## 🧭 Presets

- **Low-Vision:** bumps type/spacing + applies a readable max measure (ch) to the main content area, increases link-contrast strictness, and enables skip link + section navigation + focus/keyboard patches.
- **Motion-Sensitive:** reduces animations (also disables scroll-snap), pauses autoplay media (video/audio + Lottie when present; GIF freeze is best-effort and reversible), and enables skip link + section navigation + interactive focus patching.
- **Color-Blind:** enables simulation (default deuteranopia) + redundant link cues, and also turns on skip link + section navigation + focus/keyboard patches.
- **Keyboard-Only:** skip link + section navigation + interactive focus patching (and it also enables reduce motion).
- **Reading-Comfort:** typography for long reads + enables ruler + focus dimmer and turns on skip link + section navigation + focus/keyboard patches.
- **Custom:** mix your own (all controls exposed in the popup).

---

## 🚀 Install (Developer Mode)

1. **Clone / download** this repo.
2. Open **Chrome → Settings → Extensions**.
3. Toggle **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder.

---

## 🧰 Usage

1. Click the extension icon to open the **popup**.
2. Choose a **Preset** or switch to **Custom** and tweak:
   - Typography: min font, line height, spacing, max measure (ch)
   - Motion: reduce animations, pause media, disable scroll-snap/parallax
   - Reading tools: ruler, focus dimmer, padding
   - Contrast & color-blind options
3. **Apply** to the current tab. **Clear** to revert everything on the page.

**Keyboard helpers**
- `Alt` + `Shift` + `↓` / `↑`: jump between major sections/headings (when enabled).

---

## 🔐 Privacy

- No analytics, no tracking, no network requests.  
- Preferences are stored locally via Chrome `storage.sync`.

---

## 🛠 Development Notes

- MV3 with message flow: **Popup → Service Worker → Content Script**.
- Preferences deep-merged over defaults; presets are clean overlays.
- Motion patches are **reversible**:
  - Videos/audio: original autoplay noted & restored; items paused by the extension are resumed on clear.
  - SVG/Lottie: pause/unpause only (no node deletions).
  - GIFs: first-frame freeze stores original `src` and restores it on clear.
- Low-Vision avoids global width clamping; typography is controlled via CSS variables.

---

## 🧪 Troubleshooting

- **“Could not establish connection. Receiving end does not exist.”**  
  Make sure a tab is active and the content script is loaded; re-open the popup and press **Apply** again.

- **Media stays paused after switching presets or clearing:**  
  Use **Clear** in the popup (it restores autoplay flags, resumes items paused by the extension, unfreezes GIFs, and unpauses SVG/Lottie).

- **Site layout looks squeezed:**  
  Ensure **Low-Vision** is using typography-only mode (no clamping). Adjust **Max measure (ch)** in **Custom** if needed.

---

## 🧩 Known Limits

- Some pages with aggressive inline styles or CSP may partially ignore injected CSS.
- GIF unfreeze relies on restoring the original `src`; cross-origin edge cases may prevent canvas reads (we skip those safely).
- Color-blind simulation uses SVG filters; rare sites with heavy root filters may conflict.

---

## 🤝 Contributing

Issues and PRs welcome! Please keep changes **scoped** and **reversible**, and prefer CSS variable knobs over DOM rewrites.
