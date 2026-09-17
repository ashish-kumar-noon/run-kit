# Idle CPU — follow-ups after the first batch

**Drafted**: 2026-09-17 · against `619184d2` (v3.20.8) · continues `fab/plans/sahil/26-09-16-idle-cpu.md` (all five of its changes merged; this plan carries what the live re-measurement left open)
**Shape**: 3 changes, one repo (run-kit). Change 5 (instrument: renderer capture + headed mode) first; change 6 (flairs on tty routes) after 5 merges because its acceptance gate needs 5's output; change 7 (server-not-found spin) is file-disjoint and runs in parallel from its own worktree at any time. One user task (R0, the Mac baseline) that blocks nothing but sharpens change 6's target. **Not in this plan**: archiving `260916-07pj-state-socket-broadcast-dedup` and the other done changes — archived in bulk later, by hand.
**Contract of record**: § Status and § Measurements below; the instrument `just perf-idle-cpu`; project memory `idle-cpu-profile-2026-09-16` (carries the 2026-09-17 status and the WebGL correction). Pre-change truth: `docs/memory/run-kit/ui/visual-design.md` § Flair overlays, `ui/terminal.md` § Renderer, `ui/routes-and-shell.md` (not-found fallback), `architecture/testing.md` § Performance probes.

## Status of the first plan (verified live on v3.20.8, 2026-09-17)

| Change | PR | Result on the live daemon |
|---|---|---|
| 0 instrument | #991 | `just perf-idle-cpu` works; its `xterm`/`iframes` inventory read 0 on three tty runs whose page did have a terminal (see change 5) |
| 1 flairs composited | #1003 | `/runKit` 15–19% → 6% renderer, recalcs 1800 → 300 / 30 s. **Holds only without a terminal on the page** (see change 6) |
| 2 halo + seam composited | #1001 | 8 synthetic halos: recalcs 1803 → 111, renderer within noise |
| 3 socket dedup | #1010 + #1013 | quiet regime 3.3–13 → 0.4–0.5 msg/s |
| 4 WebGL telemetry | #998 | fired on every headless load here — which is how the WebGL correction below was found |

## Decisions of record

- **Errata on the first plan**: headless Playwright Chromium on the dev box has **no WebGL** (chromium-1208 and -1217, every SwiftShader flag tried), so every terminal-route row in the first plan's table was an xterm **DOM-renderer** row, and the "one run in nine fell back, doubling cost" story was wrong — that run simply had a fuller screen (15k nodes). WebGL is available only headed under `xvfb-run` (Xvfb is installed). Nothing in the first plan's *server-page* rows is affected.
- **The instrument must say which xterm renderer it measured.** A tty-route number without `renderer=webgl|dom` is not comparable to anything, so change 5 is a prerequisite for change 6, not a nicety.
- **Change 6 is research-first.** The flair animations start composited on both routes (Blink trace: `compositeFailed=0` at start) yet tick the main thread at 60/s whenever an xterm is mounted, with either renderer. The mechanism is unknown; the change's first task is to find it with the recalc oracle, and the fix follows the finding — no fix is prescribed here.
- **a2ep is promoted from backlog to a change.** A route naming a server the daemon does not have spins the renderer at ~109% of a core for as long as the tab lives. In the desktop app that is any window left on a renamed or killed server. It is the largest single number in either plan and has a 15-second repro.
- **Selection method unchanged**: measured A/B delta against the 3-point floor; parallel only when file-disjoint.

## Measurements (2026-09-17, live daemon :3000 on v3.20.8, 20–30 s idle samples, % of one core)

Headless unless marked; "xvfb" rows are headed Chromium 147 under Xvfb with software WebGL (GPU % there is SwiftShader and meaningless — read renderer and recalcs only).

