# Intake: Operator Omnibox Focus Release

**Change**: 260906-f4s6-omnibox-focus-release
**Created**: 2026-09-06

## Origin

One-shot research-and-intake request (`/fab-new`). The user reported two symptoms in the desktop
operator omnibox (the top bar's center-cell compose box) and asked for a per-symptom root cause plus
a concrete fix, explicitly scoped to research — no implementation in this pass.

> Operator omnibox focus-ownership bug in the run-kit top bar. Two symptoms reported by the user:
> (1) clicking outside the omnibox does not blur or defocus it - it stays visually engaged and keeps
> keyboard focus; (2) when a terminal window is active and the user clicks into that terminal, the
> omnibox is STILL focused, so keystrokes are captured by the omnibox instead of being delivered to
> the terminal pane. Research the blur policy in the onBlur handler of
> app/frontend/src/components/operator-omnibox.tsx (roughly lines 167-184: the relatedTarget
> within-box check, the draft-held md-lg hold condition, and the imperative evaluateMediaQuery rung
> read), the focus-ownership effect at roughly lines 99-116 that focuses/selects on machine entry and
> saves/restores document.activeElement on return to rest, and the rest/focused/open machine plus
> resolveConsoleServer in app/frontend/src/lib/operator-console.ts. Also examine how xterm.js
> terminal panes take focus on click in the terminal route and whether the console machine ever
> yields focus back to them. Identify the root cause of EACH symptom separately, note any interaction
> with the document-level Escape listener in operator-console.tsx around lines 360-370, and propose a
> concrete fix. This is a research and intake task - produce the intake and stop, do not implement.

**Research performed in this pass** (findings below are traced from source, not inferred):
`operator-omnibox.tsx` (whole file), `lib/operator-console.ts` § ⌘J machine + `resolveConsoleServer`
+ `resolveOperatorConsoleTarget`, `operator-console.tsx` lines 190–430 (slide machinery, entry-point
seam, mobile gate, Escape listener, chip re-engage), `terminal-client.tsx` lines 595–700 (xterm focus
paths and the coarse/scroll-lock suppressors), `hooks/use-media-query.ts`,
`operator-omnibox.test.tsx` (existing focus assertions), and the memory files
`docs/memory/run-kit/ui/focus-ownership.md`, `.../operator-console.md`, `.../top-bar.md`.

## Why

### The defect

Both reported symptoms are produced by a **single self-sustaining focus loop** in the omnibox's
machine-follower effect (`operator-omnibox.tsx:99-116`), compounded by a second, independent defect
in the same effect. The loop makes the standing box **impossible to release by any means** at the
`lg`-and-wider rung — not by clicking away, not by clicking into a terminal, and **not by Escape**.

### Consequence if unfixed

The omnibox sits in the top bar on **every desktop route** and is rendered at all times at ≥ `lg`.
Once a user clicks it, keyboard input is captured by a 34ch text box and never returns to the page.
On a terminal route this means keystrokes intended for a live tmux pane land in the compose draft
instead — silently, with the draft text-selected on each bounce so each keystroke replaces the last.
That is a keyboard-first product (Constitution V) whose primary surface can be bricked by one click,
with no in-app escape hatch short of a page reload. It also violates the console's own documented
contract: `docs/memory/run-kit/ui/operator-console.md` § ⌘J three-state machine promises
`focused → (Esc) → rest`, and that transition currently cannot complete.

### Why this approach

The fix keeps the console's local origin ref and the existing three-state machine, and adds the two
invariants the effect is missing (never record an origin inside the box; never restore over a newer
user focus choice). The alternative — migrating the console's focus return onto the existing restore
router in `lib/focus-memory.ts` — is rejected for now: the console mounts on **every** route (Host,
Board, tmux Server), and the restore router is keyed on a terminal route's `(server, windowId)` focus
key, which does not exist on three of the four routes. See `## Assumptions` row 2.

### Architectural note (load-bearing for the fix's shape)

`docs/memory/run-kit/ui/focus-ownership.md` § Design Decisions → *"Chord/Escape focus return rides
`restoreFocus` — no origin storage"* records the exact pattern this component uses as **Rejected**:

> **Rejected**: Capturing `document.activeElement` at chord time — dangles when the layout re-renders
> or the window switches mid-gesture.

The operator console (introduced later, in a different component tree — #840 / #843) re-introduced
that rejected pattern as `restoreFocusRef`, and the console is **absent from `focus-ownership.md`
entirely**. This change must close that documentation gap as well as the code defect: whichever
mechanism the console keeps, the file that owns focus policy must describe it.

---

## What Changes

### Root cause of symptom 2 — the focus loop (`operator-omnibox.tsx:99-116` + `:163-166`)

This is the primary defect and is stated first because symptom 1 is its side effect.

The machine-follower effect records the element to return focus to on machine entry:

```tsx
// operator-omnibox.tsx:100-116  (current, defective)
useEffect(() => {
  const prev = prevMachineRef.current;
  prevMachineRef.current = machine;
  if (machine !== "rest" && prev === "rest") {
    restoreFocusRef.current = document.activeElement;   // ← RC1: may be the box's own input
    const el = inputRef.current;
    if (el) { el.focus(); el.select(); }
  } else if (machine === "rest" && prev !== "rest") {
    if (document.activeElement === inputRef.current) inputRef.current?.blur();
    const el = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (el instanceof HTMLElement && el.isConnected) el.focus();  // ← RC2: unconditional restore
  }
}, [machine]);
```

**RC1 — the origin ref records the box itself.** The dominant desktop entry path is a mouse click
into the standing box. A click focuses the input **first**; the input's `onFocus` (`:163-166`) then
transitions the machine `rest → focused`. By the time the effect runs (post-commit),
`document.activeElement` **is `inputRef.current`**, so `restoreFocusRef` is poisoned with the box's
own input. Chord entry (⌘J) does not poison it — the machine is already `focused` when
`el.focus()` fires, so `onFocus`'s `machineRef.current === "rest"` guard no-ops — which is exactly why
the existing Esc test passes while the mouse path is broken.

**RC2 — the restore is unconditional.** The return-to-rest branch calls `el.focus()` whether or not
the box still owns focus. When the release was *caused by* the user focusing something else, the
restore overrides that choice.

**The loop, traced.** Machine `focused`, `restoreFocusRef` = the input. User clicks a terminal pane:

1. xterm's own `mousedown` handler focuses its textarea (`terminal-client.tsx` — the run-kit
   suppressors around it are **coarse-pointer + scroll-lock gated only**, so on a desktop fine
   pointer this path is completely unobstructed). The omnibox input blurs.
2. `onBlur` (`:167-184`): `machineRef.current === "focused"` ✓; `relatedTarget` (the xterm textarea)
   is not within the box ✓; `evaluateMediaQuery(WIDE_RUNG_QUERY)` is true at ≥ `lg` →
   `setConsoleMachineState("rest")`.
3. The effect runs. `document.activeElement` is the xterm textarea, not the input, so the guarded
   `blur()` is skipped. `el = restoreFocusRef.current` = **the input** → `el.focus()` **yanks focus
   out of the terminal and back into the omnibox**.
4. That `focus()` fires the input's `onFocus`. `machineRef.current` is now `"rest"` (assigned during
   the committed render), so it calls `setConsoleMachineState("focused")`.
