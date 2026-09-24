# Plan: Proxy present over SOCKS

**Change**: 260924-bh5b-proxy-present-socks
**Intake**: `intake.md`

## Requirements

### R1: The `rk remote` tunnel carries a SOCKS proxy
`tunnelArgs` (`app/backend/internal/remote/tunnel.go`) SHALL emit `-D 127.0.0.1:{socksPort}` alongside the existing `-L 127.0.0.1:{localPort}:127.0.0.1:{remotePort}`, in the same one `ssh -N` invocation (argv only, no shell string; `BatchMode=yes`, `ServerAliveInterval=15` unchanged). The tunnel window, session (`rk-remotes`), and connect/disconnect lifecycle are otherwise unchanged.

- **GIVEN** a remote with local port 3110
- **WHEN** the tunnel opens
- **THEN** the ssh argv contains both `-L 127.0.0.1:3110:127.0.0.1:<remote>` and `-D 127.0.0.1:3210`

### R2: SOCKS port is derived, ranged, no store migration
A `SocksPort(localPort) int` helper (`ports.go`) SHALL return `localPort + 100` (range **3200–3299**, 1:1 with the immutable 3100–3199 `-L` range). Constants `SocksPortRangeStart=3200`/`SocksPortRangeEnd=3299` document the range. No `remotes.yaml` schema change.

- **GIVEN** localPort 3110 → SocksPort = 3210; localPort 3199 → 3299 (in range)

### R3: The derived SOCKS port is exposed for the shell
`rk remote status` (and its `--json`) SHALL include the SOCKS port for a remote whose tunnel is up, so the shell reads it rather than hardcoding the offset. `list` MAY add a column.

- **GIVEN** an up remote → `rk remote status <name> --json` includes `socksPort: 3210`

### R4: The present guest partition is SOCKS-proxied on rk-remote hosts
The desktop shell SHALL run present guest `WebContentsView`s in a dedicated session partition and, when the current host is an `rk remote` with a live SOCKS port, set that partition's proxy to `socks5://127.0.0.1:{socksPort}` with `proxyBypassRules: '<-loopback>'`. The dashboard host view SHALL stay direct (never proxied). The proxy is (re)applied on connect / the remote-tunnel heal and cleared on disconnect. A pure, electron-free decision fn maps (host is rk-remote, socksPort) → partition-proxy config.

- **GIVEN** the shell views an rk-remote host with socksPort 3210
- **THEN** the present-guest partition proxy = `socks5://127.0.0.1:3210`, bypass `<-loopback>`; the dashboard view is direct