| Scenario | Renderer | Main thread | Style recalcs | Note |
|---|---|---|---|---|
| `/` host overview | 3.0 | 0.9 | 0 | |
| `/runKit` server page, 37 flair animations | 6.1 | 2.0 | 297 / 30 s | composited (was 1803) |
| `/runKit` reduced motion | 3.0 | 0.9 | 0 | |
| `/runKit/@109` tty+code, DOM renderer | 17.2–18.8 | 11.2–11.7 | 1803–1823 / 30 s | 60/s ticker |
| `/runKit/@109` all flairs paused (inject) | 6.6 | 2.8 | 230 / 30 s | ticker gone |
| `/runKit/@109` `.xterm` removed (inject) | 11.3 | 4.6 | 342 / 30 s | ticker gone |
| `/runKit/@109` caret blink off · rows hidden · canvas hidden · `contain: strict` · terminal blurred | 17–19 | 9–11.5 | ~1800 / 30 s | none of these matter |
| `/runKit/@109` code iframe removed (inject) | 14.5 | 8.2 | 1813 / 30 s | not the iframe |
| xvfb `/runKit/@109` WebGL renderer | 15.6 | 11.2 | 1199 / 20 s | same ticker with WebGL |
| xvfb `/runKit/@109` WebGL, flairs paused | 1.7 | 1.0 | 119 / 20 s | |
| xvfb `/runKit` server page | 3.9 | 1.7 | 193 / 20 s | composited |
| xvfb `/runKit/@99` single tty, WebGL | 11.5 | 6.9 | 1200 / 20 s | any tty route |
| `/nosuchserver` | **109** | **99.4** | 0 | script loop, 0 layouts, 0 recalcs — backlog a2ep |

Blink trace (`blink.animations`, tracing started before load, 7 s): flair keyframes report `compositeFailed=0` at start on both `/runKit` and `/runKit/@99`; the only failures are hover transitions (`8224` = unsupported property + invalid compositing state on `color`/`border-*-color`/`box-shadow`) and `131072` (`kAnimationHasNoVisibleChange`) on a dozen effects. Style-recalc trace events: 107 on `/runKit` vs 468 on `/runKit/@99` over the same window. So the demotion happens after start, or the per-frame recalc has another trigger that only exists with a mounted terminal.

## Standing context (carry into every intake)

