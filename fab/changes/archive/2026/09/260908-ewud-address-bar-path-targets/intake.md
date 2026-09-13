# Intake: Address Bar Defaults Path Input to Present Targets

**Change**: 260908-ewud-address-bar-path-targets
**Created**: 2026-09-08

## Origin

Conversational — designed during a `/fab-discuss` session (2026-09-08) exploring the web-pane
address model. The user's driving use case:

> can present be made default? (Use case - I use code-server to just copy the relative path,
> paste it in webpane, and it just works)

Key decisions reached in the discussion (also captured visually in the session's
`webpane-address-pipeline.html` explainer):

- **Frontend-only change** — `POST /api/windows/{id}/web` already resolves file/dir targets via
  `present.ParseTargetWithOrigins(target, cwd, …)` with the window's first-pane `WorktreePath` as
  cwd (`app/backend/api/windows_web.go:88-93`). The address bar is the only place paths are
  rejected.
- **Heuristic**: input containing `/` (or leading `./`) is always a path; single-segment dotted
  names (`README.md`) are decided by the backend stat — exists → present tab, else → the
  `https://` bare-domain fallback. The frontend stops pre-rejecting these.
- **Paste lands as append-or-focus** via the idempotent add verb — never in-place navigation of the
  current tab.
- **Parked**: preferring `@rk_win_code_root` over pane cwd as the resolution base (only if the
  pane-cwd base misfires in practice); everything Change 2 owns (rendering `.md`/`.excalidraw`).

A companion change (`260908-krov-present-viewer-shell`) adds the viewer shell that makes pasted
`.md`/`.excalidraw` files render; the two are independent and this one ships first.

## Why

1. **Pain point**: the fastest path from "file in my editor" to "file in the web tile" — copy
   relative path in code-server, paste in the address bar — dead-ends today. `isAllowedUrl`
   (`app/frontend/src/lib/web-url.ts`) accepts only absolute http(s) URLs and root-relative paths,
   so `docs/wiki/foo.html` is rejected inline and the POST never happens, even though the backend
   resolver was built for exactly this input (the CLI `rk present docs/wiki/foo.html` works today).
2. **Consequence of not fixing**: attaching a repo file requires dropping to the terminal for
   `rk present`, breaking the in-dashboard flow; worse, `README.md` pasted today silently becomes
   `https://readme.md` (the bare-domain regex — `.md` is Moldova's TLD), an external tab to the
   wrong place.
3. **Why this approach**: routing path-shaped input to the existing add verb reuses the resolution,
   idempotency, and content-keyed URL machinery unchanged — zero backend changes, and the resulting
   `/present/{server}/{roothash}/{path}` URL is copyable and survives restarts. Ordering the ladder
   so scheme-bearing URLs and loopback ports keep their exact behavior guarantees nothing that
   works today changes.

## What Changes

### `web-url.ts`: the decision ladder

`normalizeAddressInput` / `isAllowedUrl` (and the address-bar submit path that consumes them in the
web tile) learn two path lanes, evaluated after the existing rules so URL-shaped input is
untouched:

1. Has `http(s)` scheme → today's behavior (allowlist → POST), unchanged.
2. Bare loopback `host:port[…]` → `/proxy/{port}/…`, unchanged. Additionally, bare `:NNNN`
   (colon+digits) — rejected today by the address bar though the API/CLI accept it — is sent to the
   backend as a port target.
3. **New**: contains `/` or leading `./` → sent to the backend as a path target (no frontend
   rewriting; the backend stats it under the window's worktree cwd and answers with the resolved
   slot URL or an honest 400 "target does not exist").
4. **New**: single segment containing a dot (`README.md`, `example.com`) → sent to the backend as a
   path target first; on 400 (does not exist), fall back to the current `https://{name}` bare-domain
   form. The frontend's regex stops deciding what only a stat can decide.
5. Everything else (bare words, non-allowlist schemes) → inline reject, unchanged.

### Address-bar submit routing

- Path-shaped input (lanes 3–4) submits through `POST /api/windows/{id}/web` (the add verb —
  `toWebAddTarget` semantics for the body) instead of being pre-rejected. The add verb's
  idempotent target-identity match makes the paste **append-or-focus**: an existing tab for the
  same target focuses; a new target appends a tab. The current tab is never navigated in place.
- Error feedback: a backend 400 surfaces as the address bar's existing inline error state (the
  message from the response body, e.g. `target "docs/foo.md" does not exist`), replacing the
  frontend regex message for these lanes.

### What does NOT change

- Backend: zero changes — `handleWindowWebAdd`, `present.ParseTargetWithOrigins`, the `/present`
  route, and containment are all untouched.
- Security: the frontend allowlist is a mirror; enforcement stays server-side (`@rk_win_url` scheme
  allowlist + `/present` containment).
- Stored slot values, classification (`classifyAddress`), `displayForm`, `webTabTitle`,
  `toProxySrc`: untouched.
- The resolution base stays the window's first-pane `WorktreePath` (code-root preference parked).

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) the web tile address-bar contract — path lanes, the
  backend-stat tiebreaker for dotted single names, append-or-focus paste semantics

## Impact

- **Frontend only**: `app/frontend/src/lib/web-url.ts` + `web-url.test.ts` (ladder unit tests:
  every lane, the `README.md`-exists-vs-not fork, `:NNNN`, regression rows for today's passing
  inputs); the web tile address-bar submit handler in the iframe/web-tile component
  (`lenses-and-layout` surface) for the POST routing + 400 fallback + inline error.
- **e2e**: a Playwright spec where feasible — paste a repo-relative path into the address bar,
  assert a present tab appears (and that pasting again focuses rather than duplicates).
- No backend, build, or dependency changes.

## Open Questions

- None blocking — exact placement of the domain-fallback retry (frontend retry on 400 vs a single
  helper) is an apply-time decision recorded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Frontend-only: route path input to the existing add verb; zero backend changes | Verified in discussion against windows_web.go:88-93 — the resolver already handles file/dir with window cwd | S:90 R:85 A:95 D:90 |
| 2 | Certain | Ladder order preserves today's behavior for scheme-bearing URLs and loopback host:port | Discussed and shown in the explainer; regression-safety was an explicit requirement | S:85 R:85 A:90 D:85 |
| 3 | Confident | Slash-bearing / `./`-leading input is always a path; dotted single names are stat-decided with `https://` fallback on 400 | Discussed — "the backend stat is the tiebreaker, because it can actually check"; fixes the README.md→Moldova footgun | S:75 R:80 A:80 D:70 |
| 4 | Confident | Paste is append-or-focus via the idempotent add verb, never in-place navigation | Recommended in discussion as the cheaper, safer default; user accepted the collected set | S:60 R:85 A:80 D:65 |
| 5 | Confident | Resolution base stays the window's first-pane WorktreePath; `@rk_win_code_root` preference parked | Discussed — usually identical to the git root; one-line change later if it misfires | S:70 R:90 A:75 D:70 |
| 6 | Confident | Bare `:NNNN` joins the path-to-backend lane (becomes a port target) | The API/CLI already accept it; address-bar rejection is an artifact of the old gate | S:55 R:90 A:85 D:75 |
| 7 | Confident | Backend 400 body text becomes the inline address-bar error for the new lanes | The honest failure the discussion chose over frontend pre-judging; wording is easily tuned | S:50 R:95 A:80 D:70 |

7 assumptions (2 certain, 5 confident, 0 tentative, 0 unresolved).
