# Intake: Proxy present over SOCKS

**Change**: 260924-bh5b-proxy-present-socks
**Created**: 2026-09-24

## Origin

Developed across an extended design discussion + a de-risking spike. Goal: when the desktop shell views an **`rk remote`** (SSH-only) host, `rk present` should load a remote dev app at its **real origin** — so a full SPA's client-side routing and root-absolute assets work — instead of the `/proxy/{port}/` path prefix that breaks them.

Mechanism (from the `proxy-chrome` reference in `wvrdz/dev-shell`, adapted to run-kit): route the **present guest's Chromium** through a **SOCKS5-over-SSH** tunnel to the remote box, so `localhost:{port}` in the guest resolves and dials on the **remote** loopback. `rk remote` already holds an `ssh -N -L` tunnel (PR #503, on main) — we add `-D` (SOCKS) to that same connection, then scope an Electron per-partition proxy to the present guests.

**Spike PASSED (2026-09-24)** — an Electron v43 spike with a logging SOCKS5 proxy confirmed all three load-bearing behaviors:
1. `session.setProxy({ proxyRules:'socks5://…', proxyBypassRules:'<-loopback>' })` routes `localhost` / `127.0.0.1` / `*.localhost` **through** the proxy (Chromium `resolveProxy` returned `SOCKS5 …` for all three, not `DIRECT`).
2. Electron's SOCKS5 does **remote DNS** — the proxy logged every CONNECT as `atyp=domain` (the hostname, incl. `localhost`/`*.localhost`, is sent for remote resolution).
3. A second partition with `setProxy({mode:'direct'})` stayed `DIRECT` — **per-partition scoping** works (dashboard view unaffected).

Interaction mode: conversational; the design + spike were validated live.

## Why

1. **Problem**: in the desktop shell's **native present engine** (Electron `WebContentsView`, not an iframe on main), a remote dev app is reached through the single `ssh -L` daemon port via `/proxy/{port}/`. A path prefix breaks a full SPA (root-absolute assets resolve to the wrong root; client-side routing / reload 404).
2. **Consequence if unfixed**: full SPAs (e.g. loom) can't be presented usefully to a shell viewer on an `rk remote` host.
3. **Why this approach**: the `rk remote` tunnel already exists and run-kit owns its lifecycle; adding `-D` is one flag on one connection. A SOCKS-proxied guest partition reaches the app at its **true** `localhost:{port}` — no path prefix, no origin minting, no server-side routing, and the app's Host allowlist passes (it sees `localhost:{port}`). Rejected: `/proxy` (breaks SPAs); own-origin minting (separate PR; needs server-side host routing); an external proxied Chrome (proxy-chrome — whole-browser proxy, cross-platform browser-path problem — avoided by using the shell's own Chromium).

## What Changes