- **Instrument**: `just perf-idle-cpu <path> [seconds] [--reduced-motion] [--inject <js>] [--then <path>] [--json <file>]`. Route `--inject` through `scripts/perf-idle-cpu.sh` directly when the JS contains parentheses — `just`'s `{{args}}` does not re-quote. One instance at a time. Noise floor ≈ 3 points.
- **Recalc oracle**: `RecalcStyleCount` per 30 s. Composited-only page ≈ 130–300; one main-thread animation ≈ +1800.
- **WebGL on the dev box**: only `xvfb-run -a -s "-screen 0 1920x1080x24" node script.mjs` with `chromium.launch({ headless: false, channel: "chromium", args: ["--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] })`. Every headless launch gets the DOM renderer and the change-4 console line `rk: xterm WebGL unavailable at load …`.
- **Files**: `scripts/perf-idle-cpu.sh`, `scripts/perf-idle-cpu.mjs` (inventory at :347, settle constants :27–29, load gate :249); `app/frontend/src/globals.css` § Flair overlays (the composited rules landed by #1003; `--rk-flair-dpr`, `steps()` sheets, nemo `100cqw` keyframes at ~:1868); `components/flair-overlay.tsx`; `components/terminal-client.tsx` (xterm open + WebglAddon block ~:500); `app/frontend/src/router.tsx:37–75` (`NotFoundPage`, `notFoundComponent` on the app-layout route); `contexts/session-context.tsx`, `app.tsx`, `components/host-overview-page.tsx`, `components/server-dialogs.tsx` (the four files that render "Server not found").
- **Constitution**: IV (no new route, no new settings surface), V, VIII (justfile one-liner → `scripts/`), Test Intent Comments on any e2e touched; no change-ID/PR citations in code comments.
- **Verification per change**: `npx tsc --noEmit` + affected Vitest + instrument before/after recorded in plan.md; scoped e2e only where a spec already covers the surface. Never the full suite as a gate.
- **Live-daemon etiquette** (from 07pj's intake): the user's `:3000` daemon and tmux servers are read-only for measurement; a changed build is measured on the worktree's own `rk serve` on a derived port with `dist` rebuilt, or by `--inject`ing the changed CSS over the live page for CSS-only changes.

## Sequencing & merge topology

```
5 instrument renderer/headed ──> 6 flairs on tty routes
7 server-not-found spin  (independent, parallel from its own worktree)
R0 Mac baseline          (user task; informs 6's target, blocks nothing)
```

Lane hints: 5 light; 6 full (research phase); 7 full (needs a real repro test).

## Pre-intake research

**R0 — Mac baseline (user task, still open from the first plan)**
- On the Mac, from a run-kit checkout: `just setup`, then `just perf-idle-cpu /runKit 30 --url <rk url>` and `just perf-idle-cpu /runKit/@<any tty> 30 --url <rk url>`. Paste both summary lines into change 6's intake. If the tty line shows recalcs ≈ 300 (no ticker) the demotion is Linux/SwiftShader-specific and change 6 shrinks to a note; if ≈ 1800 it is real on hardware and change 6 proceeds as written. The headed Mac Chromium has real WebGL, so no xvfb dance.

**R5 — instrument gaps (before change 5)**
- Reproduce the `xterm=0` inventory: three back-to-back headless runs on `/runKit/@99`, `/runKit/@4`, `/runKit/@79` printed `xterm=0 iframes=0 ws[/ws/terminals]=0` with recalcs ≈ 300 and renderer ≈ 6%, while 11 plain Playwright loads of the same routes mounted `.xterm` within 1.7 s and kept it for 36 s. Two later instrument runs on `@4`/`@109` read `xterm=1`. Determine whether the terminal genuinely never mounted in those page instances (the Profiler at 1 ms sampling? the swallowed 15 s `networkidle` wait?) or the inventory ran in the wrong frame. Until explained, a tty-route summary line with `xterm=0` must be flagged as not-a-terminal-measurement.
- Confirm the change-4 console line is the reliable renderer signal (`rk: xterm WebGL unavailable at load …` / `… context lost …`); absence ⇒ WebGL.

**R6 — why composited flairs tick with a terminal mounted (this is change 6's first task; rank the hypotheses)**
1. **Late demotion**: the animations composite at start, then lose their layer when the terminal's layers appear (squashing / overlap with the xterm canvas or its `will-change` layers). Test: trace `blink.animations` + `disabled-by-default-cc.debug` across the terminal mount; or read `LayerTree` snapshots before/after mount and check whether flair spans still own layers.
2. **Not demotion but a second invalidator**: something in xterm's subtree changes style every frame *only while the compositor is animating* — e.g., xterm's dynamic `<style>` elements (`_dimensionsStyleElement` / theme style) being rewritten, which invalidates the whole document. Test: `MutationObserver` on `head` and on `.xterm` for 5 s with flairs on vs paused; count mutations.
3. **`cqw`-dependent keyframes re-resolve when a container changes**: nemo's swim uses `100cqw`; the tty route's layout may resize a container every frame (xterm fit → ResizeObserver → …). Test: pause only nemo (measured: ticker stays → hypothesis 3 alone is not it, but check whether aquarium/cube also use container units).
4. **Animation on `::before`/`::after` inside a `container-type: size` overlay** when a sibling subtree paints every frame. Test: temporarily move one flair's animated pseudo onto a real span and re-measure.
Record per hypothesis: recalcs / 30 s with the terminal mounted, WebGL (xvfb) and DOM (headless), plus the trace evidence. The fix follows the winning hypothesis; if none composites with a terminal mounted, the fallback is `animation-play-state: paused` on flair overlays while a tty tile is mounted and the row is not hovered — the ambient motion then lives on the server page and board, not beside a terminal. That fallback is a product change and needs the user's yes before it is built.

**R7 — the server-not-found loop (before change 7)**
- Repro is `just perf-idle-cpu /nosuchserver 15`: renderer 109%, main 99.4%, 0 recalcs, 0 layouts. Profile is `(program)`-dominated (native), earlier catch showed `tip-*.js` + `router-*.js` + `main-*.js`. Confirm the page reached is the "Server not found" fallback (which of the four files renders it for a `/$server` miss) and not `NotFoundPage`.
- Candidate loop: the `$server` route's loader/effect redirecting or re-subscribing on every state-socket frame or on every render because the server key is absent from `slicesByServer` — a `useEffect` with an unstable dep, or a TanStack Router `redirect`/`navigate` in render. Read `session-context.tsx` `attachServer` for the absent-server path and `app.tsx` for the fallback.
- Also reproduce via in-app navigation: the instrument's `--then` fallback (`pushState` + `popstate`) to a **valid** tty route also spun at 109% while the page showed the terminal — check whether the router's history sync loops on an externally pushed state; a real sidebar click did not spin.
- Decide the guard: the fix must stop the loop, and an e2e (with a Test Intent comment) must load a missing-server route and assert the main thread goes quiet (`Performance.getMetrics` `TaskDuration` delta over 3 s < 0.3 s via a CDP session in the spec).

---

## Change 5 — instrument reports the xterm renderer and can run headed (slug: `perf-idle-cpu-renderer-headed`)

**Intake seed**: `just perf-idle-cpu` prints which xterm renderer the page used (`renderer=webgl|dom|none`), flags a tty route whose terminal never mounted, and gains `--headed` (auto-wrapping in `xvfb-run` when no `DISPLAY`) so WebGL numbers exist on the dev box.

1. Capture `console` in `perf-idle-cpu.mjs`; map the change-4 lines to `dom`; `webgl` when a `.xterm` exists and no line fired; `none` when no `.xterm`. Add `renderer=` to the summary line and the JSON.
2. Tty-route guard: if the path looks like `/$server/@N` (or `/$server/N`) and `.xterm` is absent at sample end, print `warning: no terminal mounted — not a tty measurement` and exit 0 (the run is still valid for the sidebar).
3. `--headed`: `headless: false` + `--enable-unsafe-swiftshader --ignore-gpu-blocklist`; the shell wrapper prepends `xvfb-run -a -s "-screen 0 1920x1080x24"` when `DISPLAY` is unset and `xvfb-run` exists, else errors with the install hint. Document in `architecture/testing.md` § Performance probes: headless has no WebGL here; GPU % under Xvfb is not a number.
4. R5's answer goes into the same doc section (or fixes the inventory if it was the instrument's fault).
5. Verification: `--help` smoke, one headless and one headed run on a tty route pasted into plan.md showing `renderer=dom` vs `renderer=webgl`.

## Change 6 — flairs stay composited when a terminal is mounted (slug: `flair-composited-with-terminal`)

**Intake seed**: Flair overlays cost the same on a terminal route as on the server page — no per-frame style recalc while a tty tile is mounted — with every flair's look unchanged.

1. Research phase = R6, results recorded in plan.md with the trace evidence.
2. Fix per the winning hypothesis (layer isolation on the flair overlay or on the tty tile; moving animated pseudos to spans; removing container-unit dependence; or stopping xterm's per-frame style-element churn if hypothesis 2 wins — that last one may be an upstream xterm issue, in which case the change files it and works around it locally).
3. **Acceptance**: `just perf-idle-cpu /runKit/@<tty> 30 --headed` and the same headless: recalcs within 200 of the flairs-paused inject on the same route; renderer within 3 points of it; `document.getAnimations()` still reports the flairs running. Before/after for both renderers in plan.md. Re-run `/runKit` to prove no regression on the server page.
4. Tests: Vitest for any `flair-overlay.tsx` markup change; no e2e for motion.

Non-goals: new flairs; removing flairs; the ambient-motion setting (only as the R6 fallback, and only with the user's yes).

Memory: `ui/visual-design.md` § Flair overlays gains the terminal-route rule and the mechanism found; `ui/terminal.md` if xterm's style churn is the cause.

## Change 7 — a missing-server route must not spin the renderer (slug: `server-not-found-render-loop`)

**Intake seed**: Loading a `/$server` or `/$server/$window` route whose server the daemon does not have renders the "Server not found" fallback once and then idles — no re-render loop, no redirect loop — and an e2e guards it.

1. R7 finds the loop; fix at the source (stable effect deps, no navigation during render, one subscription attempt for an absent server key, or a router-level guard).
2. Check the `--then` pushState spin from R7: if the router's history sync is a second loop, fix or document it as instrument-only.
3. **Acceptance**: `just perf-idle-cpu /nosuchserver 15` renderer ≤ 5%, main ≤ 2%; `/` unchanged; the fallback page still renders its copy and its way home.
4. Tests: an e2e in `tests/e2e/` that loads a missing-server route, waits 3 s, and asserts the main-thread task time delta (CDP `Performance.getMetrics`) stays under 0.3 s, with the Test Intent JSDoc; Vitest for the fixed hook/component.

Memory: `ui/routes-and-shell.md` § not-found fallback gains the one-render contract; `api-and-sockets.md` if the absent-server subscription path changed.

## Backlog (stays backlog)

- gn89 hidden-tile WebGL budget — now that change 4's telemetry exists, wait for a Mac report of the console line before sizing.
- htjv SessionContext structural sharing — still under the floor (main bundle ≤ 1.3%).
- 07pj and the four archived-by-hand candidates — bulk archive later, not here.
