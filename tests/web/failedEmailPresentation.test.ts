import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  failedEmailNotice,
  resendButtonLabel,
  visibleFailedEmail,
  type FailedEmailSearchFields
} from "../../src/web/client/components/failedEmail/presentation.js";

const messages: FailedEmailSearchFields[] = [
  {
    senderAddress: "ada@acme.test",
    recipientAddresses: ["one@example.test", "two@example.test"],
    subject: "Quarterly notes",
    lastError: "The other mail server is down"
  },
  {
    senderAddress: "bea@acme.test",
    recipientAddresses: ["person@blocked.example"],
    subject: "Warehouse receipt",
    lastError: "Connection timed out"
  }
];

describe("failed email presentation", () => {
  it("filters by sender, recipient, subject, or error and ignores surrounding space", () => {
    assert.deepEqual(visibleFailedEmail(messages, ""), messages);
    assert.deepEqual(visibleFailedEmail(messages, "   "), messages);
    assert.deepEqual(visibleFailedEmail(messages, " BEA "), [messages[1]]);
    assert.deepEqual(visibleFailedEmail(messages, "two@example.test"), [messages[0]]);
    assert.deepEqual(visibleFailedEmail(messages, "warehouse"), [messages[1]]);
    assert.deepEqual(visibleFailedEmail(messages, "timed out"), [messages[1]]);
    assert.deepEqual(visibleFailedEmail(messages, "nobody"), []);
  });

  it("names the one resend button from the number of checked rows", () => {
    assert.equal(resendButtonLabel(0), "Resend all");
    assert.equal(resendButtonLabel(1), "Resend selected");
    assert.equal(resendButtonLabel(4), "Resend selected");
  });

  it("describes every resend outcome", () => {
    assert.equal(failedEmailNotice({ sent: ["a"], givenUp: [], stillWaiting: [] }), "1 message was sent.");
    assert.equal(failedEmailNotice({ sent: ["a", "b"], givenUp: [], stillWaiting: [] }), "2 messages were sent.");
    assert.equal(
      failedEmailNotice({ sent: [], givenUp: ["a"], stillWaiting: [] }),
      "1 message could not be sent and was returned to the sender."
    );
    assert.equal(
      failedEmailNotice({ sent: [], givenUp: ["a", "b"], stillWaiting: [] }),
      "2 messages could not be sent and were returned to the sender."
    );
    assert.equal(
      failedEmailNotice({ sent: [], givenUp: [], stillWaiting: ["a"] }),
      "Nothing was sent. The mail server rejected it again. 1 message is still waiting."
    );
    assert.equal(
      failedEmailNotice({ sent: ["a"], givenUp: ["b"], stillWaiting: ["c", "d"] }),
      "1 message was sent. 1 message could not be sent and was returned to the sender. 2 messages are still waiting."
    );
    assert.equal(
      failedEmailNotice({ sent: ["a", "b", "c"], givenUp: [], stillWaiting: ["d"] }),
      "3 messages were sent. 1 message is still waiting."
    );
  });
});
