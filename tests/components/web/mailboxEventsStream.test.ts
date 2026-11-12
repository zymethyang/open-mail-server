import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccountRole } from "../../../src/components/account/enums/accountRole.js";
import { MailFolderName } from "../../../src/components/message/enums/mailFolderName.js";
import { requestJson, startWebConsole } from "../../support/webConsole.js";
import { sampleMessage } from "../../support/sampleMessage.js";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe("mailbox event stream", () => {
  it("rejects a missing session", async () => {
    const consoleServer = await startWebConsole();
    try {
      const response = await fetch(`${consoleServer.baseUrl}/api/mailbox-events`);
      assert.equal(response.status, 401);
      await response.body?.cancel();
    } finally {
      await consoleServer.stop();
    }
  });

  it("sends folder changes for the signed-in mailbox only", async () => {
    const consoleServer = await startWebConsole();
    const controller = new AbortController();
    try {
      const setup = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
        organizationName: "Acme",
        domain: "acme.test",
        publicAddress: "203.0.113.10",
        displayName: "Ada Admin",
        address: "ada@acme.test",
        password: "correct-horse"
      });
      assert.equal(setup.status, 201);
      await consoleServer.accountRepository.createAccount({
        address: "bea@acme.test",
        displayName: "Bea Member",
        password: "member-horse",
        role: AccountRole.Member,
        domain: "acme.test"
      });
      const response = await fetch(`${consoleServer.baseUrl}/api/mailbox-events`, {
        headers: { Cookie: setup.cookieHeader },
        signal: controller.signal
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type") || "", /text\/event-stream/);
      const reader = response.body?.getReader();
      assert.ok(reader);
      const decoder = new TextDecoder();
      const pieces: string[] = [];
      const reading = (async () => {
        try {
          while (!controller.signal.aborted) {
            const chunk = await reader.read();
            if (chunk.done) {
              return;
            }
            pieces.push(decoder.decode(chunk.value, { stream: true }));
          }
        } catch {
          return;
        }
      })();
      const received = () => pieces.join("");
      const started = Date.now();
      while (!received().includes(": connected") && Date.now() - started < 3000) {
        await delay(20);
      }
      assert.match(received(), /: connected/);

      await consoleServer.messageRepository.appendMessage("bea@acme.test", MailFolderName.Inbox, sampleMessage({
        fromAddress: "bea@acme.test",
        toAddresses: ["bea@acme.test"],
        subject: "Private"
      }));
      await delay(300);
      assert.equal(received().includes("data:"), false);

      const stored = await consoleServer.messageRepository.appendMessage("ada@acme.test", MailFolderName.Inbox, sampleMessage({
        subject: "Live mailbox arrival"
      }));
      const arrival = Date.now();
      while (!received().includes(`"folderName":"${MailFolderName.Inbox}"`) && Date.now() - arrival < 3000) {
        await delay(20);
      }
      assert.match(received(), new RegExp(`"folderName":"${MailFolderName.Inbox}"`));

      await consoleServer.messageRepository.updateMessage("ada@acme.test", MailFolderName.Inbox, stored.identifier, { seen: true });
      const seen = Date.now();
      const beforeSeen = received();
      while (received() === beforeSeen && Date.now() - seen < 3000) {
        await delay(20);
      }
      assert.equal(received().split(`"folderName":"${MailFolderName.Inbox}"`).length > beforeSeen.split(`"folderName":"${MailFolderName.Inbox}"`).length, true);
      controller.abort();
      await reading;
    } finally {
      controller.abort();
      await consoleServer.stop();
    }
  });
});
