import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FlagStoreMode } from "../../../../src/components/imap/enums/flagStoreMode.js";
import {
  appendDetails,
  applyFlags,
  compileSearch,
  expandAttributes,
  fetchItems,
  flagList,
  listRequest,
  matchesPattern,
  parseImapDateTime,
  parseStoreMode,
  selectedMessages,
  setsSeen,
  tokenizeImap
} from "../../../../src/components/imap/utils/imapMailbox.js";
import { sampleRecord } from "../../../support/sampleMessage.js";
import { statusCodeOf } from "../../../support/statusCode.js";

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
    assert.deepEqual(tokenizeImap("FETCH 1 BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)]"), [
      "FETCH",
      "1",
      "BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE)]"
    ]);
    assert.deepEqual(tokenizeImap("SEARCH (SEEN))"), ["SEARCH", ["SEEN"], ")"]);
    assert.deepEqual(tokenizeImap("FETCH 1 BODY[HEADER"), ["FETCH", "1", "BODY[HEADER"]);
    assert.deepEqual(tokenizeImap('"quote \\"here\\""'), ['quote "here"']);
  });

  it("lists, stores, and applies flags", () => {
    assert.equal(flagList(first), "FLAGS ()");
    assert.equal(flagList({ ...second, flagged: true }), "FLAGS (\\Seen \\Flagged \\Deleted)");
    assert.deepEqual(parseStoreMode("+FLAGS.SILENT"), { mode: FlagStoreMode.Add, silent: true });
    assert.deepEqual(parseStoreMode("-FLAGS"), { mode: FlagStoreMode.Remove, silent: false });
    assert.deepEqual(parseStoreMode("FLAGS"), { mode: FlagStoreMode.Replace, silent: false });
    assert.equal(parseStoreMode("STORE"), null);
    assert.deepEqual(applyFlags(first, FlagStoreMode.Add, ["\\Seen", "\\Flagged", "$Forwarded"]), {
      seen: true,
      answered: false,
      flagged: true,
      deleted: false,
      draft: false,
      keywords: ["$Forwarded"]
    });
    assert.equal(applyFlags(second, FlagStoreMode.Remove, ["\\Deleted"]).deleted, false);
    assert.equal(applyFlags(second, FlagStoreMode.Replace, ["\\Answered"]).seen, false);
    assert.equal(applyFlags(second, FlagStoreMode.Replace, ["\\Answered"]).answered, true);
    assert.deepEqual(applyFlags({ ...first, keywords: ["$Forwarded", "ClientTag"] }, FlagStoreMode.Remove, ["clienttag"]).keywords, ["$Forwarded"]);
    assert.deepEqual(applyFlags({ ...first, keywords: ["$Forwarded"] }, FlagStoreMode.Replace, ["\\Seen"]).keywords, []);
    assert.equal(flagList({ ...first, seen: true, keywords: ["$Forwarded"] }), "FLAGS (\\Seen $Forwarded)");
  });

  it("keeps the client receipt time from an append command", () => {
    assert.equal(parseImapDateTime("01-Jan-2020 00:00:00 +0000"), "2020-01-01T00:00:00.000Z");
    assert.equal(parseImapDateTime("01-Jan-2020 00:00:00 -0500"), "2020-01-01T05:00:00.000Z");
    assert.equal(parseImapDateTime("not a date"), null);
    const details = appendDetails(tokenizeImap('A1 APPEND INBOX (\\Seen $Forwarded) "01-Jan-2020 00:00:00 +0000"'));
    assert.deepEqual(details.flagNames, ["\\Seen", "$Forwarded"]);
    assert.equal(details.receivedAt, "2020-01-01T00:00:00.000Z");
    const forwarded = compileSearch(tokenizeImap("KEYWORD $Forwarded"), [{ ...first, keywords: ["$Forwarded"] }], false);
    assert.equal(forwarded({ ...first, keywords: ["$Forwarded"] }), true);
    assert.equal(forwarded(first), false);
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

  it("reads a mailbox list the way phone clients send it", () => {
    assert.deepEqual(listRequest(tokenizeImap('A1 LIST "" "*"')), { pattern: "*", specialUseOnly: false });
    assert.deepEqual(listRequest(tokenizeImap('A1 LIST (SPECIAL-USE) "" "*"')), { pattern: "*", specialUseOnly: true });
    assert.deepEqual(listRequest(tokenizeImap('A1 LIST "" "INBOX"')), { pattern: "INBOX", specialUseOnly: false });
    const header = fetchItems(first, "BODY.PEEK[HEADER.FIELDS (FROM SUBJECT)]");
    assert.match(header[0].prefix || "", /BODY\[HEADER.FIELDS \(FROM SUBJECT\)\]/);
    assert.match(header[0].buffer?.toString("utf8") || "", /Subject:/);
  });

  it("matches mailbox name patterns", () => {
    assert.equal(matchesPattern("INBOX", "*"), true);
    assert.equal(matchesPattern("Projects", "P*"), true);
    assert.equal(matchesPattern("Projects/Plans", "Projects/%"), true);
    assert.equal(matchesPattern("Projects/Plans/More", "Projects/%"), false);
    assert.equal(matchesPattern("Sent", "INBOX"), false);
  });
});
