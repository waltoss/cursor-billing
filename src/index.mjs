import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { launchBrowser, needsLogin, bringToFront, waitForLogin } from "./browser.mjs";
import { downloadAllInvoices } from "./invoice.mjs";
import { sendEmail } from "./email.mjs";

const HEADED = process.argv.includes("--login");
const SENT_LOG = path.resolve(process.cwd(), "invoices", ".sent.json");

async function loadSentInvoices() {
  if (!existsSync(SENT_LOG)) return new Set();
  const data = JSON.parse(await fs.readFile(SENT_LOG, "utf8"));
  return new Set(data);
}

async function markAsSent(sentSet, filename) {
  sentSet.add(filename);
  await fs.writeFile(SENT_LOG, JSON.stringify([...sentSet], null, 2));
}

async function main() {
  console.log(`Launching browser (${HEADED ? "headed" : "headless"} mode)...`);
  const { context, page } = await launchBrowser({ headed: HEADED });

  try {
    const loginRequired = await needsLogin(page);

    if (loginRequired && !HEADED) {
      throw new Error(
        "Login required. Run `npm run login` first to complete Google OAuth in a visible browser.",
      );
    }

    if (loginRequired && HEADED) {
      bringToFront();
      console.log("Please complete login in the browser window (waiting up to 2 minutes)...");
      const loggedIn = await waitForLogin(page, 120_000);

      if (!loggedIn) {
        throw new Error("Timed out waiting for login. Please try again.");
      }

      console.log("Login successful!");

      // Re-navigate to billing page after login
      const stillNeedsLogin = await needsLogin(page);
      if (stillNeedsLogin) {
        throw new Error("Still not logged in after authentication. Please retry.");
      }
    }

    console.log("Downloading invoices...");
    const pdfPaths = await downloadAllInvoices(context, page);
    console.log(`Found ${pdfPaths.length} invoice(s)`);

    const sentSet = await loadSentInvoices();
    let newCount = 0;

    for (const pdfPath of pdfPaths) {
      const filename = path.basename(pdfPath);
      if (sentSet.has(filename)) {
        console.log(`Already sent: ${filename}`);
        continue;
      }

      await sendEmail(pdfPath);
      await markAsSent(sentSet, filename);
      newCount++;
    }

    if (newCount === 0) {
      console.log("No new invoices to send.");
    } else {
      console.log(`Done! Sent ${newCount} new invoice(s).`);
    }
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
