# Tally — v1 Design Spec

Status: **approved for engineering**, 2026-10-21. This file is the single source of truth; where the mockups and this spec disagree, the spec wins. Decisions: §8. Mockups: `design/index.html` (open in a browser). Screenshots: `design/shots/`.
Inputs: `docs/ARCHITECTURE.md`. Design method: the `ui-ux-pro-max` skill (design-system pass for "developer tool, screen recorder, dark, precise" → dark-first, high-contrast, technical type; then its priority checklist).

---

## 1. Name and identity

**Name: Tally** (decided, §8 D1). A *tally light* is the lamp on a broadcast camera: green means "you're in preview", red means "you're live". It gives the product a colour system with a reason behind it, instead of a decorative accent.

Alternatives considered (rejected):

| Candidate | Why | Risk |
|---|---|---|
| **Tally** | Tally light = "am I recording?", the one question a recorder must answer. Short, verb-free, easy to say. | Generic word; trademark search needed. |
| **Take** | A take is one recording attempt; "Restart" = new take. Fits the copy ("Restart take?"). | Hard to search for. |
| **Rushes** | Film term for raw, unedited footage; we don't edit. | Less obvious to non-film people. |

**Mark:** a rounded square housing with a round lens. Idle: dark lens. Live: red lens. The menu-bar/tray icon is the same shape in outline (template image on macOS), and becomes a red-lens icon plus elapsed time while recording.

Nothing from Loom is used: no purple, no "bubble" pastel, no names, no icons. Icons are a single stroke family drawn for this project (1.75 px stroke, round caps, 24 px grid, Lucide-like geometry, ISC-licence-compatible if we swap to Lucide).

---

## 2. Design tokens

Source of truth: `design/tokens.css`. Engineers should copy it verbatim into the renderer.

### 2.1 Colour (dark — default)

Graphite with a faint green cast. Surfaces are separated by **tone**, not outlines.

| Token | Value | Use | Contrast |
|---|---|---|---|
| `--bg-0` | `#0b0e0d` | Window background, option-group well | — |
| `--bg-1` | `#131716` | Popover / panel / toast surface | — |
| `--bg-2` | `#1b201e` | Inputs, rows, segmented track | — |
| `--bg-3` | `#252b29` | Hover | — |
| `--bg-4` | `#313835` | Pressed, selected segment, switch-off track | — |
| `--fg-1` | `#edf2ef` | Primary text | 16.0:1 on bg-1 |
| `--fg-2` | `#a9b3ae` | Secondary text, idle icons | 8.4:1 |
| `--fg-3` | `#7f8a85` | Meta only (sizes, paths, captions). Never an action label. | 5.1:1 on bg-1, 4.6:1 on bg-2 |
| `--ready` | `#9af07f` | Green tally: primary action fill, selection, focus ring, "Saved" | 13.0:1 as text |
| `--fg-on-ready` | `#07120a` | Text on `--ready` | 13.8:1 |
| `--live` | `#ff4b55` | Red tally: recording dot, capture frame, live lens | 5.5:1 as text |
| `--live-fill` | `#d92631` | Filled red controls carrying white text (Stop, Discard, Stop & save) | 4.6:1 with white |
| `--hold` | `#ffc94a` | Paused, warnings | 11.8:1 |
| `--danger` | `#ff6b73` | Destructive text buttons (Delete) | 6.5:1 |

All ratios were computed with the WCAG formula, not estimated. Note: `--live` with white text is only 3.3:1, which is why `--live-fill` exists.