### R5: The native engine loads the real origin when SOCKS is active
For a `proxy`-kind tile (main's `classifyAddress==="proxy"`, port via `proxyPortOf`), when the shell reports the SOCKS-proxied partition is active for the host, `web-frame-native.tsx` SHALL load `http://localhost:{port}{path}` (real remote origin, via the proxied guest session) instead of the same-origin `/proxy/{port}` URL.

- **GIVEN** a `/proxy/4300/editor` tile + active SOCKS partition
- **THEN** the guest loads `http://localhost:4300/editor` (routing/assets native; app sees `Host: localhost:4300`)

### R6: Fallback is byte-identical to main (no regression)
When SOCKS is inactive — no rk-remote SOCKS, iframe engine, tailscale-direct/plain host — present SHALL behave exactly as main (`toProxySrc`→`/proxy`). No non-rk-remote/native path changes.

- **GIVEN** a non-rk-remote host or the iframe engine
- **THEN** the tile loads `/proxy/{port}/…` exactly as today

### R7: Documented
Memory + spec updated: the tunnel's `-D`, the derived socks port, the proxied guest partition, the native real-origin load, and the fallback matrix.

## Tasks

### Phase 1: Backend — SOCKS on the tunnel
- [x] T001 `ports.go`: add `SocksPort(localPort int) int` (= localPort+100) + `SocksPortRangeStart/End` (3200/3299); unit test the mapping + range. <!-- R2 -->
- [x] T002 `tunnel.go` `tunnelArgs`: add `-D 127.0.0.1:{SocksPort(localPort)}` to the argv (thread the socks port in); keep argv-only, flags unchanged. <!-- R1 -->
- [x] T003 `status.go` (+ the `rk remote status`/`list` command surface): expose the socks port for up remotes (JSON `socksPort`; optional `list` column). <!-- R3 -->
- [x] T004 [P] Go tests: `tunnelArgs` contains both `-L` and `-D` with the derived port; `SocksPort` mapping/range; status output carries `socksPort`. <!-- R1 R2 R3 -->

### Phase 2: Shell — proxied guest partition
- [x] T005 Pure logic (electron-free, e.g. a `web-views.ts`/new module fn): given (host is rk-remote, socksPort|none) → the present-guest partition-proxy config (`socks5://127.0.0.1:{socksPort}` + `<-loopback>`, or direct). Unit-test it. <!-- R4 -->
- [x] T006 `main.ts`/`web-views.ts`: put present guests in a dedicated partition; call `session.setProxy(...)` from T005's decision on host connect / remote-tunnel heal; clear on disconnect; keep the dashboard view direct. Read `socksPort` from the `rk remote` surface (`remote-host.ts`). <!-- R4 -->
- [~] T007 (SUBSUMED — no renderer signal needed; the shell's main process rewrites the /proxy URL to the real origin, so the native engine is unchanged) Signal SOCKS-active state to the SPA (so the native engine can choose the URL) — a shell→renderer bit (the existing `web:*`/shell bridge), per host. <!-- R4 R5 -->

### Phase 3: Frontend native engine
- [~] T008 (SUBSUMED — see T007: main-side rewrite in createWebView via guestProxyPlan means web-frame-native.tsx needs no change; byte-identical fallback preserved) `web-frame-native.tsx`: when SOCKS-active (T007) and the tile is `proxy`-kind, build the guest src as `http://localhost:{proxyPortOf(url)}{path}` instead of `toProxySrc(url)`; else unchanged. Unit-test both branches. <!-- R5 R6 -->

### Phase 4: Tests + docs
- [x] T009 [P] Shell pure-logic + native-engine URL-selection tests (both from their targets). <!-- R4 R5 R6 -->
- [x] T010 Docs: `docs/memory/run-kit/remote-hosts.md` (the `-D`/socks port), `desktop-shell.md` (proxied guest partition), `ui/lenses-and-layout.md` (native real-origin load); spec note on the SOCKS-present default + fallback. <!-- R7 -->

## Execution Order
- T001 → T002 (tunnel uses SocksPort); T003 independent; T004 follows.
- T005 → T006 → T007 (shell); T008 depends on T007's signal.
- Tests follow targets; T010 independent.

## Acceptance

### Functional
- [x] A-001 R1: the tunnel argv carries both `-L …` and `-D 127.0.0.1:{localPort+100}`.
- [x] A-002 R2: `SocksPort(3110)=3210`; boundary 3199→3299; helper + range constants exist.
- [x] A-003 R3: `rk remote status --json` exposes `socksPort` for an up remote.
- [x] A-004 R4: for an rk-remote host, the present-guest partition proxy = `socks5://127.0.0.1:{socksPort}` + `<-loopback>`; the dashboard view stays direct.
- [x] A-005 R5: a `proxy`-kind tile with SOCKS active loads `http://localhost:{port}{path}` (not `/proxy`).

### Behavioral
- [x] A-006 R6: SOCKS inactive (non-rk-remote / iframe) → present loads `/proxy/{port}/…` byte-identical to main.

### Edge / Security
- [x] A-007 R4: only the present-guest partition is proxied; the dashboard's `/api`+`/ws` never route through SOCKS.
- [x] A-008 R1: the tunnel stays argv-only (no shell interpolation, §I); disconnect tears down `-D` with the window (no separate lifecycle).

### Code Quality
- [x] A-009 Reuses `tunnelArgs`/`ports.go`/existing `rk remote` status + main's `classifyAddress`/`proxyPortOf`; no fork of the tunnel or a second present path; independent of #1029 (no `app:`/`host_routing`).

## Review Rework (independent review — VERDICT: PASS, 0 must-fix)

The reviewer confirmed the load-bearing properties (per-host isolation; dashboard never proxied; byte-identical fallback; setProxy-before-load ordering; independence from #1029). Applied should-fixes + nice-to-haves:
- SF1: `web:load` now routes through `guestProxyPlan` (main.ts) — a `/proxy` URL sent to a SOCKS-partition guest is rewritten to the real origin, so the rewrite invariant holds at that IPC boundary too (was latent: `loadShellWebView` has no production caller).
- SF4: added guest-proxy tests — remote host with url port OUTSIDE 3100–3199 → direct; malformed url → direct (no throw); absolute `/proxy` URL with query+hash → rewritten, query+hash kept; out-of-range tile port → not rewritten.
- N1: `setProxy` promise now has `.catch` + `.finally` (no unhandled rejection; the load still fires).
- N2: absolute `/proxy` URL now preserves the hash (`pathname+search+hash`).
- N3: `proxyTile` rejects a tile port outside 1–65535.

Accuracy corrections (the reviewer flagged the plan wording, not the code):
- **R3 / A-003**: implemented as a human-readable `SOCKS: 127.0.0.1:{port}` line in `rk remote status` + a `SOCKS` column in `list` — there is NO `--json socksPort` field (the shell doesn't consume JSON). A-003 should read "status/list expose the SOCKS address as text".
- **R2 / A-002**: the shell **derives** the SOCKS port (`localPort + 100`, mirroring backend `ports.go` — a `// MIRRORS backend` comment marks the single conceptual source), it does NOT read the exposed value. The status/list exposure is for humans/debugging. The "shell reads it rather than hardcoding" rationale is superseded by derive-with-mirrored-constant.

## Assumptions
| # | Grade | Decision | Rationale | Scores | Artifact |
|---|-------|----------|-----------|--------|----------|
| 1 | Certain | Electron behaviors hold (spike PASSED) | resolveProxy=SOCKS5 for loopback, atyp=domain, direct stays direct | S:95 R:90 A:95 D:95 | plan |
| 2 | Confident | socksPort = localPort+100, exposed in status; no store migration | 1:1 with the immutable L range; shell reads it, no hardcoded offset | S:80 R:75 A:80 D:80 | plan |
| 3 | Confident | Independent of #1029 via main's `/proxy` classification | classifyAddress/proxyPortOf on main; orthogonal files | S:85 R:85 A:85 D:85 | plan |

3 assumptions (1 certain, 2 confident).
