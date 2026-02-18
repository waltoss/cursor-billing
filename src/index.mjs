import { launchBrowser, needsLogin, bringToFront, waitForLogin } from "./browser.mjs";
import { downloadLatestInvoice } from "./invoice.mjs";
import { sendEmail } from "./email.mjs";

const HEADED = process.argv.includes("--login");

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

    console.log("Downloading latest invoice...");
    const pdfPath = await downloadLatestInvoice(context, page);
    console.log(`Invoice saved to: ${pdfPath}`);

    await sendEmail(pdfPath);
    console.log("Done!");
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
