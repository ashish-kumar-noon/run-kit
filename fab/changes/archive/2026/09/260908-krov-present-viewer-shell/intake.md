# Intake: Present Viewer Shell for .md and .excalidraw

**Change**: 260908-krov-present-viewer-shell
**Created**: 2026-09-08

## Origin

Conversational — designed during a `/fab-discuss` session (2026-09-08) exploring the web-pane
address model. The user's goal:

> I want inbuilt support for rendering .md files (with mermaid diagrams), .html files,
> .exclaidraw etc. And in a way that URL is copyable and usable

Key decisions reached in the discussion:

- **Render at the same URL, not a new route** — the content-keyed `/present/{server}/{roothash}/{path}`
  URL stays the one copyable address for a document; no `/view/...` twin (Constitution IV).
- **Read-only, explicitly** — the user considered excalidraw write-back and decided "read-only for
  now"; write-back is parked as its own future change (framed as an rk-owned single-writer scratch
  file, not a bidirectional present route).
- **Explicit `?raw=1`, no content negotiation** — Accept-header magic was raised and set aside.
- **Excalidraw via the lightweight `exportToSvg` path** — not the full `@excalidraw/excalidraw`
  editor bundle; upgrade to the interactive viewer only if static SVG proves insufficient.
- `.html` behavior is untouched (it already renders).

A companion change (Change 1, separate intake) makes path-shaped address-bar input default to
present targets; the two are independent.

## Why

1. **Pain point**: `rk present` and the web tile can attach any file, but only `.html` renders —
   `.md` shows as raw text and `.excalidraw` as raw JSON, so the most common artifacts agents and
   humans produce in a repo (markdown reports, design notes, sketches) are unreadable in the very
   surface built to display them. The repo's own wiki design studies are hand-built HTML partly
   because `.md` cannot carry mermaid diagrams.
2. **Consequence of not fixing**: visual review of agent-generated markdown/diagrams keeps routing
   through ad-hoc HTML generation or leaves the web tile unused; the "copy path → paste → see it"
   loop (the point of the present pipeline) dead-ends for the majority file type.
3. **Why this approach**: serving a viewer shell at the document's own `/present/` URL keeps one
   copyable, restart-surviving address per document, reuses the existing symlink-resolved
   containment path unchanged, adds no route (Constitution IV), and makes relative links/images in
   rendered markdown resolve for free — a `/view?src=` indirection would break all of that.

## What Changes

### Backend: extension-gated viewer shell on `/present`

In `servePresentFile` (`app/backend/api/present.go`, the shared tail of both `/present/` arms):

- After `resolvePresentFile` succeeds, sniff the **resolved file's extension**. For `.md`,
  `.markdown`, and `.excalidraw` — when the request does **not** carry `raw=1` — respond with the
  embedded **viewer shell** HTML (status 200, `Content-Type: text/html; charset=utf-8`) instead of
  the file bytes.
