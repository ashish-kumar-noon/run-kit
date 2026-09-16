# Idle CPU — measured decomposition and the fixes that clear the floor

**Drafted**: 2026-09-16 · against `b020adf9` · from the 2026-09-16 `/fab-discuss` session on Electron-app CPU usage
**Shape**: 5 changes, one repo (run-kit). Change 0 (the instrument) first; changes 1 and 2 in parallel from their own worktrees off main once 0 has merged; change 3 after 1 and 2 have merged (it re-baselines against their result); change 4 is file-disjoint and may run any time after 0. Plus two backlog ideas that are NOT changes.
**Contract of record**: the measurement table in this plan (§ Measurements) and project memory `idle-cpu-profile-2026-09-16` (the recipe). Pre-change truth: `docs/memory/run-kit/ui/visual-design.md` (flairs), `ui/status-signals.md` (halo/seam), `ui/terminal.md` (xterm renderer + fallback), `api-and-sockets.md` (state socket), `architecture/testing.md` (test layers — the instrument lands here).

## Why this plan exists

The desktop app sits at 20–30% CPU while agents run and nobody touches it. The assumption was "the web output". Measured against the live daemon, the renderer's JavaScript — xterm parsing, the state socket, React re-rendering — is 1–3% of a core. The rest is **continuous painting**: flair overlays and the waiting halo tick the main thread 60×/s, and xterm's WebGL layer draws the visible terminal. Two independent code surveys ranked the React re-render path first; the measurement puts it under the noise floor. Every decision below is taken from the measurement, not from the surveys.

## Decisions of record

- **Selection method**: measured marginal gain from an A/B run (same page, one mechanism disabled) against the instrument's noise floor (~3 points of one core, run-to-run), a stopping rule (stop when the next item is below the floor or its fix cannot be verified by re-running the A/B), and an independence check (parallel only when file surfaces are disjoint). This is the method for *future* CPU work too — measure first, rank by delta, never by code review.
- **Flairs stay.** They are a chosen feature (`@rk_win_flair`, session flair, server flair from config.yaml). The fix is to make them cheap or make them stop ticking when nobody can see them — never to remove or default them off.
- **Attention stays visible without motion.** The halo already has a static reduced-motion form (a yellow ring). Whatever replaces the box-shadow pulse must keep the ring visible while waiting; motion is additive, never the only encoding (status-pyramid.md § The Channel Model).
- **The instrument is a `just` recipe**, not an e2e test. It measures a live daemon with real agents, which no CI rig has, and its numbers are host-dependent. It belongs beside `just pw` as an ad-hoc tool (`scripts/` holds the logic per Constitution VIII), with its recipe documented in `architecture/testing.md`.
- **Backend dedup is hygiene, not a CPU fix.** It did not clear the floor on a single renderer. It is still taken (change 3) because it multiplies across every warm Electron `WebContentsView` and every open tab, and because its acceptance (messages/s) is objective without CPU measurement.
- **The xterm WebGL→DOM fallback is not fixed here.** One run in nine fell back and doubled renderer cost (39% vs 21%). Frequency on the user's Mac is unknown; without that number the fix cannot be sized. Change 4 adds the one line of telemetry that produces the number.
- **The code tile is out of scope.** ~15% renderer while shown is VS Code's own cost and by design; its hidden/remount behaviour is already decided (project memory `code-tile-remount-on-tab-switch`, P3 LRU).

## Measurements (2026-09-16, headless Chromium `channel: chromium`, no GPU → software rendering, 30 s idle samples, % of one core)

Live daemon `:3000`, 4 tmux servers, ~100 windows, 3 agents active. "Renderer" is the page's renderer process, "GPU" the GPU process (software here — expect a lower GPU column on a Mac; the renderer column transfers).

