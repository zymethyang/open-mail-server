import { parseRawMessage } from "../../mime/index.js";

const dangerousExtensions = new Set(["exe", "scr", "com", "bat", "cmd", "js", "vbs", "msi", "jar", "ps1", "dll", "hta", "vbe", "jse", "wsf"]);
const testVirusSignature = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

function extensionOf(fileName: string): string {
  const separator = fileName.lastIndexOf(".");
  return separator === -1 ? "" : fileName.slice(separator + 1).toLowerCase();
}

export function inspectMessageContent(message: Buffer): string {
  if (message.includes(testVirusSignature)) {
    return "The message content was rejected";
  }
  let parsed: ReturnType<typeof parseRawMessage>;
  try {
    parsed = parseRawMessage(message);
  } catch {
    return "";
  }
  const pieces = [parsed.text, parsed.html];
  for (const attachment of parsed.attachments) {
    pieces.push(Buffer.from(attachment.contentEncoded || "", "base64").toString("utf8"));
    if (dangerousExtensions.has(extensionOf(attachment.fileName || ""))) {
      return "The message content was rejected";
    }
  }
  if (pieces.some((piece) => piece.includes(testVirusSignature))) {
    return "The message content was rejected";
  }
  return "";
}
