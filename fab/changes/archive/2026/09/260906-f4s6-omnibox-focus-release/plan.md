# Plan: Operator Omnibox Focus Release

**Change**: 260906-f4s6-omnibox-focus-release
**Intake**: `intake.md`

## Requirements

### Frontend UI: Operator Omnibox Focus Ownership

#### R1: The origin capture excludes the box itself
On entering the ⌘J machine from `rest`, the omnibox SHALL record a focus-restore origin ONLY when
the element that held focus at entry lies OUTSIDE the omnibox wrapper. An origin inside the wrapper
(the input itself, the context chip's ✕, the keycap) SHALL be recorded as `null`.

A mouse click into the standing box focuses the input BEFORE the input's `onFocus` transitions the
machine, so an unguarded `document.activeElement` capture records the box's own input — which the
restore in R2 then re-focuses, whose `onFocus` re-enters the machine. That loop is the defect.

- **GIVEN** the wide rung (≥ `lg`) with the machine at `rest`
- **WHEN** the user clicks into the standing box
- **THEN** the machine enters `focused` and NO restore origin is recorded
- **AND WHEN** the machine later returns to `rest`, **THEN** the box is not re-focused by the restore

- **GIVEN** the machine at `rest` with focus on an element outside the omnibox
- **WHEN** the ⌘J chord enters the machine
- **THEN** that outside element IS recorded as the restore origin (today's behavior, unchanged)

#### R2: Focus is returned only while the box still owns it
On returning to `rest`, the omnibox SHALL blur itself and focus the recorded origin ONLY when the
omnibox input is still `document.activeElement` at that moment. When focus already sits elsewhere,
the omnibox SHALL take no focus action at all.

The release is caused either by the box giving focus up (Escape, the ⌘J chord, the ✕ — the box still
owns focus) or by the user focusing something else (a terminal pane, a button — the new owner is
already correct). The omnibox arbitrates only the first case.

- **GIVEN** the machine at `focused` on a terminal route, with the omnibox holding focus
- **WHEN** the user clicks into the xterm terminal pane
- **THEN** the machine returns to `rest`, the omnibox performs no focus call, and the xterm textarea
  keeps focus
- **AND** subsequent keystrokes reach the tmux pane, and the omnibox draft is unchanged

- **GIVEN** the machine at `focused` entered by the ⌘J chord from an outside element
- **WHEN** Escape steps the machine to `rest` (the console's document listener)
- **THEN** the omnibox blurs and focus returns to that outside element (today's behavior, preserved)

- **GIVEN** the machine at `focused` entered by a mouse click into the standing box
- **WHEN** Escape steps the machine to `rest`
- **THEN** the box blurs and releases — it does NOT re-focus itself

#### R3: The engaged chrome follows real focus ownership
The omnibox SHALL derive its two visual states from separate flags rather than from the machine
alone:

- **`morphed`** (`machine !== "rest"`) — whether the box is RENDERED in place of the heading at the
  md–lg rung, and therefore whether the `· ◉ ask` ghost is hidden. Machine-derived; semantics
  unchanged from today's `active`.
- **`engaged`** — whether the box LOOKS like it owns input: the accent border, the widened
  `w-[34ch]`, and the mounted `OperatorContextChip`. It SHALL be true only when `morphed` AND
  (the box holds focus OR the viewport is below the wide rung).

The below-`lg` term is the morph-hold carve-out: at md–lg the box stands in place of the heading and
a live draft holds it there after a blur, so retracting its chrome would visually discard a message
the user has typed but not sent.

Focus ownership SHALL be tracked from the input's real `focus`/`blur` events, and a blur whose
`relatedTarget` lies within the wrapper SHALL NOT clear it — releasing there would unmount the
context chip before its ✕ click lands, the same reason the existing machine-release guard exists.

- **GIVEN** the wide rung with the machine at `open` (the drawer down after Enter) and the omnibox
  holding focus
- **WHEN** the user clicks into a terminal pane
- **THEN** the drawer STAYS open, and the box renders at its resting width with a neutral border and
  no context chip

- **GIVEN** the md–lg rung with the machine at `focused` and a non-empty draft
- **WHEN** the user clicks away
- **THEN** the machine HOLDS at `focused`, the box stays rendered AND engaged-looking, and the ghost
  does not return

- **GIVEN** the machine engaged with the context chip shown
- **WHEN** the user clicks the chip's ✕
- **THEN** the box does not stand down and the dismissal lands

#### R4: Regression coverage exercises real focus movement
Coverage for R1–R3 SHALL move focus for real. Unit tests SHALL drive entry and release with
`element.focus()` / `userEvent.click` (never `fireEvent.focus` / `fireEvent.blur` alone, which
dispatch React synthetic events without moving `document.activeElement` and therefore cannot form
the loop), and SHALL assert the resulting focus OWNER, not only the machine state. A Playwright e2e
SHALL prove the terminal-route yield that jsdom cannot: keystrokes after a terminal click reach the
tmux pane.

- **GIVEN** the unit suite
- **WHEN** a test enters the machine by real focus and then focuses an outside element
- **THEN** it asserts both `getConsoleMachineState() === "rest"` AND that the outside element holds
  focus

- **GIVEN** the e2e suite on a terminal route
- **WHEN** the omnibox is clicked, then the xterm pane is clicked, then text is typed
- **THEN** the typed text appears in the terminal and the omnibox input value is unchanged
- **AND** the `test()` carries the constitution's **Proves:** / **Steps:** JSDoc block

### Non-Goals

- **Closing the drawer on an outside click** — the drawer is a deliberately non-modal peek whose
  exit paths are Escape, the chord, the ✕, and the ◉ button. Outside-click dismissal was considered
  and rejected in the console's own recorded design decision.
- **Migrating the console onto `lib/focus-memory.ts`'s restore router** — see the Design Decision
  below. The console renders on Host, Board, and tmux Server routes that have no
  `(server, windowId)` focus key.
- **Changing the ⌘J machine, its state table, or `lib/operator-console.ts`** — the machine is
  correct; only the omnibox's follower effect is defective.
- **Changing `terminal-client.tsx`** — xterm takes focus correctly on a desktop fine pointer; it is
  the victim, not a cause.
- **Correcting the `top-bar.md` width/placeholder drift** (`w-[20ch] xl:w-[26ch]` recorded vs
  `w-[12ch] 2xl:w-[20ch]` shipped) beyond what this change's own edits require — noted in the intake
  as a hydrate-time observation.

### Design Decisions

#### The console keeps a guarded local origin ref rather than the focus-memory restore router
**Decision**: the omnibox continues to hold its own `restoreFocusRef` for the ⌘J machine's focus
return, with two invariants added — an origin inside the omnibox wrapper is never recorded, and the
return is skipped unless the box still owns focus.
**Why**: `lib/focus-memory.ts`'s `recallFocus`/`restoreFocus` router is keyed on a terminal route's
`(server, windowId)`, and the omnibox renders in the top bar on Host, Board, and tmux Server routes
where no such key exists — the router has no target to resolve on three of the four routes. The two
invariants give the local ref the same safety property the router has (never override a newer
genuine user choice) without inventing a route-agnostic focus key.
**Rejected**: routing the console's return through `restoreFocus` — a design change, not a bug fix,
and unresolvable on the majority of routes the console renders on.
*Introduced by*: 260906-f4s6-omnibox-focus-release

#### The omnibox yields focus by declining to act, not by routing it
**Decision**: when the machine returns to `rest` while focus already sits outside the box, the
omnibox performs no focus call whatsoever — it neither blurs nor restores.
**Why**: the element the user just clicked is already the correct owner. Any focus call at that
moment is a steal, and the omnibox has no information about where focus *should* go that the
browser does not already have. This is the same conclusion the focus-ownership domain reached from
the other direction with its recording asymmetry: a mechanism that can only ever act toward a
genuine user choice cannot fight one.
**Rejected**: blurring unconditionally and letting focus fall to `document.body` — loses the
terminal's focus for no benefit and breaks the Escape return contract.
*Introduced by*: 260906-f4s6-omnibox-focus-release

#### Engaged chrome is focus-derived, with the md–lg morph-hold as the carve-out
**Decision**: the single `active = machine !== "rest"` flag splits into `morphed` (machine-derived,
gates the ghost and the in-place render) and `engaged = morphed && (boxFocused || !wide)` (gates the
accent border, the widened box, and the context chip).
**Why**: at the `open` rung a blur deliberately does not release the machine — the drawer is a peek
— so a machine-derived chrome flag makes the box claim focus it does not have while the user types
in a terminal. Below `lg` the box replaces the heading and a live draft holds it there, so the
chrome must stay lit while unfocused or the visible draft appears to vanish.
**Rejected**: a purely focus-derived `engaged` — retracts the md–lg morph and re-shows the ghost on
a click-away, discarding the visible draft the hold exists to protect.
*Introduced by*: 260906-f4s6-omnibox-focus-release

## Tasks

### Phase 1: Core Implementation

- [x] T001 In `app/frontend/src/components/operator-omnibox.tsx`, add a `boxRef` on the wrapper `div` (the element already carrying `data-operator-console`), and guard the machine-entry branch of the focus-ownership effect so `restoreFocusRef.current` records `document.activeElement` only when it is an `HTMLElement` outside `boxRef.current`, else `null`. Reuse `boxRef` for the `onBlur` within-box check in place of `e.currentTarget.parentElement`. <!-- R1 -->
- [x] T002 In the same effect's return-to-`rest` branch, take no focus action unless `document.activeElement === inputRef.current`; when it is, blur the input and focus the recorded origin as today (guarded by `instanceof HTMLElement && isConnected`). Clear `restoreFocusRef` on every release path. <!-- R2 -->
- [x] T003 In the same file, add a `boxFocused` state set from the input's `onFocus`/`onBlur` (the blur write skipped when `relatedTarget` is within `boxRef`), add a `useMediaQuery(WIDE_RUNG_QUERY)` subscription for render, and replace `active` with `morphed` (ghost gate, in-place render) and `engaged = morphed && (boxFocused || !wide)` (border, width, `OperatorContextChip` mount). Keep the event-time `evaluateMediaQuery(WIDE_RUNG_QUERY)` read in `onBlur` and update the component JSDoc, which currently states no live rung subscription exists. <!-- R3 -->

### Phase 2: Coverage

- [x] T004 [P] In `app/frontend/src/components/operator-omnibox.test.tsx`, add real-focus regression cases: (a) real-click entry then focusing an outside element asserts machine `rest` AND the outside element holds focus; (b) real-click entry then Escape asserts the box releases and does not re-focus itself; (c) at the wide rung with the machine at `open`, blurring to an outside element leaves the drawer open while the box renders resting-width with no chip; (d) the chip's ✕ still lands from an engaged box. Keep the existing `fireEvent`-driven cases as machine-transition coverage. <!-- R4 -->
- [x] T005 [P] In `app/frontend/tests/e2e/operator-console.spec.ts`, add a terminal-route focus-yield test: click the omnibox, click into the xterm pane, type, and assert the keystrokes reach the tmux pane and the omnibox draft is unchanged. Include the constitution-mandated **Proves:** / **Steps:** JSDoc block and extend the file-header comment if new shared setup is added. <!-- R4 -->

## Execution Order

- T001 → T002 → T003 are the same file and the same effect; run them in order.
- T004 and T005 are independent of each other and both depend on T003.

## Acceptance

### Functional Completeness

- [x] A-001 R1: Entering the machine by a real mouse click into the standing box records no restore origin; entering by the chord from an outside element still records that element.
- [x] A-002 R2: The return-to-`rest` branch performs no focus call when `document.activeElement` is not the omnibox input.
- [x] A-003 R3: `morphed` and `engaged` are distinct derived values; `morphed` gates the ghost and the in-place render, `engaged` gates the accent border, the widened width, and the context chip.
- [x] A-004 R4: The unit suite contains cases that move focus for real and assert the focus OWNER, and an e2e case proves the terminal-route yield.

### Behavioral Correctness

- [x] A-005 R2: On a terminal route at the `focused` rung, clicking into the xterm pane leaves focus in the terminal — the omnibox does not re-acquire it, and the machine settles at `rest` rather than bouncing back to `focused`.
- [x] A-006 R2: Escape from a mouse-entered box releases it (machine `rest`, box blurred); Escape from a chord-entered box still restores focus to the pre-chord element — the existing test for that path passes unmodified.
- [x] A-007 R3: At the wide rung with the drawer open, an outside click leaves the drawer open while the box renders at `w-[12ch] 2xl:w-[20ch]` with the default border and no chip.
- [x] A-008 R3: At the md–lg rung, a blur with a non-empty draft holds the machine at `focused`, keeps the box rendered AND engaged-looking, and does not re-show the ghost — the existing morph-hold test passes unmodified.

### Scenario Coverage

- [x] A-009 R1: A test proves the origin capture is skipped for an in-box origin (the loop's precondition is gone), not merely that the end state looks right.
- [x] A-010 R3: A test proves the chip's ✕ still dismisses from an engaged box — the within-box blur does not stand the chrome down.
- [x] A-011 R4: The new e2e `test()` carries a **Proves:** / **Steps:** JSDoc block per the constitution's Test Intent Comments rule.

### Edge Cases & Error Handling

- [x] A-012 R2: A recorded origin that has since unmounted (`isConnected === false`) is skipped without throwing.
- [x] A-013 R3: The mobile early return still fires before any render work, and every hook (including the new `useState` and `useMediaQuery`) is called unconditionally above it — no conditional-hook violation.
- [x] A-014 R1: `resolveConsoleServer` / `resolveOperatorConsoleTarget`, `lib/operator-console.ts`'s machine, `operator-console.tsx`'s Escape listener, and `terminal-client.tsx` are unmodified — the fix is confined to the omnibox component and its tests.

### Code Quality

- [x] A-015 Pattern consistency: New code follows the naming and structural patterns of the surrounding component (ref/state placement above the mobile early return, the existing `machineRef`/`textRef` mirroring idiom).
- [x] A-016 No unnecessary duplication: `boxRef` serves both the origin guard and the `onBlur` within-box check rather than a second containment expression; `WIDE_RUNG_QUERY` stays the single named constant for the rung.
- [x] A-017 Type narrowing over assertions: containment and restore guards use `instanceof` narrowing, not `as` casts.
- [x] A-018 Comment discipline: comments state the invariants the code cannot show (why an in-box origin is never recorded; why the release declines to act; why the md–lg term keeps the chrome lit) — no next-line narration, no reviewer address, no change ID or PR citations.
- [x] A-019 Test coverage: the bug fix ships with tests covering the changed behavior, and the UI change ships with a Playwright e2e.
- [x] A-020 Verification gates pass: `npx tsc --noEmit`, `just test-frontend`, `just test-e2e`, `just build`.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Environment caveat: prefix frontend pnpm recipes with `PNPM_CONFIG_STRICT_DEP_BUILDS=false` if `ERR_PNPM_IGNORED_BUILDS` fires.

## Deletion Candidates

None — this change adds focus-ownership guards and splits the `active` render flag in place without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `boxRef` replaces `e.currentTarget.parentElement` in the existing `onBlur` within-box check rather than living alongside it. | The wrapper `div` IS `input.parentElement`, so the two expressions are equivalent; one named ref for one concept avoids a second containment idiom in the same handler (`code-quality.md` § Anti-Patterns → duplication). | S:75 R:90 A:90 D:85 |
| 2 | Certain | `boxFocused` is cleared only on a blur whose `relatedTarget` is outside the wrapper. | Without the carve-out the chip unmounts before its ✕ click lands — the exact failure the existing machine-release guard was written to prevent, now applying to the chrome flag too. | S:80 R:80 A:95 D:90 |
| 3 | Confident | `onBlur` keeps its event-time `evaluateMediaQuery(WIDE_RUNG_QUERY)` read even though T003 introduces a subscribed `wide` for render. | Event-time evaluation cannot race a pending re-render, and the component JSDoc records that as a deliberate choice; the subscription serves rendering only. Carried forward from the intake's assumption 6. | S:50 R:80 A:65 D:55 |
| 4 | Confident | The e2e goes into the existing `operator-console.spec.ts` rather than a new spec file. | The console's e2e rig, fixtures, and file-header setup already live there and this is one more console behavior; a new file would duplicate the harness. `focus-restore.spec.ts` is the alternative home but is scoped to the code-server steal guard. | S:55 R:85 A:75 D:65 |
| 5 | Tentative | At `open`-and-unfocused the box retracts to its slim rest width rather than holding `w-[34ch]` with only the border and chip dropped. | Purely visual, no signal in the request, two defensible answers (retracting reads as fully released; width-stable avoids top-bar reflow while the drawer is open). One class expression to reverse. Carried forward from the intake's assumption 7. | S:20 R:85 A:35 D:35 |

5 assumptions (2 certain, 2 confident, 1 tentative).