- `?raw=1` (any present target) always serves the file bytes via the existing
  `http.ServeContent` path — byte-for-byte today's behavior. The shell itself fetches
  `location.pathname + '?raw=1'` (plus the original query's `v` cache-buster if present).
- Every other extension (`.html` included) is untouched. The containment/404 semantics are
  untouched — the sniff runs strictly after resolution succeeds.
- The shell is one static HTML asset served for both formats; it decides md-vs-excalidraw from the
  URL's extension client-side.

### Frontend: `viewer` Vite entry, embedded

- New Vite entry (e.g. `app/frontend/viewer.html` + `app/frontend/src/viewer/`) built into `dist/`
  and shipped through the existing dist → `embed.FS` pipeline. **No CDN assets** — remote hosts and
  the desktop shell must work offline; everything the viewer loads is same-origin embedded output.
- Code-split by format, lazy-loaded:
  - **Markdown**: a markdown renderer chunk; **mermaid** loads only when the document actually
    contains a ` ```mermaid ` fence (rendered client-side into the page).
  - **Excalidraw**: `exportToSvg` (from the excalidraw utils export) rendering the scene JSON to a
    static SVG — no editor bundle, no interactivity.
- Theming: light/dark via `prefers-color-scheme` (the iframe has no access to the app's three-mode
  toggle state); monospace-friendly, minimal chrome — the document is the page.
- Fetch/parse failures render an inline error state with a link to the `?raw=1` form (never a blank
  frame).

### Frontend: `web-url.ts` plumbing param

- Add `raw` to `PRESENT_PLUMBING_PARAMS` so `displayForm` hides it in the address bar alongside
  `server` and `v`. No other change to classification, normalization, or the allowlist.

### What does NOT change

- No new HTTP route; both `/present/` arms, containment, and 404 behavior are untouched.
- No write path of any kind (read-only decided; excalidraw write-back parked).
- No content negotiation — `?raw=1` is the only raw form.
- Security posture: a served `.html` file already executes same-origin script today, so client-side
  markdown rendering adds no new boundary; sanitization is not the trust boundary here (the tmux
  socket is, per the existing `/present` security notes).

## Affected Memory

- `run-kit/api-and-sockets`: (modify) `/present` route gains the extension-gated viewer-shell
  response and the `?raw=1` contract
- `run-kit/ui/lenses-and-layout`: (modify) web tile address model — `raw` joins the hidden plumbing
  params; viewer shell noted as what renders inside the frame for `.md`/`.excalidraw` present tabs
- `run-kit/build-and-release`: (modify) the `viewer` Vite entry joins the dist → `embed.FS`
  pipeline (build shape, chunk splitting)

## Impact

- **Backend**: `app/backend/api/present.go` (sniff + shell response + `raw=1` gate), Go tests
  alongside (`present_test.go` — sniff table: extensions × raw param × both arms).
- **Frontend**: new `app/frontend/viewer.html` + `src/viewer/` modules; `vite.config` multi-entry
  addition; `src/lib/web-url.ts` + `web-url.test.ts` (plumbing param).
- **Build**: dist copy → embed pipeline picks up the new entry (verify `just build` output serves
  the shell from the embedded FS).
- **Dependencies**: adds a markdown renderer, mermaid, and the excalidraw utils package to
  `app/frontend` (all lazy chunks; binary grows accordingly — mermaid is the heavy one).
- **Tests**: unit (Go sniff + web-url plumbing) plus a Playwright e2e where feasible: a present tab
  on a fixture `.md` renders the shell (heading visible) and `?raw=1` returns markdown source.

## Open Questions

- None blocking — renderer library choice (markdown-it vs marked) and exact viewer chunk layout are
  apply-time decisions recorded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Read-only viewer; no write-back, no editing | Discussed — user explicitly chose read-only; write-back parked as its own future change | S:95 R:90 A:95 D:95 |
| 2 | Certain | Serve the viewer shell at the same `/present/` URL, gated on extension, with `?raw=1` as the raw escape hatch | Discussed — user approved the collected change set; keeps one copyable URL, no new route (Constitution IV) | S:90 R:70 A:90 D:85 |
| 3 | Confident | Excalidraw renders via `exportToSvg` static SVG, not the full editor/viewer bundle | Recommended in discussion and accepted within the read-only framing; upgrade path stays open | S:70 R:80 A:75 D:60 |
| 4 | Confident | No Accept-header content negotiation — explicit `?raw=1` only | Raised as an open question in discussion; user proceeded with the explicit-param recommendation without objection | S:55 R:90 A:80 D:70 |
| 5 | Confident | Viewer ships as a separate embedded Vite entry with per-format lazy chunks; no CDN | Follows the existing dist→embed.FS pipeline and the offline posture (remote hosts, desktop shell) | S:60 R:70 A:90 D:80 |
| 6 | Confident | Markdown renderer library chosen at apply time (markdown-it or marked); rendered HTML not sanitized as a security boundary | Low-stakes, easily swapped; the `/present` route already serves same-origin-scripting `.html`, so sanitization is hygiene, not the boundary | S:40 R:85 A:60 D:50 |
| 7 | Confident | Extension set is `.md`, `.markdown`, `.excalidraw`; mermaid only via fenced code blocks | Matches the stated use case; other formats (`.csv`, `.json`) deliberately out to resist creep | S:65 R:90 A:75 D:70 |
| 8 | Confident | Viewer theming via `prefers-color-scheme` only, not the app's three-mode toggle | The iframe cannot see the SPA's theme state without new plumbing; system preference covers the common case | S:45 R:90 A:65 D:55 |

8 assumptions (2 certain, 6 confident, 0 tentative, 0 unresolved).
