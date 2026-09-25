# Surface Layout Tree, Drag & Popout

**Drafted**: 2026-09-24 · revised 2026-09-25 (N tiles) · against `d829bfa7` · from the 2026-09-24/25 `/fab-discuss` session on replacing the tile-header move buttons with drag-to-snap, designing the layout for N tiles, and adding per-surface popout
**Shape**: 1 study + 6 changes, one repo (run-kit) — **study → 1 → 2 → 3 → {4 ∥ 5} → 6**: 1 (layout tree) is the model every later change stands on; 2 (drag) is the frontend core; 3 (lift the tile cap) needs the multi-instance decision; 4 (non-tty popout) and 5 (tty popout backend) are file-disjoint and may run in parallel; 6 (shell popout windows) needs 4
**Contract of record**: `docs/wiki/surface-drop-zone-studies.html` (§1 counts, §2 model + encoding, §3 resolver, §4 live mock, §5 zones + size floor, §6 sizes through a drop, §7 feedback, §8 reachability, §9 generic verbs, §10 multi-instance leaves, §12 decisions) · pre-change truth in `docs/memory/run-kit/ui/lenses-and-layout.md` § Surface Layout, `docs/memory/run-kit/tmux-sessions.md` § Pin Sessions / relay attach flow, `docs/memory/run-kit/desktop-shell.md` · design authority `docs/specs/surface-layout.md` (amended by changes 1–3), `docs/specs/ui-state.md` § Layout in tmux

## Decisions of record

- **Design for N tiles, not three** (user direction 2026-09-25). Arrangements grow 2 → 6 → 22 → 90 → 394 for N = 2…6 (large Schröder numbers), so presets cannot be the model past three. The layout is a **canonical split tree**: `leaf | dir(children…)` with dir ∈ `h|v`, ≥2 children per split, directions alternating by depth. `@rk_win_layout` stores the tree form, e.g. `h(tty,v(code,web))`. The old `shape:a,b,c` strings parse into their trees permanently, so `rk tab layout main-left` stays valid shorthand.
- **Presets become templates**: `row`, `col`, `main-left|right|top|bottom` and `grid` build a tree for any N from the current slot order. The ▦ chip cycles the templates for this N and reads `custom` otherwise.
- **Sizes stay per viewer** (R7): per-split fractions in localStorage keyed by structure signature (`rk-layout-sizes:{server}:{@N}:<sig>`). They replace the per-shape ratios key, and the resolver carries them through drops (study §6).
- **One generic drop edit**: wrap the target with a placeholder → remove the dragged leaf → normalise → rename. Center swaps leaves. Targets are node paths and leaves are ids, never kinds. At N = 3 this reproduces the five presets plus `main-bottom`, the one structure they lack (verified by enumeration).
- **Zones: tile edges + layout edges (outer 18 px)**. Nested ancestor strips were rejected. They add 0.6 % of outcomes at N = 4 and 2.7 % at N = 5, and leave reachability unchanged. Max drops between any two layouts = N − 1; any single-tile move is one drop.
- **No tile cap; a size floor.** A drop, add or template is offered only if every tile stays ≥ 150 × 100 px in this viewer's viewport. Mobile stays one tile.
- **Generic verbs**: add splits the focused tile along its longer axis, falling back to the largest tile at the floor. At landscape sizes this reproduces today's 1→2 `split-h` and 2→3 `main-left`. Close removes the leaf and normalises; behaviour change: closing one tile of a `col` leaves a column. Promote swaps with slot A. Directional swap uses the geometric neighbour.
- **Feedback previews the result**, not a half-tile. A drop can reshape siblings.
- **Pointer events, not HTML5 drag-and-drop.** `setPointerCapture` on the header keeps moves arriving over iframes. The native web view (`WebContentsView`) hides for the drag's duration.
- **Header Promote/Swap retire; palette verbs stay** (Constitution V). Close/Expand stay on the header.
- **Popout is per viewer.** The opener hides the popped **leaf** locally (`rk-layout-popped:{server}:{@N}`, keyed by leaf ref, not kind) and reflows over the rest. Other viewers still see it. Closing the popout, or `Tile: Pop Back In`, restores it. Coordination runs over a same-origin `BroadcastChannel`.
- **Popout is a viewer param, not a route**: `/$server/@N?pop=<leaf-ref>` renders one surface chrome-less. No new route (Constitution IV). A popout addresses `@N` and never follows the opener's navigation.
- **tty popout attaches its own session.** A popped-out tty links the window into a single-window `_rk-pop-<digits>` session (the pin-session mechanism). Otherwise a second PTY on the home session would follow the opener's tab switches. Verified on a throwaway server 2026-09-24: after `link-window`, `select-window` on home does not move the linked session's window, and `kill-session` on it leaves the window alive in home.
- **Rejected**: extending the preset list (`main-bottom`, a 2×2, …) — correct only to N = 3; an unconstrained tree (unary nodes, stored sizes); a hard tile cap; nested ancestor strips; half-tile-only feedback; HTML5 DnD; a `/popout/...` route; popout as a shared `@rk_win_layout` write.

