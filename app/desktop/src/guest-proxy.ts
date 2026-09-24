/**
 * Present-guest SOCKS proxy plan (electron-free, unit-tested).
 *
 * For an `rk remote` (SSH-only) host, the shell routes present-guest views
 * through the host's SOCKS-over-SSH forward (the tunnel's `-D`, on the derived
 * port localPort + SOCKS_PORT_OFFSET — this MIRRORS the backend
 * `internal/remote/ports.go` `SocksPort`). The guest then loads the remote dev
 * app at its REAL loopback origin (`http://localhost:{port}`) instead of the
 * `/proxy/{port}` path prefix, so a full SPA's client-side routing and
 * root-absolute assets work.
 *
 * Scoping (Option A — correct for the shell's many-windows-many-hosts model):
 * each rk-remote host gets its OWN guest partition, so its SOCKS proxy never
 * leaks to another host's guests. Every non-rk-remote host (and any non-`/proxy`
 * guest, e.g. a presented file or an external URL) keeps the shared, DIRECT
 * partition and an unchanged URL — byte-identical to today.
 */

/** The shared, direct guest partition (today's single guest profile). */
export const SHARED_GUEST_PARTITION = "persist:rk-web";

// Mirror backend internal/remote/ports.go: socksPort = localPort + 100, and the
// -L local range is 3100–3199 (so an rk-remote local origin lands there).
const SOCKS_PORT_OFFSET = 100;
const LOCAL_PORT_MIN = 3100;
const LOCAL_PORT_MAX = 3199;

export interface GuestHost {
  /** Stable host id (hosts.json). */
  id: string;
  /** The host's local origin, e.g. "http://127.0.0.1:3110". */
  url: string;
  /** The `rk remote` name — set ONLY for SSH-tunnel hosts. */
  remote?: string;
}

export interface GuestProxyPlan {
  /** Electron session partition for the guest. */
  partition: string;
  /** Proxy rules for that partition ("socks5://127.0.0.1:{socks}"), or null = direct. */
  socksProxyRules: string | null;
  /** The URL to load — rewritten to the real origin under SOCKS, else unchanged. */
  loadUrl: string;
}

/** The local (-L) port of a 127.0.0.1/localhost origin, or null. */
function localOriginPort(url: string): number | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return null;
    const p = Number(u.port);
    return Number.isInteger(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/** Extract {port, rest} from a `/proxy/{port}{/rest}` URL (relative, or absolute
 *  to the host origin — the two shapes the native engine produces). */
function proxyTile(url: string): { port: number; rest: string } | null {
  let path = url;
  try {
    if (/^https?:\/\//i.test(url)) {
      const u = new URL(url);
      path = u.pathname + u.search + u.hash; // keep the hash (relative form already does)
    }
  } catch {
    // keep the raw string
  }
  const m = path.match(/^\/proxy\/(\d+)(\/.*)?$/);
  if (!m) return null;
  const port = Number(m[1]);
  if (port < 1 || port > 65535) return null; // not a valid tile port → leave unchanged
  return { port, rest: m[2] && m[2] !== "" ? m[2] : "/" };
}

/** Decide the guest partition + proxy + load URL for a host and a requested URL. */
export function guestProxyPlan(host: GuestHost, url: string): GuestProxyPlan {
  const direct: GuestProxyPlan = { partition: SHARED_GUEST_PARTITION, socksProxyRules: null, loadUrl: url };

  const localPort = localOriginPort(host.url);
  const isRemote =
    !!host.remote && localPort !== null && localPort >= LOCAL_PORT_MIN && localPort <= LOCAL_PORT_MAX;
  if (!isRemote) return direct;

  // Only a loopback dev-server (`/proxy/{port}`) tile gets the SOCKS real-origin
  // treatment; a presented file / external URL rides the shared direct partition.
  const tile = proxyTile(url);
  if (!tile) return direct;

  const socksPort = (localPort as number) + SOCKS_PORT_OFFSET;
  return {
    partition: `persist:rk-web-socks-${host.id}`,
    socksProxyRules: `socks5://127.0.0.1:${socksPort}`,
    loadUrl: `http://localhost:${tile.port}${tile.rest}`,
  };
}
