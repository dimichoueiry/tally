# Tally — Setup v2: in-context setup

Status: **approved 2026-10-21** with these answers: Area and Camera-only come later; Clean desktop off on first run; ⌥⇧R stays instant record; lock button dropped. **§11 (camera size) and §12 (speaker notes) are a new proposal awaiting approval.** Mockups: `design/setup-v2.html` (+ `setup-v2.css`). Screenshots: `design/shots-v2/`. Builds on `DESIGN_SPEC.md`; where this file is silent, v1 still applies.

Learned from Loom's recorder (patterns only, no assets, icons, colours or brand): set up on the real screen, with direct manipulation, with the clean-desktop cover already applied, so what you see is what records.

---

## 1. The flow

1. **Open setup.** Click the menu-bar/tray icon. On that display:
   - the **setup toolbar** appears bottom-centre, 16 pt above the Dock/taskbar;
   - the **camera bubble** appears at its remembered position with its **tray** attached underneath;
   - the chosen **cover** is applied to the real desktop immediately (the cover helper starts now, not at Record).
2. **Adjust in place.** Pick a source in the toolbar; drag/resize the bubble; change zoom, shape and background in the tray; pick a cover from the swatch. Everything is live.
3. **Record.** Click Record, press Return (Record has initial focus) or ⌥⇧R. The toolbar folds into the countdown bar, the tray disappears, green selection edges turn red, the 3 s countdown runs.
4. **Recording.** The pill is now the v1 control bar (same controls, same shortcuts, same confirm-pauses rule D3).
5. **Stop.** Pill fades, post-stop popup (v1 §3.5). Next setup opens with the same choices.

Esc during the countdown returns to **setup** (all choices intact), not to nothing. Esc in setup closes the open popover first, then setup itself (cover removed, bubble hidden).

### What happens to the launcher popover

**Removed.** Everything it did moves:

| Popover piece | v2 home |
|---|---|
| Display / Window tabs, display tiles, window list | Toolbar source group + on-screen pickers (§3) |
| Camera row (device, shape, size, zoom, background) | Bubble tray + its camera-settings popover |
| Clean desktop row | Toolbar cover swatch + cover picker |
| System audio switch | Toolbar toggle (where Loom has a mic) **and** a labelled row in More |
| Quality row | More menu |
| Recordings / Settings header buttons | More menu; also the tray icon's right-click menu |
| Banners (permission, disk, shortcut in use) | One glass notice line pinned above the toolbar; Record disabled with the reason right there |
| Meta line (save folder, free space) | Settings; free space only shown when < 5 GB (as a notice) |

### ⌥⇧R

Unchanged from D2/D6: **always registered**.
- Setup closed, idle → **records instantly** with the last setup (no setup UI), display under the pointer in Full-screen mode. Area mode: last area on that display if it has one, else full screen. Window mode: last window if still open, else display under the pointer.
- Setup open → same as clicking Record.
- Recording/paused → Stop.

P/Z/X/C stay registered only during a recording session (D2). Tooltips show all five.

## 2. Menu-bar / tray icon

- **Left-click:** toggle setup on the display that owns that menu bar (Windows: the display with the taskbar clicked). While recording: stop (v1).
- **Right-click** (Ctrl-click on Mac): small native menu: New recording ⌥⇧R · Recordings… · Settings… · Quit Tally. Works without opening setup.
- Icon state: outline lens idle; filled while setup is open (`tray on` in the mockups); red lens + timer while recording (v1).

## 3. Components

### 3.1 Setup toolbar (`01`, `02`, `02b`)
> §12 adds a **Notes** button between system audio and the cover swatch, and §11.3 lets the toolbar slide clear of a large bubble.

Order: **× · [Full screen | Window | Area | Camera only] · camera · system audio · cover · … · Record**.
- 56 pt pill, glass `rgba(16,20,19,.80)` + 28 px blur + saturate 1.6, top highlight, `--shadow-2`. Controls 40 pt; Record 44 pt.
- The **active source shows its label** (and what was picked: "Acme Dashboard", "768 × 432"). Inactive sources are icon-only with tooltips.
- Toggles: on = full-contrast icon; off = a slashed icon (camera-off, speaker-off). Never dimming alone.
- Cover button shows the current cover as a swatch; disabled in Window and Camera-only modes (nothing of the desktop records).
- **Record** is the only filled control (green `--ready`, red lens dot, ⌥⇧R keycap). Label and width never change by mode, so nothing jumps under the pointer.
- ~~No microphone control anywhere.~~ Policy change (Oct 2026): an **optional microphone**, off by default. Toolbar toggle right after system audio; a *Microphone* row in More with the device list and a live level meter (the mic opens only while More is open, or while recording); a *microphone on* status icon in the folded pill (S22). macOS permission is asked only when it is turned on; denied → a message and **Open Settings** (Privacy & Security › Microphone).
- Loom's lock button is **not** carried over (no Tally feature maps to it).