| Scenario | Renderer | GPU | Style recalcs / 30 s | Note |
|---|---|---|---|---|
| `/` host overview | 3.1 | 0 | 0 | state socket only |
| `/` + 4 injected `.rk-waiting-halo` dots | 6.7 | 1.0 | 1802 | +3.6 for four dots; scales with waiting agents × render sites |
| `/runKit` server page (5 flair overlays visible) | 14.8–18.6 | 5.8 | 1803 | two runs; the spread is socket-rate noise |
| `/runKit` reducedMotion emulated | 4.3 | 0 | 1 | all animations off |
| `/runKit` aquarium animations off | 13.9 | 5.2 | 1803 | aquarium ≈ 4.7 |
| `/runKit` nemo animations off | 11.3 | 5.3 | 1803 | nemo ≈ 7.3 — transform-based, still the worst |
| `/runKit` cube animations off | 15.1 | 4.5 | 1803 | cube ≈ 3.5 + 1.3 GPU |
| `/runKit` every flair off | 4.3 | 0.4 | 134 | |
| `/runKit/@99` tty tile, idle window | 21.4 | 8.8 | 2146 | flairs + xterm WebGL |
| `/runKit/@109` tty tile, active agent | 23.2 | 9.8 | 2452 | matches the reported 20–30% |
| `/runKit/@109` reducedMotion | 19.2 | 3.6 | 710 | busier stream that run (22 msg/s) |
| `/runKit/@4` tty + live code tile | 38.0 | 9.0 | 1920 | VS Code iframe ≈ +15 |
| `/runKit/@99` after WebGL context failure (DOM renderer) | 39.1 | 6.5 | 1105 | 15 231 DOM nodes; `createRow`/`replaceChildren` dominate |

JS attribution (CPU profiler, 30 s): `main-*.js` 47–390 ms, `xterm-*.js` 300–1170 ms, everything else < 150 ms. State socket 3.3–13 msg/s depending on rename churn (every `cd` in an agent pane is a `%window-renamed` control-mode bump because `automatic-rename-format '#{b:pane_current_path}'`). Terminal relay 45–115 kB/s for one visible pane. Go daemon ≈ 5% of a core.

Flair sources on the live box: server flair `nemo` on runKit and `aquarium` on loom — each rendered **twice** (sidebar server header `sidebar/index.tsx:2781` and the servers panel row `sidebar/server-panel.tsx:379`) — plus window flair `cube` on `runKit:rebranding-study` (`window-row.tsx:779`). Style recalcs stayed at 60/s until the last flair was disabled, so **no flair type composites today, transforms included**.

## Standing context (carry into every change's intake)

- **Instrument**: `just perf-idle-cpu <path> [seconds] [--reduced-motion] [--inject <js>] [--then <path>]` (change 0). Every acceptance criterion below is a re-run of it against a live daemon; record the before/after table in the change's plan.md. Noise floor ≈ 3 points; a claimed gain smaller than that is not a gain.
- **Oracle for "does it composite"**: `RecalcStyleCount` per 30 s from `Performance.getMetrics`. Baseline with no animations is ~130 on `/runKit`, ~700 on a tty route (xterm + React). A main-thread animation adds ~1800 (60/s). `document.getAnimations()` count tells you how many are running.
- **Files**: `app/frontend/src/globals.css` § Flair overlays (lines 670–1846 at `b020adf9`, reduced-motion gate at 2057+), `.rk-waiting-halo` 465–478, `.rk-waiting-seam` 495–502; `components/flair-overlay.tsx` (single mount, child markup for cube/warp/nemo); `components/status-dot.tsx:103` (halo class); `board/board-pane.tsx:184` (seam); `components/terminal-client.tsx:500–517` (WebglAddon + `onContextLoss`); `app/backend/api/sse.go` hub loop 1755–2033 (global broadcasts 1921–1972, `if !resultsOnly` gate 1979, `previousJSON` dedup 2216), `internal/tmux/tmux.go:823,1553,1672` (`activityTimestamp`).
- **Constitution**: IV (no new settings surface — if a preference is needed it is one key in the `internal/settings` registry, default on), V (nothing here adds a user action), VIII (justfile one-liner → `scripts/`), Test Intent Comments for any e2e touched; no change-ID/PR citations in code comments.
- **Verification per change**: `npx tsc --noEmit` + affected Vitest files + the instrument before/after; scoped e2e only where a spec already covers the surface (`just test-e2e "control-gallery"` if `status-dot.tsx` classes change — the gallery has PNG baselines). Never the full suite as a gate.
- **Playwright ad-hoc rule**: bare `playwright` is not installed; `@playwright/test` with `NODE_PATH=app/frontend/node_modules`, `chromium.launch({ channel: "chromium" })` (the headless shell lacks `SystemInfo.getProcessInfo`). Fresh worktree ⇒ `pnpm install --frozen-lockfile` in `app/frontend` first.

