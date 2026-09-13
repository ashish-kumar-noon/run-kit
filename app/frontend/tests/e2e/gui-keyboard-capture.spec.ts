import { test, expect, type Page } from "@playwright/test";
import { READY_TIMEOUT, openPalette } from "./_ready";
import { GUI_ON_ICEWM, mockGuiBackend } from "./_gui-mock";

// GUI keyboard capture e2e (the gui chord gate's capture mode). UNGATED,
// fully mocked (no tmux, no Xvnc): the shared `_gui-mock.ts` scaffolding
// carries a reachable icewm `gui` slot and holds `/ws/gui/` open without an
// RFB handshake. The RFB object IS constructed against the patched socket,
// but noVNC's Keyboard.grab() — which attaches its stopEvent keydown handler
// to the canvas — runs only at the server-init handshake the mock never
// reaches. The spec's canvas probe therefore replicates grab's one observable
// effect (preventDefault on keydown) alongside its recording, so rk's
// window-level dispatcher (which skips defaultPrevented events) behaves
// exactly as it does against a live RFB. The routing under test: a RECLAIMED
// chord is stopped at the canvas wrapper's CAPTURE phase (the canvas never
// sees it; the palette opens via the synthetic re-dispatch); a CAPTURED chord
// descends to the canvas (the probe records it), is preventDefaulted there,
// and never fires an rk action. The sessions payload's `@2` window persists
// `layout: "split-h:tty,gui"`, so the gui tile stays open across the reload
// the persistence case needs. localStorage is per-context and fresh per test
// — every case starts released.

/** The gui canvas wrapper + the noVNC canvas inside it. */
const canvasWrap = (page: Page) => page.getByTestId("gui-surface-canvas");
const novncCanvas = (page: Page) =>
  page.locator('[data-testid="gui-novnc-host"] canvas');

/** Give the gui tile both focus layers: the wrapper click sets the tile's
 *  focus slot (the guiOnly chord handlers mount on it), and the explicit
 *  canvas focus makes the noVNC canvas the keydown TARGET — in the mocked
 *  rig the canvas has no live framebuffer size, so a bare click can land on
 *  the wrapper and leave DOM focus elsewhere. Only a canvas-targeted keydown
 *  exercises the real path: the wrapper's capture-phase gate first, then
 *  noVNC's stopEvent (which keeps the raw event from rk's window-level
 *  dispatcher). */
async function focusCanvas(page: Page): Promise<void> {
  await canvasWrap(page).click();
  await novncCanvas(page).focus();
}

/** Record every keydown that reaches the noVNC canvas (the guest's door).
 *  Attached AFTER the wrapper's capture-phase gate, so a reclaimed chord
 *  never lands here; a captured one does. The preventDefault replicates the
 *  effect of noVNC's grabbed Keyboard handler (never attached in the mock —
 *  see the file header), keeping the raw event from rk's window-level
 *  dispatcher exactly as a live RFB does. */
function installKeyProbe(page: Page): Promise<void> {
  return page.evaluate(() => {
    const w = window as unknown as { __guiKeys: string[] };
    w.__guiKeys = [];
    document
      .querySelector('[data-testid="gui-novnc-host"] canvas')
      ?.addEventListener("keydown", (e) => {
        w.__guiKeys.push((e as KeyboardEvent).key);
        e.preventDefault();
      });
  });
}

function probedKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __guiKeys: string[] }).__guiKeys);
}

/** The palette's closed state, after a settle beat — the assertion for "rk
 *  did not fire on the captured chord". */
async function expectPaletteClosed(page: Page): Promise<void> {
  await page.waitForTimeout(300);
  await expect(page.getByPlaceholder("Type a command")).toHaveCount(0);
}

