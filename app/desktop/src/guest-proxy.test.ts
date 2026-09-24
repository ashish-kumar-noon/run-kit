/**
 * node:test suite for the present-guest SOCKS proxy plan (run via
 * `pnpm run test` after compile — the `views.test.ts` convention).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { guestProxyPlan, SHARED_GUEST_PARTITION } from "./guest-proxy";

const remoteHost = { id: "h1", url: "http://127.0.0.1:3110", remote: "buildbox" };
const localHost = { id: "h2", url: "http://127.0.0.1:3000" }; // local daemon, not a remote
const tailscaleHost = { id: "h3", url: "https://dev-ws.tail1.ts.net" };

test("rk-remote host + /proxy tile → per-host SOCKS partition, real-origin load", () => {
  const plan = guestProxyPlan(remoteHost, "http://127.0.0.1:3110/proxy/4300/editor");
  assert.equal(plan.partition, "persist:rk-web-socks-h1"); // per-host (Option A)
  assert.equal(plan.socksProxyRules, "socks5://127.0.0.1:3210"); // 3110 + 100
  assert.equal(plan.loadUrl, "http://localhost:4300/editor"); // real origin, no /proxy
});

test("relative /proxy URL is rewritten the same way", () => {
  const plan = guestProxyPlan(remoteHost, "/proxy/4300/");
  assert.equal(plan.loadUrl, "http://localhost:4300/");
  assert.equal(plan.socksProxyRules, "socks5://127.0.0.1:3210");
});

test("two rk-remote hosts get DISTINCT partitions (no cross-host proxy leak)", () => {
  const a = guestProxyPlan({ id: "hA", url: "http://127.0.0.1:3110", remote: "a" }, "/proxy/4300/");
  const b = guestProxyPlan({ id: "hB", url: "http://127.0.0.1:3111", remote: "b" }, "/proxy/4300/");
  assert.notEqual(a.partition, b.partition);
  assert.equal(a.socksProxyRules, "socks5://127.0.0.1:3210");
  assert.equal(b.socksProxyRules, "socks5://127.0.0.1:3211");
});

test("non-remote (local daemon) host → shared direct partition, URL unchanged", () => {
  const url = "http://127.0.0.1:3000/proxy/4300/";
  const plan = guestProxyPlan(localHost, url);
  assert.equal(plan.partition, SHARED_GUEST_PARTITION);
  assert.equal(plan.socksProxyRules, null);
  assert.equal(plan.loadUrl, url);
});

test("tailscale-direct host → shared direct partition (no SSH tunnel to ride)", () => {
  const url = "/proxy/4300/";
  const plan = guestProxyPlan(tailscaleHost, url);
  assert.equal(plan.partition, SHARED_GUEST_PARTITION);
  assert.equal(plan.socksProxyRules, null);
  assert.equal(plan.loadUrl, url);
});

test("rk-remote host + non-/proxy guest (presented file, external) → direct, unchanged", () => {
  for (const url of ["/present/buildbox/abc123/report.html?v=1", "https://example.com/"]) {
    const plan = guestProxyPlan(remoteHost, url);
    assert.equal(plan.partition, SHARED_GUEST_PARTITION);
    assert.equal(plan.socksProxyRules, null);
    assert.equal(plan.loadUrl, url);
  }
});

test("remote-flagged host whose url port is OUTSIDE 3100-3199 → direct, unchanged", () => {
  const outOfRange = { id: "hx", url: "http://127.0.0.1:8080", remote: "weird" };
  const plan = guestProxyPlan(outOfRange, "/proxy/4300/");
  assert.equal(plan.partition, SHARED_GUEST_PARTITION);
  assert.equal(plan.socksProxyRules, null);
  assert.equal(plan.loadUrl, "/proxy/4300/");
});

test("malformed host url → direct, unchanged (never throws)", () => {
  const bad = { id: "hy", url: "not a url", remote: "x" };
  const plan = guestProxyPlan(bad, "/proxy/4300/");
  assert.equal(plan.partition, SHARED_GUEST_PARTITION);
  assert.equal(plan.socksProxyRules, null);
});

test("absolute /proxy URL with query + hash → rewritten to real origin, query+hash kept", () => {
  const plan = guestProxyPlan(remoteHost, "http://127.0.0.1:3110/proxy/4300/editor?tab=2#frag");
  assert.equal(plan.loadUrl, "http://localhost:4300/editor?tab=2#frag");
  assert.equal(plan.socksProxyRules, "socks5://127.0.0.1:3210");
});

test("bogus tile port (out of range) in a /proxy URL → not rewritten (leaves direct)", () => {
  const plan = guestProxyPlan(remoteHost, "/proxy/999999/");
  assert.equal(plan.partition, SHARED_GUEST_PARTITION);
  assert.equal(plan.loadUrl, "/proxy/999999/");
});
