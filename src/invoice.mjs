import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const DOWNLOAD_DIR = path.resolve(ROOT, "invoices");

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim();
}

function filenameFromContentDisposition(header) {
  if (!header) return null;

  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8Match) {
    try {
      return sanitizeFilename(decodeURIComponent(utf8Match[1]));
    } catch {
      return sanitizeFilename(utf8Match[1]);
    }
  }

  const fallback = /filename="?([^"]+)"?/i.exec(header);
  return fallback ? sanitizeFilename(fallback[1]) : null;
}

function filenameFromUrl(urlString) {
  try {
    const base = path.basename(new URL(urlString).pathname) || `invoice-${Date.now()}`;
    return sanitizeFilename(base.endsWith(".pdf") ? base : `${base}.pdf`);
  } catch {
    return `invoice-${Date.now()}.pdf`;
  }
}

function isPdf(headers, body) {
  const ct = (headers["content-type"] || "").toLowerCase();
  if (ct.includes("application/pdf")) return true;
  return body.subarray(0, 4).toString("utf8") === "%PDF";
}

async function collectInvoiceAnchors(page) {
  const candidates = await page.$$eval("a[href]", (anchors) => {
    const re = /(invoice|receipt|billing|download|pdf)/i;
    return anchors
      .map((a) => ({
        href: a.getAttribute("href") || "",
        text: (a.textContent || "").trim(),
        aria: a.getAttribute("aria-label") || "",
      }))
      .filter((item) => re.test(`${item.href} ${item.text} ${item.aria}`));
  });

  const seen = new Set();
  const urls = [];
  for (const c of candidates) {
    try {
      const abs = new URL(c.href, page.url()).toString();
      if (!seen.has(abs)) {
        seen.add(abs);
        urls.push(abs);
      }
    } catch {
      // skip malformed
    }
  }
  return urls;
}

async function tryDownloadFromAnchors(context, urls) {
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
  let downloaded = null;

  for (const url of urls) {
    try {
      const response = await context.request.get(url, { timeout: 30_000 });
      if (!response.ok()) continue;

      const headers = response.headers();
      const body = await response.body();
      if (!isPdf(headers, body)) continue;

      const filename =
        filenameFromContentDisposition(headers["content-disposition"]) ||
        filenameFromUrl(url);
      const targetPath = path.join(DOWNLOAD_DIR, filename);

      if (existsSync(targetPath)) {
        console.log(`Already exists: ${filename}`);
        downloaded = targetPath;
        break;
      }

      await fs.writeFile(targetPath, body);
      console.log(`Downloaded: ${filename}`);
      downloaded = targetPath;
      break; // We only need the latest invoice
    } catch {
      // try next
    }
  }

  return downloaded;
}

async function tryDownloadFromButtons(page) {
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });

  const buttonLocator = page.locator(
    'button:has-text("Download"), [role="button"]:has-text("Download"), button:has-text("Invoice")',
  );
  const count = await buttonLocator.count();

  for (let i = 0; i < count; i++) {
    const button = buttonLocator.nth(i);
    const visible = await button.isVisible().catch(() => false);
    if (!visible) continue;

    try {
      await button.scrollIntoViewIfNeeded();
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 7000 }),
        button.click({ timeout: 5000 }),
      ]);

      let suggested = sanitizeFilename(
        download.suggestedFilename() || `invoice-${Date.now()}.pdf`,
      );
      if (!suggested.endsWith(".pdf")) suggested += ".pdf";
      const targetPath = path.join(DOWNLOAD_DIR, suggested);

      if (existsSync(targetPath)) {
        console.log(`Already exists: ${suggested}`);
        return targetPath;
      }

      await download.saveAs(targetPath);
      console.log(`Downloaded: ${suggested}`);
      return targetPath;
    } catch {
      // try next button
    }
  }

  return null;
}

async function tryPrintPageAsPdf(page) {
  await fs.mkdir(DOWNLOAD_DIR, { recursive: true });
  const filename = `cursor-invoice-${Date.now()}.pdf`;
  const targetPath = path.join(DOWNLOAD_DIR, filename);
  await page.pdf({ path: targetPath, format: "A4" });
  console.log(`Saved page as PDF: ${filename}`);
  return targetPath;
}

export async function downloadLatestInvoice(context, page) {
  // Strategy 1: Find invoice anchor links and fetch the PDF directly
  const anchorUrls = await collectInvoiceAnchors(page);
  console.log(`Found ${anchorUrls.length} invoice-related link(s)`);

  if (anchorUrls.length > 0) {
    const result = await tryDownloadFromAnchors(context, anchorUrls);
    if (result) return result;

    // Fallback: follow first link and look for download buttons on Stripe page
    for (const url of anchorUrls) {
      try {
        const stripePage = await context.newPage();
        await stripePage.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await stripePage.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});

        const result = await tryDownloadFromButtons(stripePage);
        await stripePage.close();
        if (result) return result;
      } catch {
        // try next
      }
    }
  }

  // Strategy 2: Look for download buttons on the billing page itself
  const fromButtons = await tryDownloadFromButtons(page);
  if (fromButtons) return fromButtons;

  // Strategy 3: Last resort — print the billing page as PDF
  console.log("No downloadable invoice found, printing billing page as PDF...");
  return tryPrintPageAsPdf(page);
}
