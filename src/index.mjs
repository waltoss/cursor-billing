import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { launchBrowser, needsLogin, bringToFront, waitForLogin, notify } from "./browser.mjs";
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
  let headed = HEADED;
  console.log(`Launching browser (${headed ? "headed" : "headless"} mode)...`);
  let { context, page } = await launchBrowser({ headed });

  try {
    let loginRequired = await needsLogin(page);

    if (loginRequired && !headed) {
      console.log("Login required — notifying and reopening in visible browser...");
      notify("Cursor Billing", "You need to relogin to Cursor");
      await context.close();
      headed = true;
      ({ context, page } = await launchBrowser({ headed: true }));
      loginRequired = await needsLogin(page);
    }

    if (loginRequired) {
      bringToFront();
      console.log("Please complete login in the browser window (waiting up to 10 minutes)...");
      const loggedIn = await waitForLogin(page, 600_000);

      if (!loggedIn) {
        throw new Error("Timed out waiting for login. Please try again.");
      }

      console.log("Login successful! Reopening headless to continue...");
      await context.close();
      headed = HEADED;
      ({ context, page } = await launchBrowser({ headed }));

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
