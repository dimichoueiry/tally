# LC-6 spike: camera Blur / Image background segmentation

Throwaway. Not app code. Measured on Apple M3 Pro, macOS 27.0, Electron 45.0.0 (Chromium WebGL on ANGLE Metal), FaceTime HD camera at **1280×720 @ 30 fps**, `@mediapipe/tasks-vision` 1.1.1. Date: 2026-10-21.

**Camera permission:** already granted to this dev Electron (`getMediaAccessStatus('camera') = granted`). No prompt was needed. A packaged app will prompt again (see `docs/ARCHITECTURE.md` §3.5).

Tags: **[V]** verified here · **[A]** assumption / estimate, not measured.

## Recommendation

| | Choice |
|---|---|
| Method | MediaPipe Tasks Vision `ImageSegmenter`, `runningMode: 'VIDEO'`, `outputConfidenceMasks: true` |
| Model | `selfie_segmenter.tflite` (square 256×256, float16, **249,537 B**) |
| Delegate | **GPU**, with `canvas:` set to the compositor's WebGL2 canvas. **CPU delegate as the fallback.** |
| Mask handling | Keep the mask on the GPU: `mask.getAsWebGLTexture()` inside the `segmentForVideo` callback. **Never** `getAsFloat32Array()` on the GPU path. |
| Input | The 720p camera frame as-is (MediaPipe resizes internally). For the bubble, crop to the bubble region first (see integration). |
| Compositing | WebGL2, same GL context as the segmenter (`compositor.js`). Blur at ¼ res, 2× separable 9-tap passes, step 1.6 texels, mask-aware (no halo). |
| Smoothing | Adaptive EMA on the mask: α = 0.45, gain = 2 (`a = mix(0.45, 1, clamp(|new−prev|·2))`). Feather: 9-tap gaussian at mask res, step 1.0. Joint-bilateral edge refine (5×5, σ = 0.012). Edge `smoothstep(0.50, 0.90)`. |
| Not chosen | `selfie_multiclass_256x256`. It gives the best edges, but it is 16 MB, needs a 4.3 s GPU warm-up, and the CPU fallback is unusable (168 ms). Keep it as a possible "High quality" option later. |

**Why:** with the GPU delegate the renderer main thread spends **0.9 ms** per frame (p95 1.5), and the full GPU work (segment + composite) finishes in **~7 ms** (p95 10). The CPU fallback still fits a 30 fps budget at 8.3 ms (p95 10.8). One engine, one model and one shader set run on Mac and Windows.

## Results (720p input, 330 measured frames each after 30 warm-up frames)

`seg` = time inside `segmentForVideo` (+ mask callback) on the renderer thread. `frame` = seg + composite **with a 1-px `readPixels` forcing GPU completion** (the true end-to-end GPU latency). CPU % = cumulative CPU time ÷ wall time (100% = one core), from `app.getAppMetrics()`. Raw data: `results.json`, `results-recommended.json` **[V]**.