test.describe("gui keyboard capture — mocked signal, desktop (1280px)", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  /**
   * Proves: with capture off, the palette chord reclaims through the gui
   * canvas gate (the palette opens, the canvas never sees the key); latching
   * capture via the pinned header icon hands every chord to the guest (the
   * palette stays CLOSED on Ctrl+K and the keydown reaches the noVNC canvas);
   * and the release chord (Ctrl+Shift+G) is the one chord the gate still
   * reclaims, restoring the off behavior.
   *
   * Steps:
   * 1. Mock the reachable icewm backend; open @2 (the gui tile is up); click
   *    the canvas to focus the tile and install the canvas key probe.
   * 2. Press Control+K; assert the palette opens and the probe stayed empty.
   *    Escape closes the palette.
   * 3. Click the pinned `gui-capture-toggle` verb; assert the meta chip reads
   *    `keys → desktop` and the verb is aria-pressed.
   * 4. Refocus the canvas; press Control+K; assert the palette stays closed
   *    and the probe recorded `k`.
   * 5. Press Control+Shift+G; assert the chip returns to `icewm-session ·
   *    :10`; press Control+K; assert the palette opens again.
   */
  test("the gate hands every chord to the guest while latched; the release chord releases", async ({
    page,
  }) => {
    await mockGuiBackend(page, GUI_ON_ICEWM);
    await page.goto("/default/2");
    await expect(canvasWrap(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(novncCanvas(page)).toBeAttached();
    const paletteInput = page.getByPlaceholder("Type a command");

    await focusCanvas(page);
    await installKeyProbe(page);
    await page.keyboard.press("Control+KeyK");
    await expect(paletteInput).toBeVisible();
    // The chord is reclaimed — the canvas never sees the `k`; the bare
    // modifier-down DOES pass through (no binding matches ControlLeft alone),
    // exactly as a live guest receives it.
    expect(await probedKeys(page)).not.toContain("k");
    await page.keyboard.press("Escape");
    await expect(paletteInput).toHaveCount(0);

    const verb = page.getByTestId("gui-capture-toggle");
    await verb.click();
    await expect(page.getByText("keys → desktop")).toBeVisible();
    await expect(verb).toHaveAttribute("aria-pressed", "true");

    await focusCanvas(page);
    await page.keyboard.press("Control+KeyK");
    await expectPaletteClosed(page);
    expect(await probedKeys(page)).toContain("k");

    await page.keyboard.press("Control+Shift+KeyG");
    await expect(page.getByText("icewm-session · :10")).toBeVisible();
    await novncCanvas(page).focus();
    await page.keyboard.press("Control+KeyK");
    await expect(paletteInput).toBeVisible();
  });

  /**
   * Proves: the palette row (`GUI: Capture keyboard`, the third activation
   * path) latches capture; the latch persists across a full page reload (the
   * `rk-gui-capture` posture); and clicking the pinned icon releases a
   * reloaded latch — the mouse is never captured, so the icon is the escape
   * hatch that cannot fail.
   *
   * Steps:
   * 1. Mock the reachable icewm backend; open @2; open the palette, filter to
   *    the capture row, and select it; assert the chip reads `keys →
   *    desktop` and `rk-gui-capture` is "1".
   * 2. Reload; assert the tile is back (persisted layout), the chip still
   *    reads `keys → desktop`, and a canvas-focused Control+K stays captured
   *    (palette closed, the canvas probe records `k`).
   * 3. Click the pinned verb; assert the chip returns to `icewm-session ·
   *    :10` and the posture key is removed.
   */
  test("the palette row latches, the latch survives a reload, and the icon releases", async ({
    page,
  }) => {
    await mockGuiBackend(page, GUI_ON_ICEWM);
    await page.goto("/default/2");
    await expect(canvasWrap(page)).toBeVisible({ timeout: READY_TIMEOUT });

    const paletteInput = await openPalette(page);
    await paletteInput.fill("capture keyboard");
    const row = page.getByRole("option", { name: /GUI: Capture keyboard/ });
    await expect(row).toBeVisible();
    await row.click();
    await expect(page.getByText("keys → desktop")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("rk-gui-capture")))
      .toBe("1");

    await page.reload();
    await expect(canvasWrap(page)).toBeVisible({ timeout: READY_TIMEOUT });
    await expect(novncCanvas(page)).toBeAttached();
    await expect(page.getByText("keys → desktop")).toBeVisible();

    await focusCanvas(page);
    await installKeyProbe(page);
    await page.keyboard.press("Control+KeyK");
    await expectPaletteClosed(page);
    expect(await probedKeys(page)).toContain("k");

    await page.getByTestId("gui-capture-toggle").click();
    await expect(page.getByText("icewm-session · :10")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("rk-gui-capture")))
      .toBeNull();
  });
});
