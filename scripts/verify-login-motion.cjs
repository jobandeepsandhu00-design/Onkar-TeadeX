// Run against the isolated Vite preview with the placeholder Supabase URL:
// VITE_SUPABASE_URL=http://127.0.0.1:5188/preview-supabase
// VITE_SUPABASE_PUBLISHABLE_KEY=preview-only-not-real
// node scripts/verify-login-motion.cjs
// Resolve Playwright through NODE_PATH if using the bundled browser runtime.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const origin = process.env.LOGIN_PREVIEW_URL || "http://127.0.0.1:5188";
const url = new URL(origin);
assert.equal(
  url.hostname,
  "127.0.0.1",
  "UI verification must use isolated localhost",
);
const output =
  process.env.LOGIN_SCREENSHOT_DIR ||
  path.resolve(__dirname, "../tmp/login-motion");
fs.mkdirSync(output, { recursive: true });
const uid = "11111111-1111-4111-8111-111111111111";
const user = {
  id: uid,
  email: "preview@example.test",
  role: "authenticated",
  aud: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const jwtPart = (value) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const accessToken = `${jwtPart({ alg: "HS256", typ: "JWT" })}.${jwtPart({ sub: uid, exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" })}.preview-only`;

async function isolatedPage(browser, options = {}, initScript) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...options,
  });
  if (initScript) await context.addInitScript(initScript);
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  const state = { success: false };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    if (target.origin !== origin) return route.abort();
    if (target.pathname.startsWith("/preview-supabase/")) {
      requests.push({
        path: target.pathname,
        method: request.method(),
        body: request.postDataJSON(),
      });
      if (target.pathname.endsWith("/token")) {
        if (!state.success)
          return route.fulfill({
            status: 400,
            json: {
              code: "invalid_credentials",
              msg: "Invalid login credentials",
            },
          });
        return route.fulfill({
          json: {
            access_token: accessToken,
            refresh_token: "synthetic-refresh-token",
            token_type: "bearer",
            expires_in: 3600,
            user,
          },
        });
      }
      if (target.pathname.endsWith("/signup"))
        return route.fulfill({
          status: 400,
          json: { code: "email_exists", msg: "Preview signup response" },
        });
      if (target.pathname.endsWith("/recover"))
        return route.fulfill({ json: {} });
      if (target.pathname.endsWith("/user"))
        return route.fulfill({ json: user });
      if (target.pathname.includes("/rest/v1/app_state"))
        return route.fulfill({ json: null });
      return route.fulfill({ json: [] });
    }
    if (target.pathname.startsWith("/api/"))
      return route.fulfill({
        status: 503,
        json: {
          error: "Isolated UI preview: trading services are unavailable.",
        },
      });
    return route.continue();
  });
  await page.goto(origin);
  await page.getByRole("heading", { name: "Welcome back." }).waitFor();
  // Allow the single page-load sequence to settle before visual checks.
  await page.waitForTimeout(1100);
  return { context, page, requests, errors, state };
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    channel: process.env.LOGIN_BROWSER_CHANNEL || undefined,
  });
  const results = {};
  try {
    const desktop = await isolatedPage(browser, {}, () => {
      window.loginCanvasPaints = 0;
      const clearRect = CanvasRenderingContext2D.prototype.clearRect;
      CanvasRenderingContext2D.prototype.clearRect = function (...args) {
        window.loginCanvasPaints++;
        return clearRect.apply(this, args);
      };
    });
    const { page, requests } = desktop;
    await page.screenshot({
      path: path.join(output, "login-desktop.png"),
      fullPage: true,
    });
    results.performance = await page.evaluate(async () => {
      const paints = window.loginCanvasPaints;
      const frames = [];
      let previous = 0;
      await new Promise((resolve) => {
        const sample = (time) => {
          if (previous) frames.push(time - previous);
          previous = time;
          if (frames.length < 60) requestAnimationFrame(sample);
          else resolve();
        };
        requestAnimationFrame(sample);
      });
      const sorted = frames.toSorted((a, b) => a - b);
      return {
        medianFrameMs: Number(sorted[30].toFixed(2)),
        idleCanvasRepaints: window.loginCanvasPaints - paints,
        note: "Local headless-browser sample; real device performance varies.",
      };
    });
    assert.equal(results.performance.idleCanvasRepaints, 0);
    await page.getByRole("button", { name: "Log In", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Email and password are required." })
      .waitFor();
    assert.equal(
      await page.getByRole("alert").textContent(),
      "Email and password are required.",
    );
    await page
      .getByLabel("Email", { exact: true })
      .fill("PREVIEW@example.test");
    await page.getByLabel("Password", { exact: true }).fill("123");
    await page.getByRole("button", { name: "Log In", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Password must be at least 6 characters." })
      .waitFor();
    assert.equal(
      await page.getByRole("alert").textContent(),
      "Password must be at least 6 characters.",
    );
    assert.equal(requests.filter((r) => r.path.endsWith("/token")).length, 0);
    await page.getByLabel("Password", { exact: true }).fill("preview-password");
    await page.getByRole("button", { name: "Show password" }).click();
    assert.equal(
      await page.getByLabel("Password", { exact: true }).getAttribute("type"),
      "text",
    );
    await page.getByRole("button", { name: "Hide password" }).click();
    await page.getByLabel("Remember me").uncheck();
    await page.getByLabel("Password", { exact: true }).press("Enter");
    await page
      .getByRole("alert")
      .filter({ hasText: "Invalid login credentials" })
      .waitFor();
    assert.equal(
      requests.filter((r) => r.path.endsWith("/token")).length,
      1,
      "Enter must submit exactly once",
    );
    assert.equal(
      requests.find((r) => r.path.endsWith("/token")).body.email,
      "preview@example.test",
    );
    assert.equal(
      await page.evaluate(() =>
        localStorage.getItem("tradex_auth_persistence"),
      ),
      "session",
    );
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await page
      .getByRole("status")
      .filter({ hasText: "Password reset email sent" })
      .waitFor();
    assert.equal(requests.filter((r) => r.path.endsWith("/recover")).length, 1);
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    assert.equal(
      await page
        .getByLabel("Password", { exact: true })
        .getAttribute("autocomplete"),
      "new-password",
    );
    await page.getByRole("button", { name: "Sign Up", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "Preview signup response" })
      .waitFor();
    assert.equal(requests.filter((r) => r.path.endsWith("/signup")).length, 1);
    results.form =
      "Validation, one Enter submission, password visibility, remember-me storage, reset and signup calls pass (mock network).";

    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page.mouse.move(1430, 995);
    await page.waitForTimeout(650);
    const tilt = await page.locator(".otx-login").evaluate((root) => ({
      x: parseFloat(root.style.getPropertyValue("--login-tilt-x")),
      y: parseFloat(root.style.getPropertyValue("--login-tilt-y")),
    }));
    assert.ok(
      Math.abs(tilt.x) <= 3 && Math.abs(tilt.y) <= 3 && Math.abs(tilt.y) > 0.1,
    );
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        value: true,
        configurable: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.equal(
      await page.locator(".otx-login").getAttribute("data-motion-paused"),
      "true",
    );
    assert.equal(
      await page
        .locator(".otx-login-logo-float")
        .evaluate((el) => getComputedStyle(el).animationPlayState),
      "paused",
    );
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(100);
    assert.equal(
      await page
        .locator(".otx-login-logo-float")
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
    );
    assert.equal(
      await page
        .locator(".otx-login-card")
        .evaluate((el) => getComputedStyle(el).transform),
      "none",
    );
    results.motion =
      "Mouse tilt clamped to ±3°, hidden animations pause, dynamic reduced-motion setting removes movement.";

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 320, height: 568 },
      { width: 768, height: 1024 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      await page
        .getByRole("button", { name: "Log In", exact: true })
        .scrollIntoViewIfNeeded();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.equal(
        await page
          .getByLabel("Email", { exact: true })
          .evaluate((el) => getComputedStyle(el).fontSize),
        viewport.width < 768 ? "16px" : "14px",
      );
    }
    results.responsive =
      "390px phone, 320px phone, tablet and landscape: no horizontal overflow; controls remain reachable.";
    assert.deepEqual(desktop.errors, []);
    await desktop.context.close();

    const mobile = await isolatedPage(
      browser,
      { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
      () => {
        window.orientationPermissionRequests = 0;
        window.DeviceOrientationEvent ??= class extends Event {
          constructor(type, init) {
            super(type);
            this.beta = init.beta;
            this.gamma = init.gamma;
          }
        };
        DeviceOrientationEvent.requestPermission = async () => {
          window.orientationPermissionRequests++;
          return "granted";
        };
      },
    );
    assert.equal(
      await mobile.page.evaluate(() => window.orientationPermissionRequests),
      0,
    );
    await mobile.page.screenshot({
      path: path.join(output, "login-mobile.png"),
      fullPage: true,
    });
    await mobile.page
      .getByRole("button", { name: "Enable device tilt" })
      .click();
    assert.equal(
      await mobile.page.evaluate(() => window.orientationPermissionRequests),
      1,
    );
    await mobile.page.evaluate(() => {
      window.dispatchEvent(
        new DeviceOrientationEvent("deviceorientation", { beta: 30, gamma: 0 }),
      );
      window.dispatchEvent(
        new DeviceOrientationEvent("deviceorientation", {
          beta: 80,
          gamma: 80,
        }),
      );
    });
    await mobile.page.waitForTimeout(700);
    const gyro = await mobile.page.locator(".otx-login").evaluate((root) => ({
      x: parseFloat(root.style.getPropertyValue("--login-tilt-x")),
      y: parseFloat(root.style.getPropertyValue("--login-tilt-y")),
    }));
    assert.ok(
      Math.abs(gyro.x) <= 3 && Math.abs(gyro.y) <= 3 && Math.abs(gyro.y) > 0.1,
    );
    await mobile.page
      .getByRole("button", { name: "Disable device tilt" })
      .click();
    assert.equal(
      await mobile.page
        .locator(".otx-login")
        .evaluate((root) => root.style.getPropertyValue("--login-tilt-x")),
      "0.000deg",
    );
    results.gyroscope =
      "Explicit opt-in, neutral calibration, ±3° clamp and disable/reset pass with synthetic sensor events.";
    assert.deepEqual(mobile.errors, []);
    await mobile.context.close();

    const successful = await isolatedPage(browser);
    successful.state.success = true;
    await successful.page.evaluate(() => {
      window.loginTransitionObserved = false;
      new MutationObserver(() => {
        if (document.querySelector(".otx-login-arrival"))
          window.loginTransitionObserved = true;
      }).observe(document.body, { subtree: true, childList: true });
    });
    await successful.page
      .getByLabel("Email", { exact: true })
      .fill("preview@example.test");
    await successful.page
      .getByLabel("Password", { exact: true })
      .fill("preview-password");
    await successful.page
      .getByRole("button", { name: "Log In", exact: true })
      .click();
    await successful.page.waitForFunction(() => window.loginTransitionObserved);
    await successful.page.waitForFunction(
      () => !document.querySelector(".otx-login-arrival"),
    );
    assert.equal(await successful.page.locator(".otx-login").count(), 0);
    assert.equal(
      await successful.page.evaluate(() =>
        localStorage.getItem("tradex_remembered_email"),
      ),
      "preview@example.test",
    );
    assert.equal(
      successful.requests.filter((r) => r.path.endsWith("/token")).length,
      1,
    );
    results.success =
      "Existing SIGNED_IN event mounts the dashboard, shows a short transition, then removes it; remembered email preserved (mock session).";
    assert.deepEqual(successful.errors, []);
    await successful.context.close();

    console.log(
      JSON.stringify(
        {
          passed: true,
          verification: results,
          screenshots: output,
          liveAuthenticationAttempted: false,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
