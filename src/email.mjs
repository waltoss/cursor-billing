import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const RECIPIENT = "thomas.walter@theodo.com";

function getInvoiceSubject() {
  const now = new Date();
  const month = now.toLocaleString("en-US", { month: "long", year: "numeric" });
  return `Cursor Invoice - ${month}`;
}

export async function sendEmail(pdfPath) {
  const absolutePath = path.resolve(pdfPath);
  const subject = getInvoiceSubject();
  const body = `Please find attached the latest Cursor billing invoice.`;

  const script = `
    tell application "Mail"
      set newMessage to make new outgoing message with properties ¬
        {subject:"${subject}", content:"${body}", visible:false}
      tell newMessage
        make new to recipient at end of to recipients ¬
          with properties {address:"${RECIPIENT}"}
        make new attachment with properties ¬
          {file name:POSIX file "${absolutePath}"}
      end tell
      send newMessage
    end tell
  `;

  console.log(`Sending email to ${RECIPIENT}...`);
  await execFileAsync("osascript", ["-e", script]);
  console.log(`Email sent: "${subject}"`);
}
