import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildEnvelope,
  createMessageIdentifier,
  createRawMessage,
  createSnippet,
  createStoredMessage,
  encodeHeaderValue,
  filterHeaderFields,
  formatInternalDate,
  formatRfc5322Date,
  imapAddressGroup,
  parseRawMessage,
  quoteImap,
  rawBufferFromMessage,
  sanitizeMessageHtml,
  splitHeaderAndBody
} from "../../../src/components/mime/index.js";
import { sampleMessage } from "../../support/sampleMessage.js";

describe("message format logic", () => {
  it("formats dates in the mail standards", () => {
    const date = new Date(Date.UTC(2026, 10, 4, 15, 30, 0));
    assert.equal(formatRfc5322Date(date), "Wed, 04 Nov 2026 15:30:00 +0000");
    assert.equal(formatInternalDate(date.toISOString()), "04-Nov-2026 15:30:00 +0000");
  });

  it("encodes only header values that are not plain text", () => {
    assert.equal(encodeHeaderValue("Hello"), "Hello");
    assert.equal(encodeHeaderValue("Ada Nguyễn"), `=?UTF-8?B?${Buffer.from("Ada Nguyễn", "utf8").toString("base64")}?=`);
    assert.equal(encodeHeaderValue("line\r\none"), "line one");
  });

  it("removes scripts, frames, event handlers, and script locations from html", () => {
    const cleaned = sanitizeMessageHtml(`<p onclick="alert(1)">Hi</p><script>alert(1)</script><iframe src="x"></iframe><a href="javascript:alert(1)">go</a><img src="/api/settings"><meta http-equiv="refresh" content="0;url=https://evil.test"><a href="https://example.test/help">help</a>`);
    assert.equal(cleaned.includes("script"), false);
    assert.equal(cleaned.includes("iframe"), false);
    assert.equal(cleaned.includes("onclick"), false);
    assert.equal(cleaned.includes("javascript:"), false);
    assert.equal(cleaned.includes("/api/settings"), false);
    assert.equal(cleaned.includes("http-equiv"), false);
    assert.equal(cleaned.includes("https://example.test/help"), true);
    assert.equal(cleaned.includes("<p>Hi</p>"), true);
  });

  it("keeps content identifiers so an attached image can be shown", () => {
    const cleaned = sanitizeMessageHtml(`<p>test hello world</p><img src="cid:IMG_4172.PNG" alt="IMG_4172.PNG"><img src="cid:javascript:alert(1)" alt="bad">`);
    assert.equal(cleaned.includes("cid:IMG_4172.PNG"), true);
    assert.equal(sanitizeMessageHtml(`<img src="cid:A1B2/IMG_4172.PNG" alt="IMG_4172.PNG">`).includes("cid:A1B2/IMG_4172.PNG"), true);
    assert.equal(cleaned.includes("javascript:"), false);
    const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const raw = Buffer.from(
      [
        "From: Tri Nguyen <user@example.test>",
        "To: admin@example.test",
        "Subject: Photo",
        'Content-Type: multipart/related; boundary="related"',
        "",
        "--related",
        "Content-Type: text/html; charset=UTF-8",
        "",
        '<p>test hello world</p><img src="cid:IMG_4172.PNG" alt="IMG_4172.PNG">',
        "--related",
        'Content-Type: image/png; name="IMG_4172.PNG"',
        "Content-Transfer-Encoding: base64",
        'Content-Disposition: inline; filename="IMG_4172.PNG"',
        "Content-ID: <IMG_4172.PNG@mail.gmail.com>",
        "",
        image.toString("base64"),
        "--related--",
        ""
      ].join("\r\n")
    );
    const parsed = parseRawMessage(raw);
    assert.equal(parsed.html.includes("cid:IMG_4172.PNG"), true);
    assert.equal(parsed.attachments[0].fileName, "IMG_4172.PNG");
    assert.equal(parsed.attachments[0].contentType, "image/png");
    assert.equal(parsed.attachments[0].contentIdentifier, "IMG_4172.PNG@mail.gmail.com");
    assert.equal(Buffer.from(parsed.attachments[0].contentEncoded, "base64").equals(image), true);
    assert.equal(sanitizeMessageHtml(parsed.html).includes("cid:IMG_4172.PNG"), true);
    const encodedName = parseRawMessage(
      Buffer.from(
        [
          "From: ada@acme.test",
          "To: bea@acme.test",
          "Subject: Encoded name",
          'Content-Type: image/png; name="ignored.png"',
          "Content-Transfer-Encoding: base64",
          "Content-Disposition: attachment; filename*=UTF-8''IMG_4172.PNG",
          "Content-ID: <ii_photo@mail.gmail.com>",
          "",
          image.toString("base64"),
          ""
        ].join("\r\n")
      )
    );
    assert.equal(encodedName.attachments[0].fileName, "IMG_4172.PNG");
    assert.equal(encodedName.attachments[0].contentIdentifier, "ii_photo@mail.gmail.com");
    assert.equal(sanitizeMessageHtml(`<img src="cid:ii_photo@mail.gmail.com" alt="IMG_4172.PNG">`).includes("cid:ii_photo@mail.gmail.com"), true);
  });

  it("keeps a quoted display name without a trailing quote", () => {
    const parsed = parseRawMessage(
      Buffer.from('From: "Ada Nguyen" <ada@acme.test>\r\nTo: Bea <bea@acme.test>, cam@acme.test\r\nCc: dee@acme.test\r\nSubject: =?UTF-8?B?SGVsbG8=?=\r\nMessage-ID: <one@acme.test>\r\nIn-Reply-To: <zero@acme.test>\r\n\r\nHello\r\n')
    );
    assert.equal(parsed.fromName, "Ada Nguyen");
    assert.equal(parsed.fromAddress, "ada@acme.test");
    assert.deepEqual(parsed.toAddresses, ["bea@acme.test", "cam@acme.test"]);
    assert.deepEqual(parsed.copyAddresses, ["dee@acme.test"]);
    assert.equal(parsed.subject, "Hello");
    assert.equal(parsed.text, "Hello");
    assert.equal(parsed.messageIdentifierHeader, "<one@acme.test>");
    assert.equal(parsed.inReplyTo, "<zero@acme.test>");
  });

  it("decodes quoted-printable text, base64 attachments, and html without a plain part", () => {
    const raw = Buffer.from(
      [
        "From: ada@acme.test",
        "To: bea@acme.test",
        "Subject: Parts",
        'Content-Type: multipart/mixed; boundary="mix"',
        "",
        "--mix",
        'Content-Type: multipart/alternative; boundary="alt"',
        "",
        "--alt",
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        "<p>Caf=C3=A9</p>",
        "--alt--",
        "--mix",
        'Content-Type: text/plain; name="note.txt"',
        "Content-Transfer-Encoding: base64",
        'Content-Disposition: attachment; filename="note.txt"',
        "Content-ID: <note@acme.test>",
        "",
        Buffer.from("note", "utf8").toString("base64"),
        "--mix--",
        ""
      ].join("\r\n")
    );
    const parsed = parseRawMessage(raw);
    assert.equal(parsed.text, "Café");
    assert.equal(parsed.html.includes("Café"), true);
    assert.equal(parsed.attachments.length, 1);
    assert.equal(parsed.attachments[0].fileName, "note.txt");
    assert.equal(Buffer.from(parsed.attachments[0].contentEncoded, "base64").toString("utf8"), "note");
    assert.equal(parsed.attachments[0].contentIdentifier, "note@acme.test");
  });

  it("uses a readable subject when the message does not have one", () => {
    const raw = Buffer.from("From: ada@acme.test\r\nTo: ada@acme.test\r\nDate: not-a-date\r\n\r\nBody\r\n");
    const parsed = parseRawMessage(raw);
    const stored = createStoredMessage(parsed, raw, "ada@acme.test");
    assert.equal(stored.subject, "(no subject)");
    assert.equal(stored.text, "Body");
    assert.equal(Number.isNaN(Date.parse(stored.date)), false);
    assert.equal(stored.rawSize, raw.length);
    assert.deepEqual(rawBufferFromMessage(stored), raw);
  });

  it("round-trips a message with html and an attachment", () => {
    const raw = createRawMessage({
      fromName: "Ada Nguyễn",
      fromAddress: "ada@acme.test",
      toAddresses: ["bea@acme.test"],
      copyAddresses: ["cam@acme.test"],
      subject: "Bản tin",
      text: "Plain line",
      html: "<p>Plain line</p><script>alert(1)</script>",
      attachments: [
        {
          fileName: "notes.txt",
          contentType: "text/plain",
          content: Buffer.from("notes"),
          contentIdentifier: ""
        }
      ],
      messageIdentifierHeader: "<news@acme.test>",
      inReplyTo: "<old@acme.test>",
      date: new Date(Date.UTC(2026, 10, 4, 15, 30, 0))
    });
    const parsed = parseRawMessage(raw);
    assert.equal(parsed.fromName, "Ada Nguyễn");
    assert.equal(parsed.subject, "Bản tin");
    assert.equal(parsed.text, "Plain line");
    assert.equal(parsed.html.includes("script"), false);
    assert.equal(parsed.copyAddresses[0], "cam@acme.test");
    assert.equal(parsed.attachments[0].fileName, "notes.txt");
    assert.equal(Buffer.from(parsed.attachments[0].contentEncoded, "base64").toString("utf8"), "notes");
    assert.match(createMessageIdentifier("acme.test"), /^<[0-9a-f]+@acme\.test>$/);
  });

  it("builds a short snippet and splits or filters headers", () => {
    assert.equal(createSnippet("  hello\nworld  "), "hello world");
    assert.equal(createSnippet("x".repeat(200)).length, 140);
    const raw = Buffer.from("From: ada@acme.test\r\nSubject: Hello\r\n\r\nBody");
    const parts = splitHeaderAndBody(raw);
    assert.equal(parts.header.toString("utf8"), "From: ada@acme.test\r\nSubject: Hello");
    assert.equal(parts.body.toString("utf8"), "Body");
    const folded = Buffer.from("From: ada@acme.test\r\nSubject: Hello\r\n there\r\nDate: today\r\n");
    assert.equal(filterHeaderFields(folded, ["subject"], true).toString("utf8").includes("there"), true);
    assert.equal(filterHeaderFields(folded, ["subject"], true).toString("utf8").includes("Date"), false);
    assert.equal(filterHeaderFields(folded, ["subject"], false).toString("utf8").includes("Date"), true);
    assert.equal(splitHeaderAndBody(Buffer.from("no separator")).body.length, 0);
  });

  it("quotes mailbox values and builds an envelope", () => {
    assert.equal(quoteImap(""), '""');
    assert.equal(quoteImap("Ada"), '"Ada"');
    assert.equal(quoteImap('Ada "A"'), '"Ada \\"A\\""');
    const displayName = "Ada Nguyễn";
    assert.equal(quoteImap(displayName), `{${Buffer.byteLength(displayName)}}\r\n${displayName}`);
    assert.equal(imapAddressGroup([]), "NIL");
    assert.equal(imapAddressGroup(["ada@acme.test"]).includes('"ada"'), true);
    const envelope = buildEnvelope(
      sampleMessage({
        subject: "Hello",
        fromName: "Ada",
        fromAddress: "ada@acme.test",
        toAddresses: ["bea@acme.test"],
        inReplyTo: "<old@acme.test>"
      })
    );
    assert.equal(envelope.startsWith("ENVELOPE ("), true);
    assert.equal(envelope.includes("Hello"), true);
    assert.equal(envelope.includes("<old@acme.test>"), true);
  });
});