5. The effect runs again on `rest → focused`: `restoreFocusRef.current = document.activeElement` =
   the input (re-poisoned), then `el.focus(); el.select()`.

Net result: the terminal is focused for one microtask and then robbed; the box ends focused, engaged,
and with its draft **selected** — so each subsequent keystroke replaces the draft. Exactly symptom 2.

**Escape is caught in the same loop** (this is the interaction the request asked about). The document
listener in `operator-console.tsx:356-369` is *not itself defective* — it is a victim. At `focused`,
Esc → `setConsoleMachineState("rest")` → the effect's rest branch: `document.activeElement` **is** the
input, so `blur()` runs, then `el` (still the input) is re-focused → `onFocus` → `focused`. A user who
entered by mouse cannot Escape out either. Under the fix this path is preserved and correct: at Esc
the box genuinely still owns focus, so the guarded blur-then-restore runs exactly as the existing test
`"Esc at focused returns to rest: the box blurs and prior focus is restored"` asserts.

**Rung scoping.** The loop is **≥ `lg` only**. At md–lg with the machine at `rest`, the wrapper
carries `hidden lg:flex` → `display: none`, and `focus()` on a non-rendered element is a silent no-op,
so step 3 breaks. `el.isConnected` does *not* catch this (a `display:none` element is still
connected), which is why the guard reads as if it covers the case but does not. Matches the user's
report of a desktop symptom.

