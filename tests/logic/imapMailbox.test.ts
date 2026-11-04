import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyFlags,
  compileSearch,
  expandAttributes,
  fetchItems,
  flagList,
  matchesPattern,
  parseStoreMode,
  selectedMessages,
  setsSeen,
  tokenizeImap
} from "../../src/components/imap/utils/imapMailbox.js";
import { sampleRecord } from "../support/sampleMessage.js";
import { statusCodeOf } from "../support/statusCode.js";

describe("mailbox protocol logic", () => {
  const first = sampleRecord({
    identifier: "a".repeat(24),
    uniqueIdentifier: 4,
    subject: "Protocol check",
    text: "Hello from the test",
    seen: false,
    rawSize: 20,
    date: "2026-11-04T12:00:00.000Z"
  });
  const second = sampleRecord({
    identifier: "b".repeat(24),
    uniqueIdentifier: 9,
    subject: "Other",
    text: "Different body",
    fromAddress: "bea@acme.test",
    seen: true,
    deleted: true,
    rawSize: 80,
    date: "2026-11-02T12:00:00.000Z"
  });

  it("tokenizes quoted text, atoms, and nested lists", () => {
    assert.deepEqual(tokenizeImap('LOGIN "ada@acme.test" "secret"'), ["LOGIN", "ada@acme.test", "secret"]);
    assert.deepEqual(tokenizeImap("FETCH 1 (FLAGS BODY.PEEK[HEADER])"), ["FETCH", "1", ["FLAGS", "BODY.PEEK[HEADER]"]]);
    assert.deepEqual(tokenizeImap('"quote \\"here\\""'), ['quote "here"']);
  });

  it("lists, stores, and applies flags", () => {
    assert.equal(flagList(first), "FLAGS ()");
    assert.equal(flagList({ ...second, flagged: true }), "FLAGS (\\Seen \\Flagged \\Deleted)");
    assert.deepEqual(parseStoreMode("+FLAGS.SILENT"), { mode: "add", silent: true });
    assert.deepEqual(parseStoreMode("-FLAGS"), { mode: "remove", silent: false });
    assert.deepEqual(parseStoreMode("FLAGS"), { mode: "replace", silent: false });
    assert.equal(parseStoreMode("STORE"), null);
    assert.deepEqual(applyFlags(first, "add", ["\\Seen", "\\Flagged"]), {
      seen: true,
      answered: false,
      flagged: true,
      deleted: false,
      draft: false
    });
    assert.equal(applyFlags(second, "remove", ["\\Deleted"]).deleted, false);
    assert.equal(applyFlags(second, "replace", ["\\Answered"]).seen, false);
    assert.equal(applyFlags(second, "replace", ["\\Answered"]).answered, true);
  });

  it("selects sequence numbers and unique identifiers", () => {
    const messages = [first, second];
    assert.deepEqual(
      selectedMessages(messages, "1:*", false).map((item) => item.sequence),
      [1, 2]
    );
    assert.deepEqual(
      selectedMessages(messages, "9", true).map((item) => item.message.identifier),
      [second.identifier]
    );
    assert.equal(selectedMessages(messages, "", false).length, 0);
  });

  it("compiles search keys for flags, text, size, and dates", () => {
    const messages = [first, second];
    const unseen = compileSearch(tokenizeImap("UNSEEN SUBJECT Protocol"), messages, false);
    assert.equal(unseen(first), true);
    assert.equal(unseen(second), false);
    const either = compileSearch(tokenizeImap("OR FROM bea DELETED"), messages, false);
    assert.equal(either(second), true);
    assert.equal(either(first), false);
    const larger = compileSearch(tokenizeImap("LARGER 40"), messages, false);
    assert.equal(larger(second), true);
    assert.equal(larger(first), false);
    const onDay = compileSearch(tokenizeImap("ON 04-Nov-2026"), messages, false);
    assert.equal(onDay(first), true);
    assert.equal(onDay(second), false);
    const negated = compileSearch(tokenizeImap("NOT SEEN"), messages, false);
    assert.equal(negated(first), true);
    assert.throws(
      () => compileSearch(tokenizeImap("MODSEQ 1"), messages, false),
      (error: unknown) => statusCodeOf(error) === 0 && (error as Error).message.includes("MODSEQ")
    );
  });

  it("decides which fetch items mark a message seen", () => {
    assert.equal(setsSeen("RFC822"), true);
    assert.equal(setsSeen("BODY.PEEK[TEXT]"), false);
    assert.equal(setsSeen("BODY[HEADER]"), false);
    assert.equal(setsSeen("FLAGS"), false);
    assert.deepEqual(expandAttributes("ALL"), ["FLAGS", "INTERNALDATE", "RFC822.SIZE", "ENVELOPE"]);
    assert.deepEqual(expandAttributes("FAST"), ["FLAGS", "INTERNALDATE", "RFC822.SIZE"]);
    assert.equal(expandAttributes("FULL").includes("BODY"), true);
    assert.deepEqual(expandAttributes(["FLAGS", "UID"]), ["FLAGS", "UID"]);
  });

  it("fetches identifiers, headers, and a partial body", () => {
    const identifier = fetchItems(first, "UID");
    assert.equal(identifier[0].text, "UID 4");
    const header = fetchItems(first, "BODY[HEADER]");
    assert.equal(header[0].buffer?.toString("utf8").includes("Subject: Hello"), true);
    const partial = fetchItems(first, "BODY[]<0.5>");
    assert.equal(partial[0].prefix, "BODY[]<0>");
    assert.equal(partial[0].buffer?.length, 5);
    assert.equal(fetchItems(first, "FLAGS")[0].text, "FLAGS ()");
  });

  it("matches mailbox name patterns", () => {
    assert.equal(matchesPattern("INBOX", "*"), true);
    assert.equal(matchesPattern("Projects", "P*"), true);
    assert.equal(matchesPattern("Projects/Plans", "Projects/%"), true);
    assert.equal(matchesPattern("Projects/Plans/More", "Projects/%"), false);
    assert.equal(matchesPattern("Sent", "INBOX"), false);
  });
});