### 3.2 Bubble tray (`03`, `03b`)
> **Superseded by §11** (2-row tray with S/M/L/XL presets). The rest of this section still applies.

Attached 8 pt under the bubble during setup only; min width 264 pt (so controls don't shrink with the bubble). Rows:
1. **Zoom** 1.0–2.0×, detents at 1.0/1.25/1.5/1.75/2.0 (snap within 0.03), value in mono. Quality cap (v1 §3.2) shown as an amber tick; the knob stops there.
2. **Camera settings** (device, size S/M/L/XL, note on mirroring) · **Shape** circle/squircle/landscape 16:9/portrait 3:4 · **Camera off**.
3. **Background** None / Blur / Image. Image opens a picker below the tray: bundled images + "Choose…".
- **Size**: corner handle on the bubble (28 pt), drag snaps to S/M/L/XL with a size chip; also in camera settings.
- **Camera off**: bubble collapses to a 48 pt "Camera off · Turn on" pill at its corner; toolbar camera icon slashed. Blocked by OS: "Camera blocked · Open Settings".
- Tray may hang outside a picked window/area: it is never captured.
- The 24 pt edge inset applies to bubble + tray together during setup. At Record the tray goes and **the bubble does not move**; what you framed is what records.
- During recording the tray is gone; v1's hover HUD (zoom, background, hide) is unchanged.

### 3.3 Cover picker (`04`)
Popover above the swatch. Swatches: **Off** (show desktop) · Glow (proposed default when on) · Night · Fog · Graphite · Black · Current wallpaper · Image…. Clicking applies to the real desktop instantly. Copy: "Windows, the menu bar and the Dock still record."

### 3.4 More menu (`05`)
System audio (switch, mirrors toolbar; off by default) · Size 1080p/Native · Frames 30/60 · cost line · Recordings ⌘L · Settings… ⌘, · Quit Tally ⌘Q.

### 3.5 Window picker (`06`, `06b`)
- Choosing Window turns the screen into the picker: everything dims 38% except the window under the pointer, which gets a 3 pt green ring and a chip (app icon, title, size, "Click").
- Click picks. Ring stays; a green chip with ✓ sits **outside** the window's top edge. The bubble moves inside the window (D4). Click another window to switch.
- Keyboard: Tab/⇧Tab step through windows front-to-back, Return picks.
- Excluded from picking: Tally's own windows, minimised windows, the cover.
- Windows on any display can be picked.

### 3.6 Area picker (`07`, `07b`)
- Choosing Area: crosshair, screen dims, hint "Drag to choose an area · Return = whole display · Esc = back to Full screen". Bubble hidden while dragging.
- After drag: 2 pt green edge, 8 handles, drag inside to move, arrows nudge 1 pt (⇧ 10). A glass bar above the area shows `768 × 432 pt → 1536×864` and aspect presets Free / 16:9 / 4:3 / 1:1.
- Bubble is constrained inside the area (same rules as Window mode, D4). Cover still applies.
- Area must lie within one display. Remembered per display.

### 3.7 Camera only (`08`)
No screen recorded. The bubble becomes a centred 16:9 stage (800×450 pt on a 1280×800 display) matching the output, the desktop dims 62%, tray drops the shape row. Output: camera at 1080p 16:9 with zoom and background applied.

### 3.8 Toolbar → control bar (`09`, `10`, `10b`)
> §15 changes this: the bar no longer re-centres (left edge stays put), and the countdown cancel moves to an × on the left.
- Same window, same 56 pt height. On Record: source group and toggles fold out (180 ms, `--ease-out`), pill re-centres → countdown bar ("3 · Recording in 3 · Space now · Cancel Esc") → v1 control bar at frame 1.
- **Stop never lands where Record was**, and Stop ignores clicks for 600 ms after the bar appears (prevents a double-click stopping instantly).
- Selection colour switches green → red at Record (tally metaphor: preview → live).
- Reduced motion: instant swap.

## 4. Excluded from capture

All of these get `setContentProtection(true)` at creation (Mac verified, Windows WDA_EXCLUDEFROMCAPTURE unverified, as v1):
setup toolbar / control bar (one window) · bubble tray and its popovers · cover picker · More menu · window-picker dim, ring and chip · area dim, edge, handles, size bar · countdown digit, hints, red frame and tag · "Record this display" targets · notices.

**Captured on purpose:** the cover (it is the point) and the camera (the engine composites it; the on-screen bubble itself is excluded, ARCHITECTURE §4).

## 5. Multi-display (`12`)
- Setup opens on the display whose menu-bar icon was clicked.
- Full-screen mode: every other display shows a light scrim and a glass target "Record this display · LG UltraFine · 3840×2160 · Move here". Clicking moves toolbar + bubble there (bubble uses that display's remembered position).
- Cover applies to the recorded display only (others stay untouched).
- Window mode: all displays' windows are pickable; the toolbar stays where it is. Area mode: area on the toolbar's display; to use another display, Move here first.
- ⌥⇧R with setup closed: display under the pointer (D6).
- Hot-unplug during setup: everything on that display moves to the main display; a picked window/area on it is cleared.

## 6. Windows notes (`13`)
- Toolbar 16 pt above the taskbar; on a vertical/top taskbar, bottom-centre of the work area.
- Shortcuts spelled out: `Alt+Shift+R`.
- Tray icon left-click opens setup; right-click opens the menu.
- Glass: Electron `backgroundMaterial: 'acrylic'` is Win11-only and flaky with transparent frameless windows. Fallback: 92% opaque `--bg-1`-ish fill, no blur. Same layout.
- Cover helper on Windows is unverified (ARCHITECTURE §6.2). If it can't be placed, the cover button hides; nothing else changes.
- Window picker: use `desktopCapturer` window list + `GetWindowRect` for outlines (DWM extended frame bounds to avoid the invisible resize border).

## 7. Accessibility
- **Contrast:** label text `--fg-1` on glass ≥ 12:1 on dark covers. On a white page the glass composites to ≈ `#3b3e3d`: `--fg-1` 10.6:1, `--fg-2` icons/text ≈ 4.6:1. Record: `--fg-on-ready` on `--ready` 13.8:1. Glass alpha must not go below 0.80 (that is what keeps `--fg-2` ≥ 4.5:1 over white).
- **Not colour alone:** off toggles use slashed glyphs; active source has a label; green→red is paired with frame, tag, timer.
- **Focus (`11`):** setup takes focus when opened (deliberate mode). Initial focus: Record. Tab order: × → source group (one stop, ←/→ roving, selection follows focus) → camera → audio → cover → more → Record → tray zoom → settings → shape (one stop) → camera off → background (one stop) → bubble. Ring: 2 pt `--ready` with a 2 pt dark gap; Record's ring is white.
- **Targets:** toolbar 40, Record 44, tray 32, swatches 56×38, zoom track 28 tall, resize handle 28, area handles 12 drawn / 28 hit. Nothing under 28 pt.
- **Screen readers:** toolbar `role=toolbar` "Recording setup"; source group `radiogroup`; toggles `switch`; zoom `slider` (announces value); window picker announces "Acme Dashboard, Chrome, 1440 by 920, press Return to choose"; area announces size on change.
- **Reduced motion:** no fold animation, instant cover swap (no cross-fade), countdown digit only.

## 8. Spec changes needing a decision (diff against DESIGN_SPEC §8 and the spec body)

| # | Change | Touches |
|---|---|---|
| S1 | **Remove the launcher popover**; setup happens in place (toolbar + bubble + tray). | §3.1, §6 launcher row, §4 popover focus row |
| S2 | **Add Area mode** (custom rectangle, aspect presets, remembered per display). Engine crops a display capture. | §3.1, ARCHITECTURE §3.1 |
| S3 | **Add Camera-only mode** (16:9 1080p camera recording, no screen). Note D5 ("Landscape = overlay, not camera-only") stays true for the bubble shape; this is a separate source. | §3.1, §3.2, D5 note |
| S4 | **Cover applies during setup**, not at Record, and gets a toolbar swatch. Proposed default for first run: **Off** (don't repaint someone's desktop uninvited); remembered after. | §3.1 clean-desktop row |
| S5 | **Bubble constrained inside the area** in Area mode (extends D4). | D4, §3.2 |
| S6 | **Bar height 46 → 56 pt, controls 36 → 40, Stop 40 → 44**, so setup toolbar and control bar are one object. | §2.5, §3.4 |
| S7 | **Esc during countdown returns to setup** (v1: cancels, nothing written — still true, but you land in setup). | §3.3 |
| S8 | **Stop ignores clicks for 600 ms** after the bar appears. | §3.4 |
| S9 | **Setup takes keyboard focus**; initial focus Record. Bubble keyboard rules (v1 §4) apply in setup. | §4 |
| S10 | **System audio appears twice** (toolbar toggle + More row). | §3.1 |
| S11 | **Selection colour green in setup, red from countdown.** Consistent with §2.1 rules, but now applies to on-screen pickers. | §2.1 |
| S12 | **Size step via bubble corner handle** in addition to settings. | §3.2 |
| S13 | Tray icon left-click = toggle setup; right-click = native menu. | §1, §5 labels |

## 9. Build estimate (rough, one engineer, Mac first)

| Work | Days |
|---|---|
| Setup toolbar window (glass, states, tooltips, focus, notices) replacing popover | 2 |
| Bubble tray + camera settings / image popovers, resize handle | 2 |
| Cover live during setup + picker (cover helper lifecycle moves earlier) | 1 |
| More menu, settings plumbing | 0.5 |
| Window picker overlay (per-display transparent overlay, hit-testing window bounds, keyboard) | 2.5 |
| Area picker (drag, handles, aspect lock, nudge) + engine crop of display stream | 3 |
| Camera-only source (engine path: camera → 1080p canvas → recorder) | 1.5 |
| Toolbar → bar morph, countdown changes, Esc-to-setup, Stop guard | 1.5 |
| Multi-display targets, move-here, hot-unplug | 1.5 |
| Accessibility pass (roles, announcements, reduced motion) + content-protection checks for every new window | 1.5 |
| **Mac total** | **≈ 17 days (3.5 weeks)** |
| Windows port (acrylic fallback, window bounds via DWM, verify exclusion) | +4–6 |

Biggest risks: overlay windows on every display stealing clicks from the real desktop (they must be click-through except where drawn); area crop at Retina scale factors; picker overlays and content protection on Windows.

## 10. Open questions for Dimi
> **Answered 2026-10-21:** 1 Off · 2 later · 4 keep instant · 5 dropped. (3 not answered; proposal stands.)

1. Cover default on first run: **Off** (proposed) or **Glow** like Loom's always-on look?
2. Keep **Area** and **Camera only** in v1, or ship Full screen + Window first and add them later (saves ≈ 4.5 days)?
3. System audio in **both** toolbar and More (proposed), or toolbar only?
4. Should ⌥⇧R with setup closed open setup instead of recording instantly? (Proposed: keep instant; it's the power path.)
5. Does Loom's lock button matter to you? We dropped it; tell us what you use it for.

---

## 11. Camera size in the tray (`14`, `14b`) — proposal

Dimi wants **size** separate from **zoom**, both in the tray. The build model is kept as it is (S/M/L/XL presets in the tray, plus the corner handle). What changes is the layout: **2 rows instead of 3**, like Loom's.

### 11.1 Layout
| Row | Contents | Why |
|---|---|---|
| 1 · *how big* | **Size** `S M L XL` (mono letters, radiogroup) · **Zoom** slider 1.0–2.0× with detents and value | Both are about framing, so they sit together; letters vs magnifier keep them visibly different controls |
| 2 · *how it looks* | **Shape** (4 icons) · **Background** None/Blur/Image (3 icons) · camera settings · camera off | Background goes icon-only (tooltip + aria-label) to fit the row |

- Tray width **332 pt**, or the bubble's width if that is larger (landscape M = 420). Height 84 pt (was ~124).
- Hit targets: size letters 30×30, other tray controls 32, zoom track 28 tall. Nothing is under 28.
- Sizes are v1's: **S 220 · M 280 · L 340 · XL 400 pt** (circle/squircle diameter; landscape is 1.5×s wide at 16:9; portrait is 1.5×s tall at 3:4). Default: **S**.
- Camera settings popover: device and mirror note. The size row moves out of it, since size is now in the tray; there should be one place for each control.

### 11.2 Behaviour
- **Size is what records**: the engine composites the bubble at the same proportion of the display. **Zoom** only changes the crop inside it.
- Clicking a preset animates the size (160 ms, `--ease-out`; instant with reduced motion). The bubble grows **away from its nearest screen corner**, so a bottom-left bubble grows up and right and keeps its 24 pt inset.
- **Corner handle** (28 pt) is unchanged: dragging snaps to the four presets, shows the `L · 340 pt` chip and **moves the preset selection live**. It does not allow free sizes in between, which keeps one source of truth.
- Keyboard: the size group is one Tab stop; ←/→ change the size, and selection follows focus. With the bubble itself focused, `⌘+` / `⌘−` step the size (local keys, not global).
- If a bigger size would push bubble + tray off screen, the bubble shifts inward. If it can't fit (XL inside a small picked window, D4), larger presets are disabled with the tooltip "Too big for this window".
- During recording the tray is gone; v1's hover HUD is unchanged.

### 11.3 Tray alignment and the toolbar
- The tray aligns to the bubble's **outer** edge: left-aligned when the bubble is in the left half of the screen, right-aligned in the right half. Bubble and tray then share the 24 pt edge inset.
- **Toolbar avoids the bubble.** On a 1280 pt display the 2-row tray plus the Notes button make bubble + tray and a centred toolbar overlap even at S (`15`). In that case the toolbar slides sideways to keep **16 pt** clear (`14b`, `15`), and slides back when there is room. When recording starts the tray goes, and the control bar re-centres (§3.8).

---

## 12. Speaker notes (`15`, `15b`, `15c`, `15d`) — proposal

A script panel. Dimi pastes a script during setup and reads it while recording.

### 12.1 Where it opens from
- A **Notes** button on the setup toolbar, between system audio and the cover swatch. It is a toggle (`aria-pressed`), lit while the panel is open; tooltip "Speaker notes".
- Not in the More menu: once you script a video you use it on every take, and the lit button shows at a glance that notes are open.
- The control bar gets the same button while recording. It hides and shows the panel and never pauses anything.

### 12.2 Where it sits
- It **docks top-centre, directly under the camera lens**, 10 pt below the menu bar, 560 pt wide. The text is at the top and the controls are at the bottom, so the line being read is always the one nearest the lens.
- Draggable by its top grip, with the position remembered per display. Dragging near top-centre snaps back to the dock.
- **Which display:** the built-in display (that's where the lens is, `screen.getAllDisplays()[].internal`) whenever it is on, even if another display is being recorded. If the lid is closed or an external webcam is selected, it goes to top-centre of the display that setup is on.
- In Window mode the panel can overlap the picked window. That's fine, because it is never captured (§12.6).

### 12.3 Behaviour
| State | Text | Footer |
|---|---|---|
| **Setup** | Editable. Plain text: paste removes formatting; blank lines = paragraphs. | Text size `A 24 A` · **Auto-scroll** toggle · speed `− 140 wpm +` · "Saved" · hide |
| **Countdown** | Read-only, stays where it was left | Same as recording |
| **Recording** | **Read-only.** Wheel/trackpad scroll always works. Text moves up past a fixed reading mark (line 2); lines already read dim to `--fg-3`. | One quiet line: "Scrolling · 140 wpm · ⌥⇧N pause" + 2 pt progress. Pointer over the panel → full controls (text size, Pause scroll, speed, hide). |
| **Scroll paused** (⌥⇧N) | Read-only; manual scroll | Amber dot, "Scroll paused · wheel or trackpad to move · ⌥⇧N resume" |
| **Recording paused** (⌥⇧P) | **Editable again** (fix a typo mid-take); auto-scroll stops | Setup footer with amber "Paused · editable" |

- **Auto-scroll** is optional (off by default on first run, then remembered). Speed is set in **words per minute**, 80–220 in steps of 10, default 140. Tally converts it to pixels per second from the actual layout (words per line × line height), so changing the text size doesn't change the reading pace.
- Scrolling starts at frame 1 (after the countdown), from wherever the text was left, not from the top. It follows the recording: it stops on pause and on a restart/cancel confirmation (D3), and resumes with the recording. A restart scrolls back to where that take started.
- **Text size** 18–40 in steps of 2, default 24; line height 1.42; Geist 450.
- Manual scroll while auto-scroll is running nudges the position and keeps scrolling. It does not fight the user.

### 12.4 Keyboard
- Setup: Tab order goes toolbar … audio → **Notes** → cover …. When the panel opens, focus moves into the text. Inside the panel: text → smaller → larger → auto-scroll → slower → faster → hide; Esc returns to the Notes button. `⌘+` / `⌘−` set the text size and `⌘V` pastes.
- Recording: **⌥⇧N pauses/resumes the scroll**. Like P/Z/X/C, it is registered **only while a recording session is active and notes are open** (D2 lifecycle). On Windows it is `Alt+Shift+N`. ⌥⇧P pauses everything, as before.
- During recording the panel is **not focusable** (`setFocusable(false)`): clicks and scrolling still work, but clicking it never steals focus or greys the recorded app's title bar on camera. It becomes focusable again while paused, so you can edit.

### 12.5 Persistence (local only)
- One script, autosaved 0.5 s after typing stops and again on hide/quit, with an atomic write to `~/Library/Application Support/Tally/notes.txt` (`%APPDATA%\Tally\notes.txt` on Windows). Plain UTF-8, readable outside Tally.
- **No length cap.** The whole script is kept and scrolls; nothing is truncated.
- Remembered in prefs: open/closed, position per display, text size, auto-scroll on/off, speed, and scroll position. Reopening setup restores the panel as it was left.
- Never uploaded, never written into the recording or its metadata. Clearing is just select-all + delete, and `⌘Z` undoes it.

### 12.6 Never in the recording
- **Mac:** the panel is created with `setContentProtection(true)` **before its first show** (sharing type none, the same mechanism as the control bar, pixel-verified in ARCHITECTURE §6.3). Add the panel to that pixel test (protected panel absent from the frame, the content behind it present).
  - Window mode records a single window, so the panel can't appear there either.
  - Side effect: the notes also won't appear in Zoom/Meet screen shares or screenshots. That's a feature.
- **Windows:** `setContentProtection(true)` → `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`. Risks:
  1. **Before Win10 2004 (build 19041)** the flag falls back to `WDA_MONITOR`, which records a **black rectangle** where the panel is. The panel isn't readable, but its shape and position leak and it covers content.
  2. Not yet verified with our capture backend (ARCHITECTURE §6.2, unverified).
  3. The call can fail silently on some window configurations; read it back with `GetWindowDisplayAffinity`.
- **Fail closed on Windows.** Notes show over a recording only if this PC has passed the check: build ≥ 19041, the affinity reads back as set, and a one-time self-test capture doesn't contain a test window. Otherwise notes work in setup but **hide at Record**, with the notice "Notes hidden while recording · this PC can't keep them out of the video" (`15d`). There is no "show anyway" override.

### 12.7 Accessibility
- Text `--fg-1` on `--glass-strong` ≥ 12:1 on dark content and ≈ 10:1 over white. Dimmed read lines use `--fg-3`; that's fine because they are context, not content you need.
- `role=region` "Speaker notes"; the text is `textbox` multiline with `aria-readonly` while recording. Speed and size changes are announced.
- Reduced motion: auto-scroll still moves (it's the function) but with no fades. Read-line dimming stays.

### 12.8 Empty state (`15b`)
"Paste your script" with a caret, then "Saved on this Mac only. Never shows in the recording.", then a **Paste ⌘V** button. The footer shows "Plain text · no length limit" and hide. Auto-scroll controls appear once there is text.

---

## 13. Spec changes needing a decision (round 2)

| # | Change | Touches |
|---|---|---|
| S14 | **Tray becomes 2 rows**: size presets + zoom / shape + background (icon-only) + settings + off. Size leaves the camera-settings popover. | SETUP_V2 §3.2, DESIGN_SPEC §3.2 |
| S15 | **Size presets animate from the bubble's nearest screen corner**, the tray aligns to the outer edge, and the **toolbar slides to stay 16 pt clear** of bubble + tray. | §3.1, §3.2 |
| S16 | **New Speaker notes panel** + Notes button on the setup toolbar and the control bar. | §3.1, §3.4 |
| S17 | **New shortcut ⌥⇧N** (pause/resume scroll), session-scoped like P/Z/X/C and only while notes are open. | §4 shortcuts table, D2 |
| S18 | **Notes panel is non-focusable while recording** and editable while paused. | §4 focus |
| S19 | **Windows fail-closed rule**: notes hide at Record unless exclusion is verified on that PC. | §6, ARCHITECTURE §6.2 |

## 14. Estimate (round 2, one engineer)

| Work | Days |
|---|---|
| 2-row tray, size presets wired to the bubble + engine composite size, corner-anchored resize, toolbar avoidance | 1.5 |
| Notes panel window (glass, dock under lens, drag/snap, per-display position) | 1 |
| Editing, plain-text paste, autosave + prefs, empty state | 1 |
| Recording mode: read-only, reading mark + dimming, wpm auto-scroll tied to pause/restart, ⌥⇧N lifecycle, non-focusable toggle | 2 |
| Content-protection pixel test for the panel + a11y pass | 0.5 |
| **Mac total** | **≈ 6 days** |
| Windows: affinity read-back, build check, self-test capture, fail-closed notice | +1.5 |

---

## 15. Compact toolbar (`16`–`16f`) — proposal

Dimi wants the bottom toolbar small by default, with a way to open it up. Loom's pill (reference screenshot) is about 520 pt and always shows everything. Tally's **folds to 355 pt** (unfolded: 663 pt), with Phase B sources only (Full screen, Window).

### 15.1 Folded vs unfolded
| | Folded (default) | Unfolded |
|---|---|---|
| Contents | grip · **›** · source chip · *status icons* · **Record** | grip · **‹** · × · Full screen / Window · camera · system audio · Notes · cover · More · **Record** |
| Width | 355 pt (+32 per status icon) | 663 pt |
| Height | 56 pt, same as unfolded and the recording bar, so there is never a height jump | 56 pt |

- **Always visible:** Record (unchanged look, size and ⌥⇧R keycap), the **source chip** (the folded source group: icon + label + ▾; it names what will record), the grip and the fold chevron.
- **Status icons:** any setting that is **not at its default** stays visible as a quiet 32 pt icon that you can click: *camera off*, *system audio on* and *microphone on* (`16c`). Defaults stay hidden, so the folded pill never hides a surprise.
- **Source chip menu:** clicking the chip opens Full screen ✓ / Window… above it. Changing the source never needs unfolding. Choosing Window starts the picker (§3.5) and the chip then shows the window's title.
- **Close:** in folded mode, a 22 pt × badge appears at the pill's top-left on hover or keyboard focus. The hit area is 28 pt. Esc and the menu-bar icon still close setup. In unfolded mode × is a normal button.

### 15.2 Unfold / fold
- The chevron is the toggle (`aria-expanded`, tooltip "All controls ⌘\" / "Fewer controls ⌘\"). `⌘\` is local and only works while setup has focus.
- **The left edge is fixed and the pill grows to the right.** The grip and chevron never move, so the same click folds it back. Record moves right when unfolding; that's fine because the click was on the chevron, not Record.
- Animation (`16b`): width springs open in **220 ms** (`--spring`); folding takes **160 ms** (`--ease-out`). The source chip becomes the source group in place. The other controls fade from 0 → 1 and scale from 0.78 → 1, staggered 15 ms from left to right. Reduced motion: instant swap.
- Popovers (cover, More, chip menu) close when the toolbar folds. Unfolding never opens one.

### 15.3 Remembered state
- `toolbar.unfolded` defaults to **false** and is remembered between sessions. It is **one preference shared by setup and the recording bar**, so "I like it small" applies everywhere.
- Position is remembered per display (§15.5). Status icons aren't a preference; they are derived from the settings.

### 15.4 Keyboard
- Initial focus is still Record, so Return records (`16c`).
- Folded Tab order: chevron → chip → status icons → Record. Unfolded: chevron → × → sources (one stop, ←/→) → camera → audio → Notes → cover → More → Record. The bubble tray follows, as in §7.
- Toggling with focus on the chevron keeps focus there. Folding while focus is on a control that disappears moves focus to the chevron. Screen readers hear "Recording setup, 4 controls" / "… 10 controls".
- **Moving with the keyboard:** with focus anywhere in the toolbar, **⌥ + arrows** moves it 16 pt (⌥⇧ + arrows: 64 pt). It snaps the same way as dragging.

### 15.5 Dragging it out of the way (`16e`)
- Drag by the **grip** or any empty part of the pill. While dragging, the pill lifts (scale 1.02, deeper shadow).
- **Snapping:** 16 pt from any screen edge, and to bottom-centre (home) and top-centre, with a 12 pt magnetic radius. A dashed outline marks home while dragging. Otherwise placement is free.
- **Double-click the grip** to go home. The position is remembered **per display**.
- It keeps growing to the right when unfolded. If there isn't room, the pill shifts left while unfolded and returns to its spot when folded.
- Top-centre placement collides with the speaker notes dock (§12.2). In that case the notes panel docks below the toolbar. Popovers open downward when the pill is in the top half of the screen.

### 15.6 Into the recording bar (`16d`)
- Same window and the **same left edge**. It no longer re-centres (this changes §3.8): nothing slides under the pointer.
- **Countdown:** grip · **×** (cancel) · ring + "Recording in 3" · "Esc cancel · Space now". It is always this compact form. The × is on the **left**, so only text sits where Record was, and a double-click on Record can't cancel the countdown. Esc behaves as before (§3.8: back to setup).
- **Recording, folded:** grip · › · ● time · **Stop** · Pause. **Unfolded:** adds restart · discard · Notes · camera.
- **Stop never lands where Record was**: it sits under the source chip's old position. Pause and the unfolded extras can land there, so the 600 ms click guard (S8) now covers **every control on the bar**, not just Stop.
- Paused: amber time, Pause becomes Resume. Nothing else moves.
- The fold preference carries over: if you set up folded, you record folded.

### 15.7 With the bubble (S15) (`16`, `16f`)
- Folded and at home, the pill spans 463–818 pt on a 1280 pt display. That clears bubble + tray at **every size** in the default bottom-left corner (XL tray ends at 424). So the S15 slide no longer happens in the common case.
- Unfolding grows **rightward, away from the default bubble corner**: 463 → 1126 fits on 1280 with XL (`16f`).
- If the bubble is bottom-right, unfolding would hit it. Then S15 applies and the pill shifts left just enough while unfolded, keeping 16 pt clear.
- Recording: the tray is gone, and the folded bar (≈ 230 pt) clears any bubble.

### 15.8 Self-critique against the rest of the design (fixed)
- **Countdown Cancel sat exactly where Record was** (a double-click on Record would cancel). Cancel moved to a left-hand ×.
- **The re-centring rule in §3.8 fought the fixed chevron.** Re-centring is dropped; the left edge stays put.
- **The 600 ms guard covered only Stop**, but in the folded bar Pause lands under Record. The guard now covers every bar control.
- **The folded pill could hide a non-default setting**, which is a silent-surprise risk. That's why the status icons exist.
- Record keeps the same size, colour and hierarchy as everywhere else. It is still the only filled control.

### 15.9 Spec changes needing a decision
| # | Change | Touches |
|---|---|---|
| S20 | **Toolbar folds**: default folded (grip · chevron · source chip · status icons · Record); one shared `toolbar.unfolded` preference for setup and recording. | §3.1, §3.4 |
| S21 | **Source chip with menu** replaces the source group while folded. | §3.1 |
| S22 | **Status icons for non-default settings** (camera off, system audio on) while folded. | §3.1 |
| S22b | **Collapsed toolbar** (Oct 2026, Dimi): a − button next to the fold chevron shrinks the pill to grip · expand · Record (setup, 92 pt) or grip · expand · Stop · Pause · Restart (recording, 166 pt). Remembered (`toolbar.collapsed`) until expanded (button or ⌘\\). The bubble may go anywhere on its display, bottom edge and corners included; the toolbar moves aside (or above the bubble when there is no room beside it), the setup tray flips above a bubble on the bottom edge, and the toolbar window's transparent area is click-through. | §3.1, §15 |
| S23 | **Grows right from a fixed left edge**; the bar **no longer re-centres** at Record. | §3.8 |
| S24 | **Draggable toolbar**: snap to edges/home/top-centre, per-display position, double-click the grip to go home, ⌥+arrows to move. | §3.1, §4 |
| S25 | **Countdown cancel becomes a left-hand ×**; the countdown bar is always compact. | §3.3, §3.8 |
| S26 | **600 ms click guard on every bar control** (extends S8). | §3.4 |
| S27 | **Local shortcut ⌘\\** folds/unfolds (setup focus only, not global). | §4 |

### 15.10 Estimate delta for Phase B
| Work | Days |
|---|---|
| Fold state + chip + status icons + close badge, shared preference | 1 |
| Width spring + staggered reveal, reduced motion, popover close-on-fold | 0.75 |
| Drag, snapping, per-display memory, home, keyboard move, top-half popover flip | 1 |
| Compact recording bar + countdown layout + extended click guard | 0.5 |
| Focus management + screen-reader labels | 0.25 |
| Saved: the S15 slide logic becomes a rare path | −0.25 |
| **Delta** | **≈ +3.25 days** (Windows: +0.5 to verify drag/snap with DPI scaling) |

---

## 16. Privacy levels (cover picker)

A second choice under the cover swatches: **Standard** (default) · **Semi-private** (Show Dock | Show menu bar) · **Very private**. Remembered in `cleanDesktop.privacy` / `cleanDesktop.keep`.

- **In the video only.** The real menu bar and Dock stay on screen and usable. The engine paints the cover's look (or the wallpaper when the cover is Off) over their strips in every frame. No window is ever put over them.
- **Strips** (`src/shared/privacy.js`): menu bar = work-area top inset (the notch height on a notched display; 24 pt or the safe-area top if it autohides). Dock = the whole edge it sits on (`defaults read com.apple.dock` orientation), as thick as the work-area inset or icon size + 20 pt, whichever is larger (magnified size if magnification is on). An autohiding Dock is covered anyway.
- **Full screen only.** Ignored in Window mode (the row says so; the folded status icon hides).
- **Folded (S22):** a non-Standard level shows an eye-off status icon. Clicking it unfolds the toolbar and opens the cover picker at the privacy row (it doesn't reset to Standard: one stray click shouldn't lower privacy).

| # | Change | Touches |
|---|---|---|
| S28 | **Privacy levels** hide the menu bar and/or Dock in the recording only; status icon while folded. | §3.3, §15.1 |