## Standing context (carry into every change's intake)

- **Frontend files**: `app/frontend/src/lib/surface-layout.ts` (484 — `LayoutShape`, `SHAPE_ARITY`, `SHAPE_RING`, `parseLayout`/`serializeLayout`, `degradeLayout`/`effectiveLayout`, the verb mutations `promote`/`swapWithNext`/`closeSurface`/`addSurface`/`cycleShape`/`setShape`, zoom/ratios storage keys); `components/surface-layout.tsx` (2845 — `defaultRatios`/`initialRatios` ~445–505, `gridStyle`/`slotStyle`/`dividerSpecs` ~505–700, the sash pointer-capture handlers ~1505/1601, hide-never-unmount + the code-frame LRU, the tile header verb cluster ~2560–2610, the mid-drag `pointer-events-none` ~2696); `components/top-bar-icons.tsx` (shape glyphs); `lib/palette/layout.ts` (+ test); `app.tsx` (`applyLayout`, `pendingLayout`); `lib/web-frame-engine.ts` + `components/web-frame-native.tsx` (the drag-hide seam).
- **Backend files**: `internal/layoutspec/layoutspec.go` (+ test — Go-side validation for `rk tab layout` / MCP / `--layout`); `api/terminals_ws.go` (`attachStream`: pin-session-first pick → scoped select → attach); `internal/tmux/board.go` (`PinSessionName`, `PinSessionPrefix`, pin/unpin `link-window`); `internal/tmux/layout.go:138` (session-name filter used by `parseSessions`).
- **Desktop files**: `app/desktop/src/preload.ts` (`shell:new-window` takes no URL; `web:*` group), `main.ts`, `window-open.ts` (`windowOpenAction` sends every http(s) `window.open` to the system browser — a shell popout needs its own channel).
- **Reference implementation**: the study's embedded resolver (`norm`, `removeLeaf`, `dropEdge`, `swapLeaves`, `edgeChain`, `layoutRects`, templates) is the executable spec. Port it to `lib/layout-tree.ts` with types. The study's enumeration (4 / 36 / 528 placements for N = 2/3/4) is the exhaustive test fixture.
- **E2E**: `tests/e2e/surface-layout.spec.ts` (15), `right-panel.spec.ts`, `code-surface.spec.ts`, `web-view-lens.spec.ts`, `operator-compose.spec.ts` (exact palette-entry count — project memory), `control-gallery.spec.ts` if header controls change classes.
- **Constitution**: II (sizes + popped set are viewer localStorage; `_rk-pop-*` is tmux-derived), IV (no new route or settings; the ≤3-tile / presets-not-trees line lives in surface-layout.md, not the constitution), V (every drag outcome has a palette verb), VI (popout sessions are tmux-side), Test Intent Comments on every touched `test()`.
- **Verification per change**: `cd app/frontend && npx tsc --noEmit`; `just test-frontend` (full Vitest — project memory); scoped e2e `just test-e2e <name>.spec`; backend `env -u TMUX -u TMUX_PANE go test ./...` after `just _ensure-tmux-conf` in a fresh worktree; desktop `cd app/desktop && pnpm run compile && pnpm test`.

## Sequencing

```
study ──▶ 1 (layout tree) ──▶ 2 (drag) ──▶ 3 (N > 3: size floor + leaf refs) ──▶ 4 (popout: code/web/gui) ──▶ 6 (shell popout windows)
                                                                              └──▶ 5 (popout: tty session) ───┘
```

Each change is its own fab change + draft PR off fresh `origin/main`; never stack. The study, this plan and the `docs/specs/index.md` wiki row land on main first as a docs-only commit. 4 and 5 key popout by leaf ref, so they follow 3. If 3 stalls on the multi-instance decision, 4/5 can ship keyed by kind and migrate.

Lane hints: 1 full; 2 full; 3 full; 4 full; 5 full; 6 full.