| Config | Load / warm-up ms | seg med / p95 ms | frame med / p95 ms | fps | CPU % renderer / GPU proc / all |
|---|---|---|---|---|---|
| No segmentation (baseline) | – | – | 2.0 / 4.5 | 30.0 | 6 / 11 / 21 |
| **GPU selfie** (recommended) | 59 / 142 | **0.8 / 1.5** | **7.2 / 10.0** | 29.9 | **8 / 23 / 33** |
| GPU selfie, no sync (what the app pays on the CPU) | 50 / 95 | 0.9 / 1.4 | 0.9 / 1.5 | 30.0 | 8 / 22 / 32 |
| GPU landscape (144×256) | 65 / 98 | 0.8 / 1.6 | 7.2 / 9.8 | 30.0 | 8 / 24 / 34 |
| GPU multiclass | 151 / **4346** | 0.8 / 1.4 | 15.0 / 16.3 | 29.9 | 7 / 33 / 42 |
| GPU selfie + **readback** (`getAsFloat32Array`, old spike's way) | 43 / 90 | 8.0 / 10.3 | 11.3 / 14.5 | 30.0 | 11 / 29 / 42 |
| GPU selfie, Image bg | 52 / 90 | 0.9 / 1.7 | 7.5 / 10.8 | 30.1 | 8 / 24 / 35 |
| GPU selfie, no edge refine | 57 / 122 | 0.8 / 1.5 | 7.1 / 10.0 | 30.0 | 7 / 24 / 34 |
| GPU selfie, no smoothing at all | 40 / 97 | 0.7 / 1.4 | 6.7 / 9.6 | 30.0 | 7 / 23 / 33 |
| **CPU selfie** (fallback) | 91 / 64 | **8.5 / 11.2** | 12.0 / 15.6 | 30.0 | 24 / 16 / 42 |
| CPU selfie, input downscaled to 640×360 | 72 / 19 | 6.7 / 9.3 | 9.8 / 12.6 | 30.0 | 21 / 12 / 35 |
| CPU landscape | 77 / 19 | 5.7 / 6.1 | 9.4 / 10.0 | 30.0 | 14 / 14 / 30 |
| CPU multiclass | 177 / 207 | **168 / 170** | 171 / 173 | **5.7** | 96 / 4 / 102 |

Reading the table:
- **Blur costs about +12% of one core on GPU and +21% on CPU**, over the 21% baseline (camera decode + texture upload + draw).
- Edge refine and smoothing cost almost nothing on the GPU (≤0.5 ms).
- **The old spike's "GPU stalls" had two causes, both fixed here.** (1) The first GPU inference compiles shaders and blocks for **~4.4 s** (measured 4406 ms on frame 1 before the warm-up was added). (2) `getAsFloat32Array()` read a 1280×720 float mask back from the GPU each frame (+7 ms on the main thread).
- MediaPipe returns the confidence mask at **input** resolution (1280×720), not 256×256 **[V]**. On the CPU path that is a 3.7 MB float array per frame, which is why downscaling the input helps the CPU path.

### Temporal stability (same 60-frame burst replayed through each config)

Flicker = mean |αₜ − αₜ₋₁| per pixel, 0–255 scale. It includes real hand motion, so only the relative numbers matter **[V]**.

| Config | Flicker |
|---|---|
| No smoothing (hard threshold) | 0.419 |
| Adaptive EMA α 0.7 | 0.346 |
| **Adaptive EMA α 0.45 (recommended)** | 0.250 |
| Adaptive EMA α 0.3 | 0.198 |
| Fixed EMA α 0.45 (gain 0) | 0.215 |
| Multiclass, α 0.45 | 0.111 |

The adaptive EMA scores slightly worse than the fixed one on this metric on purpose: it lets large changes (a moving hand) through immediately, so it never leaves ghost trails. α 0.3 showed no visible lag on the waving-hand crops, so it is a safe setting if users report shimmer.

## Edge quality

Screenshots, all in `spike/blur/shots/` **[V, looked at]** (screenshots removed from the public repo):
- `edges/edges-grid.png`: hair / hand / shoulder crops. Rows: raw, no smoothing, no refine, recommended, CPU, landscape, multiclass, Image bg. All rows come from the **same frame**.
- `edges/image-threshold-grid.png`: Image background at edge thresholds 0.35–0.75 vs 0.5–0.9, plus multiclass.
- `cmp-*.png` / `cmp-*-mask.png`: full 720p before/after frames and masks for every config, all from the same captured burst (`cmp-raw.png` is "before").
- `*.png` without the `cmp-` prefix: live frames from the timed benchmark. These were taken at different moments, so they are not comparable with each other.

What I saw:
- **Hair:** the overall outline is clean, but single stray strands are lost (blurred or replaced) by every model. Multiclass keeps slightly more texture at the hairline. Typical for 256-px models; Loom's Vision result is better here **[A, not compared side by side]**.
- **Hands:** the fingers are cleanly separated from the background. The gaps between fingers partly keep a smear of wall (visible in Image mode). The hard-threshold mask is jagged and has holes; feather + refine fixes that.
- **Shoulders:** with the looser 0.35–0.75 threshold, Image mode showed a light rim of the original wall along the shoulder. At **0.5–0.9 the rim mostly goes away** (multiclass removes it fully). Part of the mesh chair behind the shoulder gets classed as "person".
- Blur mode hides edge errors much better than Image mode. Image mode is the real quality test.

## Licences and sizes (for bundling in a free app)

| Item | Licence | Size |
|---|---|---|
| `@mediapipe/tasks-vision` 1.1.1 (JS + WASM) | Apache-2.0 (`package.json`) **[V]** | `vision_bundle.mjs` 156 KB, `vision_wasm_internal.js` 334 KB, `vision_wasm_internal.wasm` **13.5 MB** |
| `selfie_segmenter.tflite` (+ landscape) | Apache-2.0 (model card "MediaPipe Selfie Segmentation", 2021) **[V]** | 249,537 B / 250,177 B |
| `selfie_multiclass_256x256.tflite` | Apache-2.0 (model card "Multiclass Segmentation", 2023) **[V]** | 16.4 MB |

- Apache-2.0 allows redistribution in a free app. Ship the licence text and a NOTICE / credits entry **[A, standard]**.
- Only the SIMD wasm is needed. Every Electron 45 build has WASM SIMD, so skip the `nosimd` and `module` variants (−26 MB).
- **Telemetry:** tasks-vision posts usage logs to `https://odml.pa.googleapis.com/v1/log` on load and then every 60 s, and the API has no opt-out **[V: blocked requests in every run, code in `vision_bundle.mjs`]**. The spike cancels them in `session.webRequest.onBeforeRequest`; after a failure the logger stops itself. The app must do the same (plus a CSP `connect-src`) to stay local-only.

## Integration notes for M2

**Where it plugs in.** `app/src/renderer/engine/segmenter.ts` + `shared/blur.ts` (per the ARCHITECTURE file tree):

```
camera <video> 1280×720
  └─ crop to bubble aspect × zoom (drawImage into a square/16:9/3:4 canvas)   ← segment only what is shown
       └─ ImageSegmenter.segmentForVideo(crop, ts, cb)   [GPU delegate, canvas = bubble GL canvas]
            └─ cb: compositor.pushMask(mask.getAsWebGLTexture())  (EMA + feather, mask res)
       └─ compositor.render(crop)  → bubble GL canvas (blur | image | none)
  bubble GL canvas → engine 2D composite: ctx.save(); clip(bubbleShapePath); ctx.drawImage(glCanvas, …); ctx.restore()
```

- **Crop before segmenting.** Zoom 1.0–2.0× and the bubble shapes (1:1, 16:9, 3:4) only show part of the frame. Segmenting the crop puts all 256 model pixels on the visible area. At zoom 2×, that doubles the effective mask resolution **[A]**. `ImageProcessingOptions.regionOfInterest` exists, but the bundle throws "This task doesn't support region-of-interest" for some tasks. Untested here, so crop with `drawImage`.
- **Output size.** XL bubble = 400 pt ≈ 800 px at 2×, so a ~800 px square output is enough. The compositor cost scales with output pixels; it is already cheap at 720p.
- **Warm-up at load, not on the first recorded frame.** Call `segmentForVideo` once right after `createFromOptions` (the first GPU call blocks for seconds). Do this when the user selects Blur/Image, or at app idle, never at Record.
- **Monotonic timestamps.** VIDEO mode throws `INVALID_ARGUMENT: CalculatorGraph::Run() failed` if a timestamp goes backwards **[V, hit it]**. Use one `performance.now()`-based clock per segmenter instance.
- **GL context lifecycle.** Switching method/model 7+ times without freeing contexts hung the page. Call `segmenter.close()` **and** `WEBGL_lose_context.loseContext()` on the old canvas **[V]**. In the app, keep one segmenter per window and change only the bg mode/settings; the bg mode needs no re-init.
- **Mask orientation.** The GPU mask texture and the CPU float array are both image-space, row 0 = top **[V]**.
- **Duplicate work.** The bubble preview and the engine each run a segmenter (ARCHITECTURE §4). On GPU that is ~2× (8% + 23%) of one core, still fine **[A for two instances]**.

**Offline bundling.**
- Ship `vision_bundle.mjs`, `vision_wasm_internal.{js,wasm}` and `selfie_segmenter.tflite` under `resources/` (`extraResources`). Serve them through a privileged `app://` scheme (`standard, secure, supportFetchAPI`) with `protocol.handle`, exactly as `main.js` does.
- `FilesetResolver.forVisionTasks('app://…/vendor')` and `modelAssetPath: 'app://…/models/selfie_segmenter.tflite'` load with **zero network** **[V: every non-`app:` request was cancelled and the demo still worked]**.
- The `.wasm` needs a `application/wasm` content type for streaming compile.

**GPU fallback ladder.** Pick the delegate once per launch and remember it:
1. Probe WebGL2 on a throwaway canvas. If there is no WebGL2, or `UNMASKED_RENDERER_WEBGL` contains `SwiftShader` / `llvmpipe` / `Microsoft Basic Render`, use **CPU** (a software "GPU" would be slower than the WASM CPU path) **[A]**.
2. Try `createFromOptions({delegate: 'GPU'})` + warm-up inside try/catch. On a throw, or a warm-up longer than ~8 s, use CPU.
3. At runtime, on `webglcontextlost` or a rolling median over 25 ms for 60 frames, rebuild with CPU. If CPU is also over 30 ms, use input 640×360 and segment every 2nd frame. The EMA hides the skipped frames.
4. Last resort: turn the background off and show a one-line notice. Never stall the recording.
- Here, the compositor's own shaders run in WebGL2 on both paths; only the segmenter delegate changes.

## Windows risks (not tested; no Windows machine)

- **GPU path via ANGLE D3D11** instead of Metal. MediaPipe's WebGL2 GPU delegate is designed for this, but driver quirks (Intel UHD, old AMD drivers) can produce wrong masks or blocklisted WebGL **[A]**. The fallback ladder above covers this, but it needs a real test.
- **CPU speed:** 8.5 ms on an M3 Pro performance core. A low-end i3/Celeron laptop could be 3–5× slower (25–40 ms) **[A, estimate]**. Use the landscape model or the 640×360 input there (both faster on CPU here: 5.7 / 6.7 ms), or segment every 2nd frame.
- **Hybrid GPUs:** Electron may pick the integrated GPU; fine for this load **[A]**.
- **Cameras:** many Windows webcams deliver 720p only at lower fps, or as MJPEG with higher decode cost **[A]**.
- **First-frame stall** is driver shader compile time and may be longer on Windows. Warm up early **[A]**.

## Open questions

1. Is selfie_segmenter's hair edge good enough versus Loom (Apple Vision)? If not, the next step is multiclass on GPU only (16 MB extra, 4 s warm-up hidden at idle), not a new library.
2. Default background image set: needs licensed images (the spike uses a generated gradient, `assets/office.jpg`).
3. Should "Transparent" (cut-out, no box, Loom has it) be in v1? It falls out of this pipeline for free (alpha = mask).
4. Should the preview and engine share one segmentation pass (stream frames to the bubble) to halve the cost? It only matters for the CPU fallback.
5. Other candidates were not tested. ONNX Runtime Web + RVM is GPL-3.0, so it can't ship. MODNet / PP-HumanSeg would need ONNX conversion and WebGPU, with no clear win over 7 ms GPU. Not worth it unless question 1 fails.

## Running it

```
cd spike/blur
../node_modules/.bin/electron .                   # interactive demo: method / model / bg / smoothing sliders + live ms
../node_modules/.bin/electron . --bench           # all configs, writes results.json + shots/*.png
../node_modules/.bin/electron . --compare         # 5 s countdown, captures 60 frames to shots/burst/, replays every config
../node_modules/.bin/electron . --compare --replay   # re-run the comparison on the saved burst
```

(Or `npm install && npm run demo` standalone.) `shots/burst/` holds 60 JPEGs of the user's camera (6.8 MB). Delete it when you're done.