### Root cause of symptom 1 — two independent contributors

**1a. The same loop.** At the `focused` rung, "clicking outside" is steps 1–5 above with a different
click target (body, the heading, a breadcrumb). The box blurs for one microtask and re-focuses
itself, so it never releases and never loses the engaged chrome. This is the whole of symptom 1 for
the `focused` state and is fixed by RC1 + RC2.

**1b. The `open` state has no release path at all, and the engaged chrome lies.** `onBlur`'s first
line is `if (machineRef.current !== "focused") return;` — at `open` (after Enter, or the third ⌘J
step) a blur is a **total no-op**. That early return is correct for the drawer (the peek is
deliberately non-modal — `operator-console.md` § Design Decisions: *"Esc is a bubble-phase listener
honoring `defaultPrevented`, not a focus trap"*, and the live page below still owns its keys), so
clicking away must **not** close the drawer. But the box's chrome is derived as
`const active = machine !== "rest"` (`:120`) and drives the green border, the `w-[34ch]` width, and
the mounted context chip. At `open`-and-unfocused the box therefore *renders as if it owns focus
while it does not* — the visual half of symptom 1, surviving even after RC1/RC2 are fixed.

### Fix

Three parts. Parts A and B are the defect fix; part C makes the chrome tell the truth.

#### A. Guard the origin capture (RC1)

Never record an origin that lives inside the box. Add a ref on the wrapper `div` (which already
carries `data-operator-console`) and record `null` for anything it contains:

```tsx
const boxRef = useRef<HTMLDivElement>(null);
// …
if (machine !== "rest" && prev === "rest") {
  const origin = document.activeElement;
  // A mouse entry focuses the input BEFORE the machine transitions, so an
  // unguarded capture records the box itself — and the restore below would
  // then re-focus it, whose onFocus re-enters the machine: a loop with no
  // release. Only a genuine OUTSIDE origin is a restore target.
  restoreFocusRef.current =
    origin instanceof HTMLElement && !boxRef.current?.contains(origin) ? origin : null;
  const el = inputRef.current;
  if (el) { el.focus(); el.select(); }
}
```

#### B. Restore only while the box still owns focus (RC2)

A release caused by the user focusing something else must yield to that choice — the omnibox is not
the arbiter of where focus goes next once it has lost it:

```tsx
} else if (machine === "rest" && prev !== "rest") {
  const el = restoreFocusRef.current;
  restoreFocusRef.current = null;
  // The box only hands focus back when it still HAS it (Esc, the chord, the ✕).
  // A release caused by the user focusing elsewhere already has its owner.
  if (document.activeElement !== inputRef.current) return;
  inputRef.current?.blur();
  if (el instanceof HTMLElement && el.isConnected) el.focus();
}
```

A and B are independently sufficient to stop the loop; both are required for correctness. B alone
would leave `restoreFocusRef` holding the input, so an Esc release (where the box *does* still own
focus) would blur and immediately re-focus it. A alone would leave the omnibox overriding a
deliberate user click with a stale origin — e.g. chord-entry from terminal T1, click into terminal
T2, focus yanked back to T1.

#### C. Derive the engaged chrome from focus ownership, not from the machine alone

Track real focus in local state (set in the existing `onFocus`/`onBlur`, which already run on every
genuine transition) and split the two flags the single `active` currently conflates:

```tsx
const [boxFocused, setBoxFocused] = useState(false);
const wide = useMediaQuery(WIDE_RUNG_QUERY);

// `morphed` — the md–lg in-place morph: the box is RENDERED instead of the
// heading, and the ghost is hidden. Machine-derived, unchanged semantics.
const morphed = machine !== "rest";
// `engaged` — the box LOOKS like it owns input: green border, full width,
// mounted context chip. It must not claim focus it does not have. Below `lg`
// the morph-hold keeps it engaged while unfocused — retracting the box there
// would discard the visible draft the hold exists to protect.
const engaged = morphed && (boxFocused || !wide);
```

`morphed` keeps gating the ghost (`{!morphed && <button …>}`); `engaged` takes over the border,
width, and `<OperatorContextChip />` mount. This preserves the documented md–lg morph-hold contract
(`operator-console.md`: *"a click away never silently discards the in-place box"*) while making the
≥ `lg` `open`-and-unfocused box render at its slim rest width with a neutral border.

The `useMediaQuery(WIDE_RUNG_QUERY)` subscription that part C introduces makes a subscribed `wide`
available to `onBlur`, which currently reads the rung imperatively via `evaluateMediaQuery`. **Keep
the imperative read** — it is evaluated at event time and cannot race a pending re-render, and the
component's JSDoc (`:18-21`) documents that choice deliberately. Part C's subscription is for render,
not for the handler.

### Explicitly NOT changing

- **`lib/operator-console.ts`** — the machine slot (`getConsoleMachineState` / `setConsoleMachineState`
  / `cycleConsoleMachine` / `useConsoleMachineState`) is correct as written. The module-slot design is
  what lets the two trees share state; nothing about the state table is wrong.
- **`resolveConsoleServer` / `resolveOperatorConsoleTarget`** — examined per the request and **cleared**.
  Both are pure server/target resolution (`routeServer` → sole server → last-viewed → first) with no
  DOM, focus, or event involvement. Not implicated in either symptom; the plan should not chase them.
- **`terminal-client.tsx`** — cleared. xterm's `mousedown → textarea.focus()` works correctly on a
  desktop fine pointer; every run-kit suppressor around it (`contextmenu` capture, `touchend`,
  `mousedown` capture, the `focusin` backstop) is gated on `COARSE_POINTER_QUERY` and/or
  `scrollLocked`. The terminal is a **passive victim** — it takes focus correctly and has it stolen
  back one microtask later.
- **`operator-console.tsx`'s Escape listener** (`:356-369`) — cleared. It steps the machine correctly;
  its failure to release is entirely downstream of RC1/RC2. Its effect guard
  (`if (!open && machine === "rest") return;`) keeps it subscribed throughout the bounce, so no
  subscription change is needed. The chip re-engage effect (`:412-419`, keyed on
  `engaged = open || machine !== "rest"`) is **unaffected by part C**: that flag is the drawer
  component's own machine-derived value and is deliberately not the omnibox's new focus-derived one.
- **The drawer's outside-click behavior** — an outside click at `open` continues to leave the drawer
  open. Closing it would contradict the documented non-modal peek.

### Does the console machine ever yield focus back to the terminal?

**No — by construction, and this is the deeper answer to symptom 2.** The console's focus ownership
is a self-contained origin-ref implementation that does not participate in `lib/focus-memory.ts` at
all: it never calls `recordFocus`/`recallFocus`, never consults the restore router in `app.tsx`, and
is not mentioned in `focus-ownership.md`. Its only return path is `restoreFocusRef` — which, per RC1,
usually points at itself. The restore router's own effect is keyed `[server, windowParam]` and fires
on window switch, so it does not rescue this case either. After parts A and B the machine yields
correctly, but by *declining to act* (B's early return) rather than by routing through the focus
memory — which is the pragmatic choice given the console renders on routes that have no focus key.

### Why the unit tests did not catch this

`operator-omnibox.test.tsx` drives the transitions with `fireEvent.focus(input)` /
`fireEvent.blur(input)`, which dispatch React synthetic events **without moving
`document.activeElement`**. In jsdom the origin capture therefore records `document.body`, the
restore is a harmless no-op, and the loop can never form. The one test that uses real focus
(`"Esc at focused returns to rest"`) enters via the **chord**, the one path RC1 does not poison.

Regression coverage must therefore use **real focus movement**:

- **Unit (`operator-omnibox.test.tsx`)** — enter by real focus (`input.focus()` or `userEvent.click`),
  then `other.focus()` on an outside element, and assert `getConsoleMachineState() === "rest"` **and**
  `expect(other).toHaveFocus()` (the second assertion is the one that fails today). A companion case
  must enter by real click and then press Escape, asserting the box releases.
- **e2e** — a Playwright case on a terminal route in `operator-console.spec.ts` (or a sibling of
  `focus-restore.spec.ts`, which is the established rig for focus behavior jsdom cannot prove): click
  the omnibox, click into the xterm pane, type, and assert the keystrokes reach the tmux pane and the
  omnibox draft is unchanged. Per Constitution § Test Intent Comments, each `test()` needs its
  **Proves:** / **Steps:** JSDoc block.

---

## Affected Memory

- `run-kit/ui/operator-console`: (modify) § Requirement: The ⌘J three-state machine and the overlay
  requirement's focus-ownership sentence both state the return-to-rest contract unconditionally
  ("returning to rest blurs it and restores the previously focused element"). Both need the two
  invariants: an origin inside the box is never recorded, and the restore is skipped when the box no
  longer owns focus. § Requirement: the desktop omnibox needs the `morphed` vs `engaged` split and
  the statement that an outside click at `open` releases the box's chrome without closing the drawer.
- `run-kit/ui/focus-ownership`: (modify) The console is currently **absent** from the file that owns
  focus policy. Add it as a participant: why it keeps a local origin ref rather than the
  `recallFocus`/`restoreFocus` router (it mounts on Host/Board/Server routes that have no
  `(server, windowId)` focus key), and the two invariants that make the local ref safe — recorded as
  a `## Design Decisions` entry in the four-field shape, sibling to the existing *"Chord/Escape focus
  return rides `restoreFocus` — no origin storage"* entry it qualifies.
- `run-kit/ui/top-bar`: (modify) § Chrome (Top Bar) center cell describes the omnibox rungs and
  widths; the engaged-vs-rest chrome rule changes what the box looks like at `open`-and-unfocused.
  (Incidental drift noticed while reading: this section records `w-[20ch] xl:w-[26ch]` and the
  "Ask the operator…" placeholder unconditionally, while the code is `w-[12ch] 2xl:w-[20ch]` with a
  short `"Ask ◉…"` placeholder below `2xl` — a hydrate-time correction, not part of this fix's scope.)

## Impact

**Code (frontend only — no backend, no API, no WebSocket/SSE surface):**

| File | Change |
|------|--------|
| `app/frontend/src/components/operator-omnibox.tsx` | Parts A, B, C — the machine-follower effect (`:99-116`), a new `boxRef` on the wrapper `div`, a `boxFocused` state set from the existing `onFocus`/`onBlur`, a `useMediaQuery(WIDE_RUNG_QUERY)` subscription, and the `active` → `morphed`/`engaged` split at `:120` and its three render sites (`:130`, `:144-150`, `:204`). Component JSDoc updated. |
| `app/frontend/src/components/operator-omnibox.test.tsx` | Real-focus regression cases (see above); existing `fireEvent`-driven cases stay as machine-transition coverage. |
| `app/frontend/tests/e2e/operator-console.spec.ts` (or a new sibling) | Terminal-route focus-yield e2e with the required intent JSDoc. |

**Unchanged:** `app/frontend/src/lib/operator-console.ts`, `app/frontend/src/components/operator-console.tsx`,
`app/frontend/src/components/terminal-client.tsx`, `app/frontend/src/lib/focus-memory.ts`, all Go code.

**Blast radius:** the omnibox renders in the top bar on **every desktop route**, so a regression here
is globally visible. Conversely, the fix is confined to one component — nothing outside it reads
`restoreFocusRef` or the `active` flag.

**Constitution touchpoints:** V (Keyboard-First — the defect makes the keyboard unusable and Escape
non-functional); § Test Integrity and § Test Intent Comments (the new e2e `test()` needs its
Proves/Steps block); `code-quality.md` (new/changed behavior MUST have tests; UI changes SHOULD have
Playwright e2e).

**Verification gates** (`code-quality.md` § Verification): `cd app/frontend && npx tsc --noEmit`,
`just test-frontend`, `just test-e2e`, `just build`. Note the recorded environment caveat: prefix
frontend pnpm recipes with `PNPM_CONFIG_STRICT_DEP_BUILDS=false` if `ERR_PNPM_IGNORED_BUILDS` fires.

## Open Questions

None blocking. The two root causes are traced end-to-end in source and the one design call (outside
click must not close the drawer) is settled by the console's own recorded non-modal decision. The one
open aesthetic choice is recorded as assumption 7 for `/fab-clarify`.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Both symptoms trace to one loop in the machine-follower effect: RC1 (the origin ref records the box's own input on mouse entry) plus RC2 (the return-to-rest restore is unconditional). | Traced step-by-step through `operator-omnibox.tsx:99-116`/`:163-184`, the React focus/commit ordering, and the ≥`lg` vs md–lg `display:none` divergence that scopes it to wide desktop — matching the user's report exactly. | S:90 R:85 A:95 D:95 |
| 2 | Confident | Keep the console's local `restoreFocusRef` and add guards, rather than migrating its focus return onto `lib/focus-memory.ts`'s `recallFocus`/`restoreFocus` router. | The router is keyed on a terminal route's `(server, windowId)`; the console renders on Host, Board, and tmux Server routes where no such key exists, so a migration is a design change, not a bug fix. `focus-ownership.md`'s no-origin-storage decision is qualified in memory instead. | S:70 R:70 A:80 D:65 |
| 3 | Confident | An outside click at the `open` rung releases the box's chrome and focus but does **not** close the drawer. | `operator-console.md` § Design Decisions records the drawer as an explicitly non-modal peek that is "not a focus trap" and whose exit paths are Esc / chord / ✕ / ◉ — outside-click dismissal was already considered and is not among them. | S:55 R:75 A:65 D:60 |
| 4 | Certain | The md–lg morph-hold (a live draft holds the box rendered and engaged-looking while unfocused) must survive the chrome change — hence `engaged = morphed && (boxFocused || !wide)` rather than a naive focus-only flag. | An existing documented contract with a passing test ("a blur with a live draft HOLDS the morph at the narrow rung"); a focus-only chrome rule would retract the box and re-show the ghost, discarding the visible draft the hold exists to protect. | S:80 R:80 A:95 D:85 |
| 5 | Confident | Regression coverage must use real focus movement (`element.focus()` / `userEvent.click`) at the unit level plus a Playwright e2e on a terminal route; `fireEvent.focus`/`fireEvent.blur` cannot reproduce this class of bug. | Verified: the synthetic events do not move `document.activeElement`, so the origin capture records `document.body` in jsdom and the loop cannot form — which is precisely why the existing suite is green. Constitution and `code-quality.md` both mandate the coverage. | S:60 R:85 A:90 D:80 |
| 6 | Confident | Keep the imperative `evaluateMediaQuery(WIDE_RUNG_QUERY)` read inside `onBlur` even though part C introduces a subscribed `wide` for render. | Event-time evaluation cannot race a pending re-render, and the component's JSDoc records that as a deliberate choice; part C's subscription serves rendering only. Cheap to revisit if the handler ever needs the subscribed value. | S:50 R:80 A:65 D:55 |
| 7 | Tentative | At `open`-and-unfocused the box retracts to its slim rest width (`w-[12ch] 2xl:w-[20ch]`) rather than keeping `w-[34ch]` with only the border and chip dropped. | Purely visual, no signal in the request, two defensible answers (a retracting box reads as fully released; a width-stable box avoids top-bar reflow while the drawer is open). Trivially reversible — one class expression. Flagged for `/fab-clarify`. | S:20 R:85 A:35 D:35 |

7 assumptions (2 certain, 4 confident, 1 tentative, 0 unresolved).
