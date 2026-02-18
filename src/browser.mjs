import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";

const ROOT = process.cwd();
const PROFILE_DIR = path.resolve(ROOT, ".browser-data");
const BILLING_URL = "https://cursor.com/dashboard?tab=billing";

export async function launchBrowser({ headed = false } = {}) {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: !headed,
    acceptDownloads: true,
    viewport: { width: 1440, height: 960 },
  });
  const page = context.pages()[0] || (await context.newPage());
  return { context, page };
}

export async function needsLogin(page) {
  await page.goto(BILLING_URL, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

  const url = page.url().toLowerCase();
  if (url.includes("/login") || url.includes("/auth")) {
    return true;
  }

  const loginText = page
    .locator("text=/continue with google|sign in|log in/i")
    .first();
  return loginText.isVisible().catch(() => false);
}

export function bringToFront() {
  try {
    execFileSync(
      "osascript",
      ["-e", 'tell application "Chromium" to activate'],
      { stdio: "ignore" },
    );
  } catch {
    // Ignore — may not work on all setups
  }
}

export async function waitForLogin(page, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = page.url().toLowerCase();
    const onBilling =
      url.includes("cursor.com/dashboard") && !url.includes("/login");

    if (onBilling) {
      const loginText = page
        .locator("text=/continue with google|sign in|log in/i")
        .first();
      const visible = await loginText.isVisible().catch(() => false);
      if (!visible) return true;
    }

    await page.waitForTimeout(1500);
  }
  return false;
}