---

## Change 1 — layout tree model (slug: `surface-layout-tree`)

**Intake seed**: The terminal route's layout becomes a canonical split tree instead of one of eight presets — a new tree encoding in `@rk_win_layout` (old preset strings still parse), a recursive renderer with a divider between each pair of siblings, per-viewer sizes keyed by structure signature, templates in place of presets on the ▦ chip, and generic add/close/promote/swap. The tile count stays capped at three in this change.

1. `lib/layout-tree.ts` (new, pure): types, `parseLayoutTree` (tree grammar + legacy `shape:a,b,c`), `serializeLayoutTree`, `normalise`, `removeLeaf`, `insertBeside`, `swapLeaves`, `layoutRects(tree, box, sizes)`, `structureSig`, templates, `templateOf`. Exhaustive Vitest for N ≤ 4 over the invariants (canonical, leaf multiset kept, N kept, swap involution); legacy parse is lossless for all eight presets.
2. `lib/surface-layout.ts`: the verb mutations delegate to the tree (`promote`, directional `swap`, `closeSurface` = remove + normalise, `addSurface` = split focused on the longer axis — needs the focused leaf and its rect as inputs). `degradeLayout`/`effectiveLayout` operate on trees. Sizes storage replaces ratios storage (`rk-layout-sizes:*`); old `rk-layout-ratios:*` keys are ignored.
3. `components/surface-layout.tsx`: replace `gridStyle`/`slotStyle`/`dividerSpecs` with rect-positioned leaves in a **flat** list, so a restructure never re-parents an iframe. Dividers go between siblings, and the sash drag edits two fractions. Hide-never-unmount and the code-frame LRU key by leaf id.
4. ▦ chip + palette: template rows for the current N; `custom` state; `Layout: <Template>` palette entries.
5. `internal/layoutspec/layoutspec.go` (+ test): parse both grammars, validate canonical form, emit the tree form; `rk tab layout` accepts both and prints the tree; MCP tool description.
6. Tests: the Vitest above; `surface-layout.spec` updated for the encoding; `operator-compose.spec` palette count if entries change.
7. Specs/memory: surface-layout.md § The Model / § Shape presets rewritten (canonical tree + templates), Constitution Mapping line; ui-state.md § Layout in tmux (encoding + sizes key); lenses-and-layout.md § Surface Layout + Design Decisions *The layout is a canonical tree; presets are templates*, *Leaves render flat, positioned from rects*.

## Change 2 — drag to snap (slug: `surface-drag-snap`)

**Intake seed**: Tiles move by dragging their header: a pointer-captured drag offers center (swap), tile-edge (split beside) and layout-edge (span a side) zones, previews the resulting tree at the viewer's sizes, and commits one `@rk_win_layout` write on release; Escape cancels. Promote/Swap leave the header and stay in the palette.

1. `lib/layout-drop.ts` (new, pure): `zoneAt(rect, point)` (bands clamp(25 %, 28, 110) px, deepest-edge corners), `rootZoneAt(box, point)` (18 px), `resolveDrop(tree, sizes, dragged, hit) → {tree, sizes} | "noop"`. Vitest against the study's outcome sets.
2. `components/surface-layout.tsx`: header `pointerdown` past 4 px starts a drag; `setPointerCapture`; snapshot leaf rects; overlay = result preview; release → `onApplyLayout(tree)` + write the viewer's sizes under the new signature; Escape / outside / over-self cancel. Reuse the mid-drag flag so tiles go `pointer-events-none` and the native web engine hides.
3. Retire header Promote/Swap; keep palette rows (`Tile: Promote`, `Tile: Swap Left/Right/Up/Down`).
4. Off on coarse pointers, zoomed renders, single-tile layouts.
5. Tests: Vitest for zones + resolver; RTL for threshold/cancel/commit with mocked rects; e2e via `page.mouse` for swap, tile edge, layout edge and cancel.
6. Specs/memory: surface-layout.md § Verbs (drag is the mouse path; the ≤2-action guarantee rides the palette); lenses-and-layout.md Design Decisions *Pointer capture, not HTML5 DnD*, *The overlay previews the result*.

## Change 3 — more than three tiles (slug: `surface-layout-n-tiles`)

**Intake seed**: Lift the three-tile cap: a per-viewport size floor gates adds, drops and templates; leaves gain an optional instance ref so a layout can hold more than one tile of a kind.

