import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpError } from "../../../src/components/httpError/index.js";
import { messageSendError } from "../../../src/components/web/utils/messageSendError.js";

function deliveryFailure(message: string, statusCode = 550): Error {
  return Object.assign(new Error(message), { statusCode });
}

describe("message send errors", () => {
  it("turns delivery failures into one clear message", () => {
    const missing = messageSendError(deliveryFailure("Mailbox admin@acme.com does not exist"));
    assert.deepEqual(missing, {
      statusCode: 400,
      message: "admin@acme.com is not a mailbox on this server. Check the address and try again."
    });
    const several = messageSendError(deliveryFailure("Mailboxes one@acme.com, two@acme.com do not exist"));
    assert.equal(several?.statusCode, 400);
    assert.equal(several?.message, "These addresses are not mailboxes on this server: one@acme.com, two@acme.com. Check the addresses and try again.");
    assert.equal(messageSendError(deliveryFailure("No recipients"))?.message, "Enter at least one recipient.");
    assert.equal(messageSendError(new HttpError(400, "To is required"))?.message, "Enter at least one recipient.");
    assert.equal(messageSendError(new HttpError(400, "To has an invalid address: not-an-address"))?.message, "not-an-address is not a valid email address.");
    assert.equal(messageSendError(new HttpError(400, "Invalid address: copy@"))?.message, "copy@ is not a valid email address.");
    assert.equal(messageSendError(deliveryFailure("Empty message"))?.message, "The message was empty and was not sent.");
    assert.equal(messageSendError(deliveryFailure("Relay denied"))?.message, "This server only delivers mail to its own mailboxes unless you are signed in.");
    assert.equal(messageSendError(deliveryFailure("Sender must match the signed-in mailbox"))?.message, "You can only send from your own mailbox.");
    assert.equal(messageSendError(deliveryFailure("This server has no company domain yet", 450))?.message, "This server is not ready to send mail yet.");
    assert.deepEqual(messageSendError(new HttpError(413, "Attachments are too large")), {
      statusCode: 413,
      message: "This message is too large to send."
    });
    assert.equal(messageSendError(new HttpError(413, "Request is too large"))?.message, "This message is too large to send.");
    assert.equal(messageSendError(new HttpError(400, "Attachment is invalid"))?.message, "One attachment could not be read. Remove it and try again.");
    assert.equal(messageSendError(deliveryFailure("ECONNREFUSED 127.0.0.1"))?.message, "The message could not be sent. Check the addresses and try again.");
    assert.equal(messageSendError(new Error("disk failed")), null);
    assert.equal(messageSendError(new HttpError(500, "disk failed")), null);
  });
});
