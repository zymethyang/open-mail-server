import { HttpError } from "../../httpError/index.js";

function statusCodeOf(error: unknown): number {
  if (error instanceof HttpError) {
    return error.statusCode;
  }
  if (error && typeof error === "object" && "statusCode" in error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    return typeof statusCode === "number" ? statusCode : 0;
  }
  return 0;
}

function missingMailboxMessage(message: string): string {
  const oneMailbox = /^Mailbox (\S+) does not exist$/.exec(message);
  if (oneMailbox) {
    return `${oneMailbox[1]} is not a mailbox on this server. Check the address and try again.`;
  }
  const manyMailboxes = /^Mailboxes (.+) do not exist$/.exec(message);
  if (manyMailboxes) {
    return `These addresses are not mailboxes on this server: ${manyMailboxes[1]}. Check the addresses and try again.`;
  }
  return "";
}

function invalidAddressMessage(message: string): string {
  const labeled = /^(?:To|Cc|Bcc) has an invalid address: (\S+)$/.exec(message);
  const plain = /^Invalid address: (\S+)$/.exec(message);
  const address = labeled?.[1] || plain?.[1] || "";
  return address ? `${address} is not a valid email address.` : "";
}

function friendlySendMessage(message: string): string {
  const missingMailbox = missingMailboxMessage(message);
  if (missingMailbox) {
    return missingMailbox;
  }
  const invalidAddress = invalidAddressMessage(message);
  if (invalidAddress) {
    return invalidAddress;
  }
  if (message === "To is required" || message === "No recipients") {
    return "Enter at least one recipient.";
  }
  if (message === "Empty message") {
    return "The message was empty and was not sent.";
  }
  if (message === "Relay denied") {
    return "This server only delivers mail to its own mailboxes unless you are signed in.";
  }
  if (message === "Sender must match the signed-in mailbox") {
    return "You can only send from your own mailbox.";
  }
  if (message === "This server has no company domain yet") {
    return "This server is not ready to send mail yet.";
  }
  if (message === "Attachments are too large" || message === "Request is too large") {
    return "This message is too large to send.";
  }
  if (message === "Attachment is invalid") {
    return "One attachment could not be read. Remove it and try again.";
  }
  return "The message could not be sent. Check the addresses and try again.";
}

export function messageSendError(error: unknown): { statusCode: number; message: string } | null {
  const statusCode = statusCodeOf(error);
  if (statusCode !== 400 && statusCode !== 413 && statusCode !== 450 && statusCode !== 550) {
    return null;
  }
  const message = error instanceof Error ? error.message : "";
  if (statusCode === 413) {
    return { statusCode: 413, message: friendlySendMessage(message) };
  }
  return { statusCode: 400, message: friendlySendMessage(message) };
}