1. **Blocked on a decision**: which instances come first (study §10 open) — a second web tab (`web:2`), another pane's tty (`tty:%14`), another window's tty (`tty:@12`). The leaf grammar `kind[":" ref]` is reserved in change 1.
2. Size floor (150 × 100 px) in `resolveDrop` / add / template application, per viewport; the surface toggles grey out when no tile can split.
3. Content wiring for the chosen ref kinds (e.g. a web leaf with `:n` selects that web tab; zoom and focus key by leaf ref).
4. Resource guard: the code-frame LRU cap stays; note the HTTP/1.1 connection-pool budget in e2e.
5. Specs/memory: surface-layout.md § One tile per surface kind (the ref grammar), the "fourth surface = board" note, § Boards convergence (boards as named trees); ui-state.md.

## Change 4 — popout for code, web, gui (slug: `surface-popout`)

**Intake seed**: Any non-tty tile can pop out into its own browser window showing that one surface of that tab; the opener hides the popped leaf for this viewer only and reflows; closing the popout or `Tile: Pop Back In` restores it.

1. `?pop=<leaf-ref>` handling in the terminal route: validate, render one tile chrome-less, keyed to `@N`; title `<Surface> · <window>`.
2. `lib/popout.ts`: the viewer's popped set; `BroadcastChannel("rk-popout")` messages `opened`/`closed`/`pop-in`; the opener renders `removeLeaf(tree, popped)` for this viewer; `pagehide` + a heartbeat clear a stale mark.
3. Verbs: header `Pop out` (content-verb family), palette `Tile: Pop Out …` / `Tile: Pop Back In …`.
4. Per kind: **code** — the opener evicts its retained frame (one extension host, not two); **web** — iframe engine reloads in the new window; **gui** — second RFB client, geometry authority follows focus.
5. Tests: Vitest for the popped-set derivation; e2e with `context.waitForEvent("page")`.
6. Specs/memory: surface-layout.md § Verbs; ui-state.md § Viewer Behaviour; lenses-and-layout.md.

## Change 5 — tty popout session (slug: `tty-popout-session`)

**Intake seed**: A popped-out terminal attaches its own single-window tmux session so the opener's tab switches never move it; the session is created on popout and reaped when its last client leaves.

1. `internal/tmux`: `PopSessionName(windowID)` (`_rk-pop-<digits>`), `EnsurePopSession` (`new-session -d` + `link-window` + kill the placeholder — the pin path's shape), `_rk-pop-` in the `_rk-*` taxonomy and the `parseSessions` filter; snapshots skip it.
2. Relay (`attachStream`): an `open` op with `isolate: true` ensures the pop-session and attaches it; pick order pin → pop (when requested) → home.
3. Lifecycle: `destroy-unattached on` (verify it leaves the linked window alive, as `kill-session` does) or an explicit reap on stream close — decide in intake.
4. Frontend: the `?pop=tty…` render passes `isolate`.
5. Tests: Go on an `-L` server (`env -u TMUX -u TMUX_PANE`); e2e: pop out tty, switch the opener to a sibling window, assert the popout did not change.
6. Specs/memory: tmux-sessions.md § pop-sessions + relay pick order.

## Change 6 — shell popout windows (slug: `desktop-popout-windows`)

**Intake seed**: In the desktop shell, popouts open as shell windows on the same host (not the system browser), and a native web tile moves its live `WebContentsView` into the popout without reloading.

1. `shell:popout { url }` channel: validate same-host route + `?pop=`, open a shell window whose host view loads it; popouts are not restored from `windows.json`.
2. SPA: `lib/shell.ts` narrowing; `popOut()` prefers the bridge over `window.open`.
3. Native web: `web:reparent { tabKey, targetWindow }` — spike first (does a `WebContentsView` survive `removeChildView` + `addChildView` on another `BaseWindow` without reload on Electron 43?).
4. Optional tear-off: releasing a header drag outside the window pops the surface out.
5. Tests: `node --test` for the URL validator; manual shell matrix.
6. Memory: desktop-shell.md § Popout windows.

## Open questions

1. Which instances first once N > 4 (blocks change 3): second web tab, another pane's tty, or another window's tty?
2. Should a 3-tile tree that matches an old preset keep writing the preset string for one release (rollback safety), or go straight to the tree form?
3. External drags (a top-bar surface toggle dragged into the layout: edge = add, center = replace): in change 2 or a follow-up?
4. A root-edge drop gives the dragged tile 50 % of the layout (the generic wrap rule). Should root drops take 1/N instead?