**Rules**
- Green = ready/safe. Red = live/recording. Amber = paused/warning. Never swap them.
- Exactly one filled `--ready` control per surface (Record, or the step's primary action).
- Colour is never the only signal: live has a dot + timer, paused has the word "Paused", errors have an icon + sentence.

### 2.2 Colour (light)

The **popover** and the **Recordings** window follow the OS appearance. **Overlays stay dark in both modes** (control bar, bubble chrome, countdown, post-stop popup), because they float over unknown content and must read on both a white web page and a dark IDE.

| Token | Light value | Contrast on `#f7f9f8` |
|---|---|---|
| `--fg-1` | `#0f1412` | 17.6:1 |
| `--fg-2` | `#46504c` | 7.9:1 |
| `--fg-3` | `#616b67` | 5.2:1 |
| `--ready` (text) | `#2a7d18` | 4.9:1 |
| `--ready-fill` | `#9af07f` | fill only, text on it is `--fg-on-ready` |
| `--live` | `#d92631` | 4.6:1 |
| `--danger` | `#c41f2a` | 5.6:1 |

### 2.3 Elevation and edges

- No grey outline borders anywhere. Floating surfaces get `--edge` (a 1 px *top* highlight, `rgba(255,255,255,.07)`) plus `--shadow-2`.
- `--shadow-1`: tooltips, toasts in the bar. `--shadow-2`: popover, windows, bar, post-stop popup.
- Selection = tinted fill (`--ready-dim`) plus, for source tiles only, a 2 px `--ready` inner ring.

### 2.4 Type

| Role | Font | Size / line | Weight |
|---|---|---|---|
| UI | **Geist** | 13 / 1.45 | 400, labels 500 |
| Numbers, shortcuts, sizes, paths, timer | **Geist Mono** (tabular) | 11–13 | 500 |
| Title (window headings) | Geist | 20 / 1.25, −0.01em | 600 |
| Record button | Geist | 15 | 600 |
| Countdown digit | Geist Mono | 92 | 600 |
| Section label (Recordings day group) | Geist | 11, uppercase, +0.06em | 600 |

Scale: 11 · 12 · 13 · 15 · 20 · 28. Body is 13 px, not the skill's 16 px web default: this is a desktop utility, and 13 px is the platform norm on both macOS and Windows. Bundle both fonts (SIL OFL) in the app; never load from the network (local-only product).

### 2.5 Space, radius, size

- Spacing: 4 pt grid (`4 8 12 16 20 24 32 40`).
- Radius: `4` keycaps · `6` buttons/inputs · `10` rows, tiles, Record · `14` popover, popup · `20` large · pill for the bar. Windows: windows and popover use 8.
- Hit targets: Record 44 px tall; bar controls 36 px (40 for Stop) with ≥ 2 px gaps inside a 46 px pill; popover rows 40 px. Mouse-driven desktop UI, so 36 px is acceptable; nothing is smaller than 26 px, and every small target has a keyboard path.
- Popover width 340. Post-stop popup 372 (360 on Windows). Recordings window min 640×420.
- Camera bubble sizes: see §3.2 and the `--bub-*` tokens in `tokens.css` (`--bub-s/m/l/xl` = 220/280/340/400, `--bub-long-s/m/l/xl` = 330/420/510/600, `--bub-inset` 24, zoom 1–2 step 0.1).

### 2.6 Motion

| Token | Value | Use |
|---|---|---|
| `--d-fast` | 120 ms | hover, press |
| `--d-base` | 180 ms | expand rows, switch, bar state swap |
| `--d-slow` | 260 ms | popover/popup enter |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` | entering |
| `--ease-in` | `cubic-bezier(.4,0,1,1)` | exiting (exit = ~65% of enter) |
| `--spring` | `cubic-bezier(.34,1.4,.64,1)` | switch knob, bubble snap |

- Popover: fade + 4 px drop from the tray icon. Popup: fade + 8 px rise from the bottom edge.
- Countdown: digit cross-fades; the ring drains linearly over each second (the only linear animation: it represents time).
- Live dot: 1.6 s opacity pulse, 100% → 55%.
- Nothing blocks input during animation. All animations are interruptible.
- **Reduced motion:** all durations → 0; the live dot stops pulsing (stays solid); the countdown ring is replaced by the digit alone; bubble snap is instant.

---

## 3. Screens and component states

> Scale note: the desktop scenes (`01`, `03`, `04`, `08`, `11`) are scaled-down illustrations, so their bubbles are not to size. Bubble dimensions come only from §3.2 and the `02` sheets (drawn at 50%, labelled in real pt).

### 3.1 Launcher popover (`01-*`)

Structure, top to bottom: header (mark, name, Recordings, Settings) → source (Display | Window) → options well (Camera, Clean desktop, System audio, Quality) → Record + meta line.

| Element | States |
|---|---|
| Source tabs | Display (default) · Window. Display shows one tile per display (thumbnail, name, native px). With one display, the tile still shows (it confirms what's recorded). |
| Display tile | default · hover (`bg-3`) · selected (ring + tint) · focus (focus ring). Thumbnails refresh each time the popover opens. |
| Window list | Rows: thumbnail 56×35, window title (ellipsis, full title in tooltip), app icon + name. default · hover · selected (tint + check) · focus. Frontmost non-Tally window preselected. Max 5 visible, scrolls. Minimised windows are excluded. |
| Option row | collapsed (shows current value) · hover · expanded (chevron down) · disabled (e.g. Clean desktop hidden in Window mode). Clicking the label expands; the switch toggles without expanding. One row expanded at a time; source tiles collapse to the tab strip while a row is open, so the popover never scrolls. |
| Camera detail | Device select · Shape (circle / squircle / landscape / portrait) · Size S/M/L/XL · Zoom slider 1.0–2.0× (0.1 steps) · Background None / Blur / Image (Image shows a thumbnail row: bundled images + Choose image…). Changes preview live on the bubble. |
| Clean desktop detail | Cover swatches: Graphite (default), Black, Fog, Deep blue, Current wallpaper, Choose image… Hint line explains what is hidden. |
| System audio | Switch only. **Off by default.** There is no microphone control anywhere in the product. |
| Quality detail | Size: **1080p** (default) · Native. Frames: **30 fps** (default) · 60 fps. Cost line in GB/hour; shows the native px for the selected display. |
| Record | default · hover · pressed (scale .98) · focus (fg-1 ring) · disabled (no screen permission, or < 1 GB free). Label adapts: "Record", "Record window", "Record screen only" (camera blocked). Shows ⌥⇧R. Has initial focus, so Return records. |
| Meta line | Save folder + free space. Free space turns amber under 5 GB. |

Two clicks to record: tray icon → Record (records the source selected in the popover). Zero clicks: ⌥⇧R records the last setup, except that in Display mode it records **the display under the pointer** (§8 D6), even if another display was selected last time. The countdown frame and its tag name the target, so a wrong display is caught before frame 1. In Window mode ⌥⇧R records the last window if it is still open; if not, it falls back to the display under the pointer.

### 3.2 Camera bubble (`02-*`)

Options match Loom's (4 shapes, 4 sizes, background modes) plus a zoom control Loom doesn't have (§8 D8).

**Shapes**

| Shape | Aspect | Corners | Notes |
|---|---|---|---|
| Circle (default) | 1:1 | full | — |
| Squircle | 1:1 | superellipse, n = 5 | Loom's "squircle". Draw as a superellipse path in `bubbleShapes.ts` (CSS mask + canvas `clip()`), not `border-radius` (the mockup approximates it with 28%). |
| Landscape | **16:9** | 14 pt | The existing rectangle: an overlay on the screen recording, not a camera-only frame (§8 D5). |
| Portrait | **3:4** | 14 pt | See rationale below. |

**Why portrait is 3:4, not 9:16**
- *Framing:* 3:4 is a head-and-shoulders crop. 9:16 at the same height is a narrow strip that clips the shoulders and looks like a phone story, not a presenter.
- *Pixels:* cameras deliver 16:9 (or 4:3). A 3:4 crop of a 1920×1080 frame keeps 810×1080 (42% of the width); 9:16 keeps only 608×1080 (32%). 3:4 leaves more headroom for zoom before the image goes soft.
- *Screen cost:* at the same 600 pt height, 3:4 is 450 pt wide vs 338 pt for 9:16 — wider, but it holds the face larger, so users can pick a smaller size step.
- *Loom parity:* Loom's portrait is 2:3 (220×330, 400×600). 3:4 is the nearest standard ratio and the native shape of 4:3 webcams.

**Sizes** (logical pt; one base value *s* per step; rectangles have a long side of 1.5 *s*)

| Step | *s* | Circle / squircle | Landscape 16:9 | Portrait 3:4 |
|---|---|---|---|---|
| S (default) | 220 | 220 × 220 | 330 × 186 | 248 × 330 |
| M | 280 | 280 × 280 | 420 × 236 | 316 × 420 |
| L | 340 | 340 × 340 | 510 × 286 | 382 × 510 |
| XL | 400 | 400 × 400 | 600 × 338 | 450 × 600 |

- The rectangles' long sides (330–600 pt) sit in Loom's measured range. Loom's portrait S/M/XL are 220×330, 280×420 and 400×600, so our *s* values match Loom's short sides.
- **XL fits a 1280×800 display** (the smallest we support): the tallest bubble (portrait XL, 600 pt) plus the 24 pt inset uses 624 of 800 pt, leaving 152 pt under the 24 pt menu bar. The widest (landscape XL, 600 pt) plus insets uses 648 of 1280 pt. See `02c-bubble-xl-fit`.
- On a small display XL can cover part of the Dock/taskbar, and the control bar's default bottom-centre spot. Rule: **the control bar keeps ≥ 16 pt from the bubble**; it slides right along the bottom edge rather than overlapping it.
- Default: Circle, S. The engine scales the bubble by the capture's pixel ratio, so framing is identical at 1080p and Retina.

**Zoom** (Tally only; Loom has none)
- Range **1.0×–2.0×**, step **0.1×**. Default 1.0×. Changes apply live, during recording too (the bubble is composited).
- **Centred on the face crop:** the crop is centred on the detected face (from the segmentation mask / face box when background is Blur or Image, or a light face detector when None). The centre is smoothed (≈ 300 ms ease) so head movement doesn't jitter the frame. If no face is found, the crop centres on the frame. The crop is clamped to the camera frame — it never shows edges.
- **Quality cap:** maximum zoom is lowered so the crop keeps ≥ 540 px on its short side (a 720p camera tops out at 1.3×). The slider shows the reduced max.
- **Controls:** popover slider; hover HUD −/slider/+; **+ / − keys** when the bubble has keyboard focus; **0** or double-click on the zoom value resets to 1.0×. No scroll-wheel or pinch zoom (a stray scroll used to reset the framing). No global shortcut (keeps §4's registration set small).

**Background** (Loom parity, minus Loom's "transparent" cut-out)
- **None** (default) · **Blur** · **Image** (bundled images + Choose image…, stored locally).
- Blur and Image both need **person segmentation**. **Engineering chooses the method** (e.g. MediaPipe selfie segmenter on CPU as in `ARCHITECTURE.md` §5, or Apple Vision person segmentation on macOS as Loom does). Design requirements only: edges must not flicker at 30 fps, and if segmentation can't keep up the preview shows a "Background paused" tag and falls back to None rather than dropping frames.
- Changing background during recording applies live.

**Placement and states**
- Default position: bottom-left, 24 pt inset. Snaps to 24 pt insets from display edges and corners within 16 pt. Position remembered per display.
- States: idle · idle + background tag ("Blur" / "Image", preview only) · hover (grip at top + HUD below: zoom −/slider/+, background menu, hide) · dragging (lifts 4%, ring, snap guides) · keyboard focus · camera lost (placeholder + reason) · hidden (⌥⇧C; bubble fades out, engine stops compositing it).
- Hover HUD shows after 150 ms, hides 600 ms after leave. Drag threshold 4 px.
- Preview is mirrored; the recording is not (matches what viewers expect to see).
- **Window mode: the bubble is constrained inside the recorded window's bounds** (§8 D4), with the same 24 pt inset, during countdown and recording. Dragging stops at the window edge. If the window moves, the bubble moves with it (position stored relative to the window). If the window shrinks, the bubble is pushed back inside; if the window is smaller than the bubble plus insets, the bubble **steps down XL → L → M → S** and returns to the chosen size when there is room. If even S doesn't fit, the bubble is hidden and the bar shows "Window too small for camera"; it reappears when the window is large enough.

### 3.3 Countdown (`03-*`)

- 3 s, one digit per second, on the target display.
- Capture frame: 4 px `--live` inner border on the whole display (Display mode) or around the window with a 45% dim outside it (Window mode). A tag names the target: "Built-in display · 1080p" / "Acme Dashboard — Chrome".
- Hints: Space (or Return) = start now, Esc = cancel (nothing written).
- Countdown UI, frame and dim are excluded from capture and removed before frame 1.
- Restart re-runs the countdown.

### 3.4 Control bar (`04-*`)

Order: grip · live dot + elapsed time · **Stop** · Pause/Resume · │ · Restart · Cancel · Camera.

| State | Visual |
|---|---|
| Recording | Red pulsing dot, white time. |
| Paused | Amber dot, amber time + the word "Paused", Pause icon becomes Play. Menu-bar icon tinted amber. |
| Camera hidden | Camera icon struck through, `fg-3`. |
| Labelled | Every control shows its keycap underneath. Shown for the first 3 recordings, and any time ⌥ is held while the pointer is over the bar. |
| Tooltip | Hover/focus after 400 ms: "Pause ⌥⇧P". Every control has one. |
| Confirm restart / cancel | Bar contents swap in place: amber dot · "Restart take? paused at 02:14" · **Keep going** (Esc) · **Restart** (⌥⇧Z). For cancel: "Discard take? paused · no file saved" · Keep going · **Discard** (⌥⇧X). **The recording pauses the moment the confirmation appears** (§8 D3), so the hesitation is not in the video. Keep going = resume. Confirm = same shortcut again, Return, or click. No timeout: the question stays until answered, because nothing is lost while paused. If the recording was already paused, Keep going returns to paused, not recording. No modal, no extra window. |
| Warning | Bar shows a one-line notice and the next actions (see §3.8). |

- Default position: bottom-centre of the recorded display, 16 pt above the Dock/taskbar. In Window mode: just below the window if there is room, otherwise inside the display's bottom edge. Draggable by the grip; remembered per display.
- Menu-bar/tray icon shows red lens + elapsed time while recording; clicking it stops.
- Shortcuts: ⌥⇧R stop · ⌥⇧P pause/resume · ⌥⇧Z restart · ⌥⇧X cancel · ⌥⇧C camera (Windows: Alt+Shift+…). Registration lifecycle in §4 (§8 D2).

### 3.5 Post-stop popup (`05-*`)

- Appears bottom-right when the file is finalised. The file is already saved as `YYYY-MM-DD HH.MM <Source>.mp4` in `~/Movies/Tally` / `Videos\Tally`.
- The name field is focused with the base name selected (extension excluded and shown dimmed).
- Actions: Show in Finder (Explorer) · Open · Delete, and a × dismiss button top-right. Shortcut hints line: ↵ rename, ⌘↵ open, ⌘R show, Esc done.
- Lifetime: **stays until dismissed** — no auto-hide (§8 D7). Dismiss = ×, Esc, or starting a new recording (the popup closes when the next countdown begins; it is content-protected, so it could never be captured anyway). Typing in the name field is committed on × dismiss; Esc keeps the current name.
- States: saved · renamed (status "Renamed", focus moves to Show in Finder) · rename conflict (red ring + line: "Return saves as 'Onboarding demo 2'") · invalid characters (stripped as you type, with a one-line note) · finalising (only if the remux takes > 300 ms: spinner, rename still allowed and applied when ready; Open/Show disabled) · deleted (popup becomes "Moved to Trash · Undo ⌘Z · ×"; Undo is available until the popup is dismissed).
- Delete moves to Trash / Recycle Bin. Undo restores to the same path.

### 3.6 Recordings window (`06-*`)

- List grouped by day (Today, Yesterday, then dates). Row: thumbnail 120×75 with duration and a camera dot if the bubble was on; name; time · quality · size.
- Row states: default · hover (actions visible: rename, open, show, delete) · selected · renaming (inline field, base name selected) · focus.
- Header: title, search (filters by name), Record button. Footer: folder path, "Change…", count and total size.
- Reads the folder on open and watches it, so renames in Finder/Explorer are reflected. Non-Tally files in the folder are listed too.
- Empty state: mark, "No recordings yet", where files go and that they stay local, "Record your screen" + ⌥⇧R.

### 3.7 First run and permissions (`07-*`)

1. **Install guidance (unsigned)** — shipped as the `.dmg` window background on Mac and the first page of the NSIS installer on Windows. Mac: open → blocked → System Settings › Privacy & Security › **Open Anyway**. Windows: SmartScreen → **More info** → **Run anyway**. Uses the OS's exact wording.
2. **Screen Recording** (Mac, first launch): two-step card. Step 1 deep-links to Privacy & Security › Screen & System Audio Recording and polls status every second ("Waiting…"). Step 2 appears done → "Reopen Tally" (focused). Settings survive the relaunch.
3. **Camera**, only when the camera switch is first turned on: an inline primer in the Camera row ("macOS will ask once") → Continue triggers the OS prompt. Denied: row shows "Camera is blocked" + Open Settings; switch returns to off; Record label becomes "Record screen only". Recording is never blocked by camera state.
4. No microphone, no Accessibility prompts. Windows shows no screen prompt; if Windows camera privacy blocks us, the same "blocked" row appears with "Open Camera privacy settings".

### 3.8 Errors (`08-*`)

| Error | Where | Behaviour |
|---|---|---|
| Screen permission denied / revoked | Popover banner above everything | Checked each time the popover opens and before every start (also for ⌥⇧R: the popover opens to show this). Record disabled with reason directly above it. Actions: Open System Settings · Reset permission… (runs the `tccutil` reset, with a confirm). |
| Source window closed mid-recording | Control bar warning | Auto-pause at the last frame (no black frames). "Window closed · paused at 03:41". Actions: Switch to display · Stop & save. Same for a display unplugged. |
| Disk low (before start) | Popover banner + amber meta | Under 5 GB: warn with minutes left at current quality. Under 1 GB: Record disabled. |
| Disk full (during) | Bar notice at 2 min left, then auto-stop | Auto-stop at 500 MB free, finalize, show post-stop popup with "Stopped — disk almost full" and "Free up space…". Footage up to that point is kept. |
| Camera unplugged | Bubble placeholder + bar toast | Screen keeps recording; the video loses the bubble from that moment. Bubble shows "Camera disconnected". If the same device returns, the camera resumes automatically. Toast auto-hides after 5 s; the bar's camera icon stays struck through. |
| Shortcut registration failed | Settings + one-time popover banner | "⌥⇧R is used by another app. Pick another shortcut." (from the teardown, P13). |

---

## 4. Keyboard and focus

**Global shortcut registration (§8 D2)** — keep the ⌥⇧ family:

| Shortcut | Action | Registered |
|---|---|---|
| ⌥⇧R (Alt+Shift+R) | Start (idle) / Stop (recording or paused) | **Always**, from app launch to quit |
| ⌥⇧P | Pause / resume | Only while a recording session is active |
| ⌥⇧Z | Restart (press twice to confirm) | Only while a recording session is active |
| ⌥⇧X | Cancel (press twice to confirm) | Only while a recording session is active |
| ⌥⇧C | Toggle camera bubble | Only while a recording session is active |

- "Recording session active" = from the first recorded frame until the file is saved or discarded. It includes paused, a confirmation being shown, and the countdown that a Restart re-runs.
- P/Z/X/C are **unregistered** immediately on Stop, Cancel, an error auto-stop (disk full) or a crash recovery, so those keys type normally again in other apps.
- They are not registered during the first countdown (Space/Return/Esc are handled locally by the countdown window there).
- If any registration fails, show the "shortcut in use" banner (§3.8) and keep the on-screen control working.

**Countdown (local, not global):** Space/Return start now, Esc cancel.

| Surface | Initial focus | Keys |
|---|---|---|
| Popover | Record | Tab order follows reading order: header buttons → source tabs → tiles/rows → option rows → Record. ←/→ between tabs and tiles; ↑/↓ in the window list; Space toggles switches; Return on a row label expands it; Esc closes. |
| Bubble | not in tab order while recording (no app focus stealing); focusable when the popover is open | Arrows move 8 pt, ⇧+arrows 40 pt, +/− zoom, B blur, H hide. |
| Control bar | never takes focus on its own while recording (does not steal focus from the app being demoed). **Exception:** while a Restart/Cancel confirmation is shown the recording is paused, so the bar takes focus (on Keep going) to receive Esc/Return, then returns focus to the previous app when answered. | Clicking a control focuses it. Esc = Keep going (resumes). Return or the same shortcut again confirms. |
| Post-stop popup | name field, base name selected | Return rename → focus Show in Finder. ⌘↵ open, ⌘R show, ⌘⌫ delete, ⌘Z undo delete, Esc dismiss (keeps current name). On Windows: Ctrl. |
| Recordings | first row | ↑/↓ select, Return rename, Space Quick Look (Mac) / open (Win), ⌘O open, ⌘⌫ delete, ⌘F search. |
| Onboarding | primary button | Return activates; Esc closes (app stays in the menu bar). |

Focus ring everywhere: 2 px `--ready` with a 2 px gap in the surface colour (`--focus`). Never removed.

---

## 5. Accessibility

- **Contrast:** all text pairs ≥ 4.5:1 (table in §2.1/§2.2). `--fg-3` is limited to meta text. Filled red controls use `--live-fill` to keep white text ≥ 4.5:1.
- **Not colour alone:** recording = dot + running timer + menu-bar timer; paused = amber + "Paused"; errors = icon + sentence; selected = tint + check/ring.
- **Screen-reader labels** (VoiceOver / Narrator):
  - Tray icon: "Tally, not recording" / "Tally, recording, 2 minutes 14 seconds, activate to stop".
  - Popover: `role=dialog` "Tally recorder". Source tabs: tablist. Window list: listbox, options read "Acme Dashboard — Overview, Chrome, selected".
  - Switches: `role=switch` with name ("Camera", "System audio") and state.
  - Bar: `role=toolbar` "Recording controls"; each button names action + shortcut ("Pause, Option Shift P"). Timer: `role=timer`, announces only state changes (paused / resumed / stopped), not every second.
  - Countdown: `aria-live=assertive`, announces "Recording starts in 3", then "Recording".
  - Confirmations: `role=alertdialog`, label "Recording paused. Restart recording? 2 minutes 14 seconds will be discarded". Focus moves to Keep going.
  - Post-stop: `role=dialog` "Recording saved", field labelled "File name", × labelled "Dismiss". Undo state: `role=status`, `aria-live=polite`, never steals focus.
  - Errors: `role=alert`.
  - Bubble: `role=img` "Camera preview, circle, small, zoom 1.4×, background blur", with the HUD controls labelled. Zoom changes announce the new value.
- **Reduced motion:** see §2.6.
- **Text size:** layouts use flexible rows; popover grows in height, never truncates action labels. Window titles truncate with a full-title tooltip.
- **Keyboard-only:** every action reachable (§4); drag of the bubble/bar has arrow-key alternatives.
- The bar and bubble HUD are excluded from capture, so accessibility UI (tooltips, focus rings) never leaks into videos.

---

## 6. macOS vs Windows

| | macOS | Windows |
|---|---|---|
| Launcher | Menu-bar icon (template image), popover drops down with an arrow | Tray icon, panel opens **upward** from the notification area, no arrow |
| Radius | Popover 14, windows 12 | Popover and windows 8 (Windows 11) |
| Window controls | Traffic lights, left | Min/max/close, right |
| Shortcut labels | ⌥⇧R glyphs | `Alt+Shift+R` spelled out |
| File manager | "Show in Finder" | "Show in File Explorer" (button text "Show in Explorer") |
| Save folder | `~/Movies/Tally` | `%USERPROFILE%\Videos\Tally` |
| Delete | Move to Trash, ⌘Z undo | Recycle Bin, Ctrl+Z undo |
| Quick preview | Space = Quick Look | Space = open in default player |
| Screen permission | Required, onboarding flow §3.7 | None; onboarding skipped |
| Camera permission | OS prompt after our primer | Windows privacy toggle; we deep-link `ms-settings:privacy-webcam` |
| Unsigned install | Privacy & Security › Open Anyway | SmartScreen › More info › Run anyway |
| Clean desktop | Cover helper (verified) | Cover helper (unverified; spec unchanged, may ship later) |
| Post-stop popup | Bottom-right, above Dock | Bottom-right, above taskbar |
| Fonts | Bundled Geist | Bundled Geist (not Segoe; keeps identity consistent) |
| Light/dark | Follows System Settings | Follows "Choose your app mode" |

---

## 7. Self-critique against the design skill (and what changed)

Checked against `ui-ux-pro-max` priorities 1–8 and the brief's "no generic defaults" rules, from the rendered screenshots.

| Found | Fix |
|---|---|
| White text on the recording red was **3.3:1** (Stop label in confirmations, capture tag, "Stop & save"). | Added `--live-fill #d92631` (4.6:1) for filled red controls. `--live` kept for dots/rings. |
| Light-theme green text was 4.2:1. | Darkened to `#2a7d18` (4.9:1). |
| Contrast numbers in tokens were estimates. | Recomputed every pair with the WCAG formula; table updated. |
| Floating surfaces had a full 1 px grey outline ring and hairline separators between option rows — the "thin grey borders" look the brief bans. | Removed both. Separation is now tone (`bg-0` well inside `bg-1` popover) + shadow + a top-only highlight. |
| Settings icon read as a sun (gear with spokes). | Replaced with a sliders glyph. |
| Post-stop popup overflowed: the name field pushed Delete and the meta line out of the panel. | Grid column `minmax(0,1fr)`, field clips; meta text shortened. |
| Restart/Cancel confirmations overlapped each other in the state sheet. | Re-laid out; confirm bar is ~500 px wide with the paused marker. |
| Recordings: inline rename field's focus ring collided with the meta line. | Added spacing under the field. |
| Install guidance had a large dead gap, and "Open Anyway" wrapped. | `align-content: start`, no-wrap on OS buttons. |
| Camera-unplugged toast broke into two columns. | Wrapped text in one span; single line. |
| Considered a card grid for window sources and the library. | Used lists: titles and dates are what users scan; grids hide them. |
| Skill default typography was Inter. | Chose Geist + Geist Mono: still technical, less default, and the mono carries timers, sizes and keycaps with tabular figures. |
| Skill says 16 px body. | Deliberately 13 px: desktop platform norm. Documented in §2.4. |

Remaining known weaknesses:
- Hit targets in the bar are 36 px (skill says 44 for touch). Acceptable for a pointer-driven utility with full keyboard coverage; revisit if we see mis-clicks.
- Thumbnails in mockups are abstract stand-ins; real thumbnails are noisier and may need a 1 px darkening inner shadow for separation.
- Light theme is mocked only for the popover.

---

## 8. Decisions (2026-10-21, approved by the user)

| # | Decision | Where it applies |
|---|---|---|
| D1 | **Name: Tally.** | §1, all copy |
| D2 | **Shortcuts: keep ⌥⇧R / P / Z / X / C.** Only ⌥⇧R is registered globally at all times. P/Z/X/C are registered only while a recording session is active and unregistered afterwards. | §3.4, §4 |
| D3 | **Restart/Cancel confirmation pauses the recording** while shown. Keep going resumes, so the hesitation is not in the video. No timeout. | §3.4, §5, mockup `04b` |
| D4 | **Window mode: the bubble is constrained inside the recorded window's bounds.** | §3.2, mockup `03b` (resolves `ARCHITECTURE.md` Q4) |
| D5 | **Rectangle shape = 16:9 overlay**, as mocked (not camera-only). Now called "Landscape". | §3.2, mockup `02` (resolves `ARCHITECTURE.md` Q5) |
| D6 | **⌥⇧R on multi-display records the display under the pointer.** | §3.1 |
| D7 | **After-stop popup stays until dismissed** (no auto-hide); × and Esc dismiss. | §3.5, mockups `05`, `05b`, `08c`, `11b` |
| D8 | **Camera options match Loom:** 4 shapes (circle, squircle, landscape 16:9, portrait **3:4**), 4 sizes S/M/L/XL (*s* = 220/280/340/400, rectangles 330–600 pt long side), background None / Blur / Image (segmentation method is engineering's choice). **Keep Tally's zoom** (1.0–2.0×, 0.1 step, face-centred). Window-mode step-down XL → L → M → S. | §2.5, §3.1, §3.2, `tokens.css`, mockups `01c`, `02`, `02b`, `02c` |

## 9. Open UX questions

1. **Labelled bar for the first 3 recordings** — helpful or noisy for developers who already read the popover hint?
2. **Light appearance for overlays:** keep dark always (proposed), or follow the OS?
3. **Countdown length for the shortcut path:** 3 s everywhere (proposed), or 1 s when started with ⌥⇧R?
4. **Name clearance:** Tally is decided; a trademark / App Store / winget name check is still to do before release.