## Sequencing & merge topology

```
0 instrument ──┬──> 1 flairs ────┬──> 3 socket dedup
               ├──> 2 halo/seam ─┘
               └──> 4 webgl telemetry (any time)
```

- **0 → {1, 2}**: both acceptance gates are the instrument. 1 and 2 are file-disjoint (different `globals.css` sections, different components) and run in parallel from separate worktrees off `origin/main` after 0 merges.
- **{1, 2} → 3**: change 3's before/after is measured with animations already fixed so its (small) delta is not buried in animation noise; it also touches `session-context.tsx`, which 1 and 2 do not, but the ordering is about measurement, not conflicts.
- **4** touches only `terminal-client.tsx` + `ui/terminal.md`; no ordering constraint beyond wanting the instrument for its own before/after (it has no CPU claim; the instrument is used only to prove zero regression).
- Lane hints: 0 and 4 light lane; 1 and 2 full lane (1 has a research phase); 3 full lane (backend + frontend).

## Pre-intake research (do before writing each intake; results go into the intake's Assumptions)

**R0 — instrument portability (before change 0)**
- Run the appendix script on the user's Mac against the same daemon URL once (`rk url` gives it; Tailscale reaches it from the desktop). Record the hardware-GPU table for the same five scenarios. If the Mac's GPU column is near zero, the plan's GPU claims are dropped from acceptance and only the renderer column is gated.
- Confirm `SystemInfo.getProcessInfo` works on the Mac Playwright chromium (it did on Linux). If not, fall back to `ps -o %cpu` on the renderer pid, which the script can find via `browser.process()`.

