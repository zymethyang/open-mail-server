import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspectMessageContent } from "../../../src/components/messageFilter/utils/contentInspection.js";

const testVirusSignature = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

function message(body: string, fileName = ""): Buffer {
  const attachment = fileName
    ? `Content-Type: application/octet-stream; name="${fileName}"\r\nContent-Disposition: attachment; filename="${fileName}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from("hello").toString("base64")}\r\n`
    : `${body}\r\n`;
  return Buffer.from(`From: ada@acme.test\r\nTo: bea@acme.test\r\nSubject: Inspection\r\nMIME-Version: 1.0\r\nContent-Type: ${fileName ? "multipart/mixed; boundary=bound" : "text/plain"}\r\n\r\n${fileName ? `--bound\r\nContent-Type: text/plain\r\n\r\n${body}\r\n--bound\r\n${attachment}--bound--\r\n` : attachment}`);
}

describe("message content inspection", () => {
  it("accepts an ordinary message", () => {
    assert.equal(inspectMessageContent(message("Hello from Ada")), "");
  });

  it("rejects a test virus signature in the raw message", () => {
    assert.equal(inspectMessageContent(Buffer.from(testVirusSignature)), "The message content was rejected");
    assert.equal(inspectMessageContent(message(testVirusSignature)), "The message content was rejected");
  });

  it("rejects an executable attachment and accepts a document", () => {
    assert.equal(inspectMessageContent(message("See attached", "invoice.exe")), "The message content was rejected");
    assert.equal(inspectMessageContent(message("See attached", "invoice.pdf")), "");
  });
});