**INDEPENDENT of the own-origin PR (#1029).** This keys off main's EXISTING `/proxy` classification (`classifyAddress`/`proxyPortOf`), not `app:{port}`/`mintAppSrc`/`host_routing.go`. Works whether or not #1029 merges. Scope: the **`rk remote` SSH transport**, the **native engine**, **default-on**; everything else (iframe engine, tailscale-direct, plain-URL hosts) is unchanged and falls back to today's `/proxy`.

### 1. Add SOCKS to the `rk remote` tunnel — `app/backend/internal/remote/`
- `tunnel.go` `tunnelArgs(target, localPort, remotePort)` SHALL also emit **`-D 127.0.0.1:{socksPort}`** alongside the existing `-L 127.0.0.1:{localPort}:127.0.0.1:{remotePort}`. Same one ssh invocation, same `rk-remotes` tmux window, same connect/disconnect lifecycle. Still `-N`, `BatchMode=yes`, `ServerAliveInterval=15`, no shell interpolation (argv).
- **SOCKS port derivation** (`ports.go`): `socksPort = localPort + 100` → the **3200–3299** range (parallel and 1:1 with the immutable 3100–3199 `-L` range; no store migration). A `SocksPort(localPort int) int` helper; a range-guard constant pair mirroring `PortRangeStart/End`.
- **Expose it** so the shell needn't hardcode the offset: `rk remote status`/`list` (and the JSON forms) SHALL include the derived SOCKS port for each remote whose tunnel is up.

### 2. Proxy the present guest partition — `app/desktop/src/`
- Present guest `WebContentsView`s SHALL live in a **dedicated session partition** whose proxy is set to `socks5://127.0.0.1:{socksPort}` with `proxyBypassRules: '<-loopback>'` when the current host is an `rk remote` with a live SOCKS tunnel; the **dashboard view stays direct** (never proxied).
- The shell learns `{socksPort}` from the `rk remote` surface it already `execFile`s (`remote-host.ts`), and applies/clears the partition proxy on host connect / disconnect / the existing remote-tunnel heal.
- Pure logic (electron-free, testable) decides "given host = rk-remote + socksPort → proxied-partition config"; the electron wiring calls `session.setProxy`.

### 3. Load the real origin in the native engine — `app/frontend/src/components/web-frame-native.tsx`
- For a **`proxy`-kind** tile (main's `classifyAddress(url) === "proxy"`, port via `proxyPortOf`), when the shell reports the SOCKS-proxied partition is active for this host, the guest SHALL load **`http://localhost:{port}{path}`** (the real remote origin, via the proxied session) instead of the same-origin `/proxy/{port}` URL.
- When SOCKS is inactive (no rk-remote SOCKS, iframe engine), it SHALL keep today's `toProxySrc`→`/proxy` behavior — pure fallback, byte-identical to main.
- The address form (`localhost:{port}` vs `127.0.0.1:{port}`) is `localhost:{port}` — the spike proved both route through SOCKS with remote DNS; `localhost` keeps the app's expected origin.

### Explicitly OUT of scope
- Tailscale-direct / plain-URL / hosted transports (no existing SSH tunnel to add `-D` to) — unchanged, stay on `/proxy`.
- The iframe / PWA / phone engines (can't scope a per-session proxy) — unchanged, `/proxy`.
- Any dependency on `host_routing.go` / `--app` / `mintAppSrc` (the own-origin PR).
- A standalone external-browser `proxy-chrome` helper (we use the shell's own Chromium).

## Affected Memory
- `run-kit/remote-hosts`: (modify) the tunnel now also carries `-D` SOCKS; the derived 3200–3299 socks port; exposed in status.
- `run-kit/desktop-shell`: (modify) present guest views run in a SOCKS-proxied partition for rk-remote hosts; dashboard stays direct.
- `run-kit/ui/lenses-and-layout`: (modify) the native engine loads the real origin through the proxied session on rk-remote SOCKS, else `/proxy`.
- `docs/specs/…` (remote / present): (modify) document the SOCKS-present default + fallback.

## Impact
- Modified: `app/backend/internal/remote/{tunnel.go,ports.go,status.go}` (+ tests), the `rk remote` status output; `app/desktop/src/{web-views.ts,main.ts,remote-host.ts}` (+ pure-logic tests); `app/frontend/src/components/web-frame-native.tsx` (+ test).
- No new env keys (§IV). No shell strings (§I — argv only). tmux/filesystem source of truth (§II — the tunnel window already is). `/proxy` default untouched (fallback), so no regression for any non-rk-remote / non-native viewer.

## Open Questions
- Expose the socks port in `rk remote status` JSON only, or also a plain-text column? (Leaning: JSON + a `list` column.)
- Default-on for all rk-remote hosts vs a per-host opt-in first time? (Leaning: default-on; escape hatch to disable.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Electron per-partition `setProxy` + `<-loopback>` routes localhost/`*.localhost` through SOCKS with remote DNS; direct partition stays direct | Spike PASSED 2026-09-24 (resolveProxy=SOCKS5 for all loopback forms; atyp=domain; direct=DIRECT) | S:95 R:90 A:95 D:95 |
| 2 | Certain | Add `-D` to the existing `rk remote` `ssh -N -L` in `tunnelArgs` — one connection, existing lifecycle | Grounded in tunnel.go:68 `tunnelArgs`; same `rk-remotes` window | S:90 R:85 A:90 D:90 |
| 3 | Confident | Derive socksPort = localPort + 100 (3200–3299), no store migration; expose in status | ports.go assigns an immutable 3100–3199 L port; +100 is 1:1 and avoids a remotes.yaml schema change | S:80 R:75 A:80 D:80 |
| 4 | Confident | Reuse main's `/proxy` classification (not `app:{port}`) so this is independent of #1029 | classifyAddress "proxy" + proxyPortOf exist on main; keeps the two PRs orthogonal | S:85 R:85 A:85 D:85 |
| 5 | Confident | Scope the proxy to a present-guest partition only; dashboard stays direct | Spike confirmed per-partition scoping; avoids looping the daemon's own `/api`+`/ws` through SSH | S:85 R:80 A:85 D:85 |
| 6 | Confident | Native engine + rk-remote SSH only for v1; everything else falls back to `/proxy` (no regression) | Only the rk-remote path has an SSH tunnel to extend; iframe can't scope a proxy | S:85 R:85 A:85 D:85 |

6 assumptions (2 certain, 4 confident, 0 tentative, 0 unresolved).