**R1 — why flairs do not composite (before change 1; this is the change's first task, but the intake needs the hypotheses ranked)**
Hypotheses, in order to test with the recalc oracle, one at a time, on a scratch copy of `globals.css`:
1. **Container-query units in keyframes** — nemo's swim keyframes use `100cqw` inside `transform: translateX(calc(...))` (`globals.css:1270–1278`); cube's `.rk-flair-cube { container-type: size }`. Blink resolves `cq*` units on the main thread; a keyframe that depends on them is likely un-compositable. Test: replace `100cqw` with a fixed px value and re-measure nemo alone.
2. **Animated pseudo-elements with `background-position`** — aquarium's `::before` (`:1085–1090`), plus rain/matrix/scan/nyan/etc. `background-position` is never composited. Test: aquarium off vs on is already measured (≈4.7); the fix is a sprite on an inner element moved with `transform`, as nemo does.
3. **Many small transform animations without a compositing hint** — nemo's 4 tail + 4 fin + 6 sway spans, cube's 3 nested rotations. Test: add `will-change: transform` on the animated spans and re-measure; if recalcs drop but GPU rises, layer count is the trade.
4. **The `alternate` + `linear infinite` combination on `.rk-cube-x/.rk-cube-y` with `perspective`** — `perspective` on an animated ancestor can force main-thread updates of descendants. Test: pause cube-x/cube-y, keep cube-spin.
Record per hypothesis: recalcs/30 s, renderer %, GPU %, and whether the visual is unchanged (screenshot pair). The intake's approach section names the winning hypothesis; if none composites a given flair, that flair falls to the pause-when-hidden path (below).

**R2 — flair visibility gating semantics (before change 1)**
- Which flair rows are on screen at once in practice: the sidebar server header and the servers panel row both render the server flair — is the servers panel normally expanded on the user's setup? If both are visible the double render is real cost; if the panel is collapsed, the row is already unmounted (check `collapsible-panel.tsx` behaviour: hidden vs unmounted).
- Does the flair overlay for a sidebar row scrolled out of view keep animating? (Expected yes — CSS animations do not observe viewport intersection.) Decide whether an `IntersectionObserver` → `animation-play-state: paused` gate is worth its bookkeeping, or whether `content-visibility: auto` on the row container gets it for free (Blink skips animation ticking for `content-visibility` skipped subtrees). Measure both on a sidebar with ~30 rows, half off-screen.
- `document.visibilityState === "hidden"`: Chromium already stops compositor frames for hidden tabs and detached Electron `WebContentsView`s, so no work is needed there — verify once on the Mac by measuring a detached view's renderer via Activity Monitor.

**R3 — halo geometry without box-shadow (before change 2)**
- Count how many `waiting` dots render simultaneously for one waiting window on the user's layout: candidates are `sidebar/window-row.tsx`, `sidebar/status-panel.tsx`, `surface-layout.tsx` tile header, `status-bar.tsx`, `session-tiles.tsx` (server page only), `watched-table.tsx` (console only). Typical desktop tty route ⇒ 4.
- The replacement must keep the ring's 1.5px→3px growth and 55%→85% alpha *look* (status-pyramid.md), rendered as a `::after` ring (border or `outline` on a pseudo-element) animated with `transform: scale()` + `opacity`, both composited. Check that the `done` square keeps square corners (the current comment at `globals.css:470–476` explains why there is no `border-radius` on the halo rule) — a pseudo-element must inherit the dot's radius via `border-radius: inherit`.
- `control-gallery.spec.ts` PNG baselines: the gallery renders every dot state incl. waiting; any class change on `status-dot.tsx` is changed surface for that spec (`code-quality.md` § Verification). Budget the baseline regeneration.

**R4 — socket dedup baseline (before change 3)**
- With the instrument, record `/ws/state` msg/s and kB/s by event type over 60 s in two regimes: (a) agents streaming without `cd`s (quiet), (b) an agent running a shell-heavy task (rename churn). Today: 3.3 msg/s quiet, 13 msg/s churn; `metrics`/`services`/`code-server`/`gui` each ≈ 0.7–1.4/s regardless of change.
- Confirm on the daemon which wake source dominates (`sse.go:2569–2700` `waitForNext`): add a temporary counter or read the existing debug log. If it is the results-wake (unit completions) rather than renames, the fix is the gate placement; if renames, it is dedup.
- Decide the `activityTimestamp` treatment: quantize to the existing `ActivityThresholdSeconds` bucket (`tmux.go:447`, 10 s), or drop it from the dedup key only (compute the key on a copy with the field zeroed) while still sending it. The client uses it for the idle-duration label; check `window-row.tsx` / `status-panel.tsx` consumers before changing its meaning.

**R5 — WebGL fallback frequency (before change 4; small)**
- Read `terminal-client.tsx:500–517`: what happens on `onContextLoss` today (dispose WebGL, silent DOM fallback). Confirm there is no existing telemetry (`grep -rn "contextloss\|context lost" app/`). Decide the surface: a `console.warn` plus a one-shot toast is visible to the user; a `/api/...` post is not wanted (Principle X — nothing pushes derivable state; this is not derivable, but a client-only log is enough for a frequency count).

---

## Change 0 — the idle-CPU instrument (slug: `perf-idle-cpu-instrument`)

**Intake seed**: Add `just perf-idle-cpu` — an ad-hoc Playwright/CDP probe that loads one rk route against a live daemon, idles for N seconds, and prints per-process CPU %, renderer main-thread breakdown (task/script/style/layout, recalc and layout counts), running-animation inventory, per-socket message and byte rates by event type, and the top JS self-time entries — so every CPU claim in the repo is a re-runnable number.

1. `scripts/perf-idle-cpu.sh` (arg parsing, `NODE_PATH` to `app/frontend/node_modules`, base URL from `rk url` unless `--url` given) → `scripts/perf-idle-cpu.mjs` (the appendix script, cleaned: flags `--seconds`, `--reduced-motion`, `--inject <js>`, `--then <path>`, `--json <file>`, `--viewport WxH`). Justfile: `perf-idle-cpu *args:` one-liner (Constitution VIII).
2. Output: a one-line summary per run (renderer %, GPU %, recalcs, layouts, anims, xterm count, iframes, per-socket msg/s + kB/s) plus optional JSON with the full profile. Exit non-zero if the page failed to load.
3. Docs: `architecture/testing.md` gains a § Performance probes entry (what it measures, the noise floor, the reducedMotion trick, the `channel: "chromium"` requirement, the two caveats: software GPU on headless Linux, and one instance at a time — concurrent runs skew each other). `README`/help-dump: check `shll standards help-dump` only if the recipe shows in user-facing help (it is a dev recipe; likely not).
4. Tests: none beyond a `--help` smoke; the script is a tool, not a product surface.

Non-goals: CI integration; asserting thresholds; measuring the Electron shell itself (use Activity Monitor for that; the SPA numbers are what the shell renders).

## Change 1 — flairs stop ticking the main thread (slug: `flair-compositor-only`)

**Intake seed**: Flair overlays run on the compositor — or pause when their row is not visible — so five on-screen flairs cost within noise of no flairs, with every flair's look unchanged.

1. **Research phase = R1 executed** on the three live flair types first (nemo, aquarium, cube), then the remaining sheet flairs (rain, scan, nyan, matrix, warp, spidey, ironman, invaders, pacman, noon, onepiece, naruto, roadrunner). Each flair ends in one of two buckets: *composited* (recalcs at baseline while running) or *paused-when-hidden* (could not be composited without changing its look).
2. **Composited bucket**: keyframes use only `transform`/`opacity`; no `cq*` units in keyframes (measure the container once — a CSS var set from a `ResizeObserver` in `flair-overlay.tsx`, or fixed px where the row width is fixed); sprite sheets move on an inner element via `transform`, not `background-position` on a pseudo; `will-change: transform` only where R1 showed it needed. Visual parity by screenshot pair at 1× and 2×.
3. **Server flair renders once**: decide with R2 — either the servers panel row or the sidebar header carries the overlay, not both; or the second is a static frame (first keyframe, `animation-play-state: paused`).
4. **Pause-when-hidden**: `content-visibility: auto` on the sidebar row list container if R2 shows it stops ticking off-screen rows without layout jank; otherwise an `IntersectionObserver` in `flair-overlay.tsx` toggling a `data-flair-paused` attribute that CSS maps to `animation-play-state: paused`. The flair picker preview in `swatch-popover.tsx` keeps running (it is the point of the preview).
5. **Acceptance** (instrument, live daemon, `/runKit` with the same five overlays): renderer within 3 points of the every-flair-off run; `RecalcStyleCount` within 200 of it; `document.getAnimations()` still reports the flairs running (they must not be silently stopped on screen). Record the per-flair table in plan.md.
6. **Tests**: Vitest for `flair-overlay.tsx` markup changes; no e2e covers flairs today — do not add one for motion (the instrument is the gate).

Non-goals: new flairs; a global "ambient motion" setting (reduced-motion already exists); changing which rows may carry a flair.

Memory: `ui/visual-design.md` § Flair overlays gains the compositing rule ("keyframes animate transform/opacity only; no container-query units; sprite motion on an inner element") and the pause-when-hidden mechanism; Design Decisions gains "Flairs must not tick the main thread" with the 2026-09-16 numbers.

## Change 2 — waiting halo and seam without main-thread paint (slug: `waiting-halo-composited`)

**Intake seed**: The waiting halo pulses via a composited pseudo-element ring (transform + opacity) instead of an animated box-shadow, and the board pane's waiting seam via a composited overlay instead of animated border-color, so N waiting agents cost within noise of zero — the ring stays visible and static under reduced motion as today.

1. `globals.css:465–478`: `.rk-waiting-halo` becomes a `position: relative` host with `::after { inset: -1.5px; border: 1.5px solid <signal yellow @55%>; border-radius: inherit; animation: rk-waiting-halo 1.4s ease-in-out infinite }` where the keyframes animate `transform: scale()` and `opacity` to reproduce the 1.5→3px / 55→85% look. Verify the `done` square keeps square corners and the `failed` bullseye keeps its center (R3). Reduced-motion block: the pseudo stays as a static ring (no `animation`), matching today's static ring.
2. `globals.css:495–502` + `board-pane.tsx:184`: `.rk-waiting-seam` gets the same treatment — a pseudo-element ring over the 3px border animated via `opacity`; the static `border-color` remains as the reduced-motion form and as the non-animated base.
3. `status-dot.tsx`: no logic change; if the halo needs a wrapper (a pseudo on an `inline-flex` span works, so probably not), keep the additive contract in the file header comment.
4. **Acceptance**: instrument on `/` with `--inject` adding 8 waiting dots (double today's 4-dot probe): renderer within 3 points of plain `/`; recalcs within 200 of it. Plus one real check: pick a live waiting window on the tty route and compare before/after.
5. **Tests**: `status-dot.test.tsx` class assertions; `just test-e2e "control-gallery"` and regenerate both PNG baselines if any pixel of the waiting cell changed — review the diff by eye (only the waiting cells may change, and only sub-pixel).

Non-goals: the halo's timing, colour, or semantics; the watched underbar (static already).

Memory: `ui/status-signals.md` § Waiting halo rewrites the mechanism (pseudo ring, composited) and records the box-shadow retirement with the measured reason; `docs/specs/status-pyramid.md` needs no change (the channel model is unchanged) — confirm during hydrate.

## Change 3 — state-socket broadcasts only when something changed (slug: `state-socket-broadcast-dedup`)

**Intake seed**: The `/ws/state` hub emits `metrics`, `services`, `code-server` and `gui` only when their JSON changed and only on dispatch ticks, and a `sessions` frame is not re-sent when nothing but `activityTimestamp` moved — so a quiet host pushes near-zero frames and every warm renderer parses proportionally less.

1. `sse.go:1921–1972`: compare each marshalled payload with its `cached*JSON` slot before `broadcastGlobalLocked`; skip on equality. Move the four global broadcasts below the `if !resultsOnly` gate at `:1979` (a fold-only tick has nothing new to say) — unless R4 shows a reason a completion tick must carry them. `guiTick` (`:770`) stops calling `settings.Load()` per tick: load on the settings-changed path and cache, or gate the read behind the same dedup.
2. `sse.go:2216` + `tmux.go:823`: the dedup key excludes or quantizes `activityTimestamp` (R4 decides); the wire payload is unchanged.
3. Client (`session-context.tsx:924–952`): with server-side dedup the per-message `JSON.stringify` keys become redundant — keep them (defence in depth) but remove the unconditional per-server `updateSlice(name, { metrics })` fan-out at `:934–936` in favour of a changed-check, since it re-renders the whole tree on identical data.
4. **Acceptance**: instrument's per-socket table, 60 s, both R4 regimes: quiet regime ≤ 0.3 msg/s (the 12 s safety tick only), churn regime ≤ 1 `sessions`/s per subscribed server with the four globals at their 2.5 s collector cadence or less; renderer CPU on `/` not worse than before (it is ~3 today — the CPU claim is "no regression", the gain claim is the message count). Backend: `go test ./api/...` for the hub — `previousJSON` dedup is exercised in `sse_test.go`, `sse_race_test.go`, `present_test.go` and `update_test.go`; extend the first and keep the race test green (the global-broadcast move changes lock order around `broadcastGlobalLocked`).
5. Late-joiner replay (`sse.go:961–971`) is unchanged — the cached slots still serve first frames.

Non-goals: changing the safety interval, the debounce, or `automatic-rename-format`; splitting the React context (below the floor, separate discussion if ever).

Memory: `api-and-sockets.md` § `/ws/state` gains the dedup rule and the `activityTimestamp` exclusion; `architecture/tmux-runner.md` if the hub-loop description lives there — check both.

## Change 4 — WebGL fallback telemetry (slug: `xterm-webgl-fallback-telemetry`)

**Intake seed**: When xterm loses its WebGL context and falls back to the DOM renderer, rk says so — a `console.warn` with the window id and a one-shot toast — so the fallback's frequency on real hardware becomes known before anyone sizes a fix.

1. `terminal-client.tsx:507` `onContextLoss` handler: log + toast (route the toast through the surface-layout owner's existing toast path — `terminal-client.tsx` has no toast helper in scope; a callback prop or the `rk:` document-event seam are the two precedents); also warn when `new WebglAddon()` throws at load (the initial-failure path). Include the count of currently mounted `TerminalClient`s in the message (Chromium caps WebGL contexts at 16 per page — the hidden-tile set is the likely trigger).
2. Acceptance: force a context loss in a Vitest with a stub addon; instrument run on a tty route shows no change (no CPU claim).

Memory: `ui/terminal.md` § Renderer gains the fallback signal.

## Backlog ideas (file with `idea`, not changes)

- **xterm hidden-tile cap / WebGL context budget** — depends on change 4's frequency data. Notes: `surface-layout.tsx:1729–1801` hide-never-unmount set; each hidden tty keeps a WebGL context, a relay stream and 25 000 lines of scrollback; board pages over HTTPS bypass `MAX_LIVE_RELAY_PANES` (`board-page.tsx:1205`, plaintext-only cap). Reopen when change 4 shows fallbacks happen, or when a board with many pinned panes is measured.
- **SessionContext structural sharing** — measured under the floor (main bundle ≤ 1.3% at 13 msg/s). Notes: `session-context.tsx:1200–1238` derived Maps keyed on the whole slices Map; `sidebar/index.tsx:2220` `rawSessions` identity defeats `memo`. Reopen only with a measurement showing it above 3 points.

---

## Appendix — the instrument as run on 2026-09-16 (seed for change 0)

Run from `app/frontend` with `NODE_PATH=$PWD/node_modules node measure.js <path> <seconds> <reducedMotion 0|1> <label>`; env `THEN=<path>` navigates in-app before measuring, `INJECT=<js>` runs a snippet before measuring.

```js
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = process.argv[2] || '/'; const secs = Number(process.argv[3] || 30);
const reduced = process.argv[4] === '1'; const label = process.argv[5] || path;
const THEN = process.env.THEN || ''; const INJECT = process.env.INJECT || '';
const BASE = process.env.BASE || 'http://127.0.0.1:3000';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const bcdp = await browser.newBrowserCDPSession();
  await cdp.send('Network.enable'); await cdp.send('Performance.enable');
  const ws = {}, wsUrls = {}; let counting = false;
  cdp.on('Network.webSocketCreated', e => { wsUrls[e.requestId] = e.url; });
  cdp.on('Network.webSocketFrameReceived', e => {
    if (!counting) return;
    const url = (wsUrls[e.requestId] || '?').replace(/\?.*/, '');
    const rec = ws[url] ||= { frames: 0, bytes: 0, types: {} };
    rec.frames++; rec.bytes += e.response.payloadData.length;
    let t; try { const j = JSON.parse(e.response.payloadData); t = j.type || j.event || j.kind || Object.keys(j).slice(0, 3).join(','); } catch { t = e.response.opcode === 2 ? 'binary' : 'text'; }
    rec.types[t] = (rec.types[t] || 0) + 1;
  });
  await page.goto(BASE + path, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(6000);
  if (THEN) { await page.click(`a[href="${THEN}"]`).catch(async () => { await page.evaluate(p => history.pushState({}, '', p), THEN); await page.evaluate(() => dispatchEvent(new PopStateEvent('popstate'))); }); await page.waitForTimeout(6000); }
  if (INJECT) { await page.evaluate(INJECT); await page.waitForTimeout(1500); }

  const m0 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const p0 = (await bcdp.send('SystemInfo.getProcessInfo')).processInfo;
  const t0 = Date.now(); counting = true;
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 }); await cdp.send('Profiler.start');
  await page.waitForTimeout(secs * 1000);
  const { profile } = await cdp.send('Profiler.stop'); counting = false;
  const elapsed = (Date.now() - t0) / 1000;
  const m1 = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));
  const p1 = (await bcdp.send('SystemInfo.getProcessInfo')).processInfo;

  const prev = Object.fromEntries(p0.map(p => [p.id, p.cpuTime]));
  const processes = p1.map(p => ({ type: p.type, cpuPct: +(100 * (p.cpuTime - (prev[p.id] ?? 0)) / elapsed).toFixed(1) })).sort((a, b) => b.cpuPct - a.cpuPct);
  const d = k => +(m1[k] - m0[k]).toFixed(3);
  const renderer = { TaskDuration_s: d('TaskDuration'), ScriptDuration_s: d('ScriptDuration'), LayoutDuration_s: d('LayoutDuration'), RecalcStyleDuration_s: d('RecalcStyleDuration'), LayoutCount: d('LayoutCount'), RecalcStyleCount: d('RecalcStyleCount'), Nodes: m1.Nodes, Documents: m1.Documents, JSHeapUsedMB: +(m1.JSHeapUsedSize / 1e6).toFixed(1) };

  const nodes = new Map(profile.nodes.map(n => [n.id, n])); const byUrl = new Map(), self = new Map();
  profile.samples.forEach((id, i) => { const cf = nodes.get(id).callFrame; const dt = profile.timeDeltas[i] || 0;
    const u = (cf.url || cf.functionName || '(native)').split('/').pop(); byUrl.set(u, (byUrl.get(u) || 0) + dt);
    const k = `${cf.functionName || '(anon)'} @ ${u}:${cf.lineNumber}`; self.set(k, (self.get(k) || 0) + dt); });
  const top = m => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, +(v / 1e3).toFixed(1)]);

  const inventory = await page.evaluate(() => { const running = document.getAnimations().filter(a => a.playState === 'running'); const names = {};
    for (const a of running) { const n = (a.animationName || a.id) + ':' + String(a.effect?.target?.className || a.effect?.target?.tagName || '?').slice(0, 60); names[n] = (names[n] || 0) + 1; }
    return { xtermScreens: document.querySelectorAll('.xterm').length, iframes: [...document.querySelectorAll('iframe')].map(f => f.src.slice(0, 80)), runningAnimations: running.length, animationNames: names, href: location.href }; });

  const out = { label, path, secs: elapsed, reducedMotion: reduced, renderer, processes, websockets: Object.fromEntries(Object.entries(ws).map(([u, r]) => [u, { msgPerSec: +(r.frames / elapsed).toFixed(1), kBPerSec: +(r.bytes / elapsed / 1024).toFixed(1), types: r.types }])), profileByScriptMs: top(byUrl), profileSelfTopMs: top(self), inventory };
  console.log(JSON.stringify(out, null, 1));
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
```

Per-flair isolation used `INJECT` with a style tag, e.g. `.rk-flair-nemo *, .rk-flair-nemo::before, .rk-flair-nemo::after { animation: none !important }`; the halo probe injected four `span.rk-waiting-halo` elements (9 px, `border-radius: 9999px`) into a fixed container.
