import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspectMessageContent } from "../../../src/components/messageFilter/utils/contentInspection.js";

const testVirusSignature = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const rejectedMessage = "The message content was rejected";

function messageWithAttachment(body: string, fileName: string, content: Buffer): Buffer {
  const attachment = `Content-Type: application/octet-stream; name="${fileName}"\r\nContent-Disposition: attachment; filename="${fileName}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${content.toString("base64")}\r\n`;
  return Buffer.from(
    `From: ada@acme.test\r\nTo: bea@acme.test\r\nSubject: Inspection\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=bound\r\n\r\n--bound\r\nContent-Type: text/plain\r\n\r\n${body}\r\n--bound\r\n${attachment}--bound--\r\n`
  );
}

function message(body: string, fileName = ""): Buffer {
  if (!fileName) {
    return Buffer.from(
      `From: ada@acme.test\r\nTo: bea@acme.test\r\nSubject: Inspection\r\nMIME-Version: 1.0\r\nContent-Type: text/plain\r\n\r\n${body}\r\n`
    );
  }
  return messageWithAttachment(body, fileName, Buffer.from("hello"));
}

function buildStoredZip(entryName: string, fileContent = Buffer.from("safe")): Buffer {
  const name = Buffer.from(entryName, "utf8");
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt32LE(fileContent.length, 18);
  localHeader.writeUInt32LE(fileContent.length, 22);
  localHeader.writeUInt16LE(name.length, 26);
  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt32LE(fileContent.length, 20);
  centralHeader.writeUInt32LE(fileContent.length, 24);
  centralHeader.writeUInt16LE(name.length, 28);
  centralHeader.writeUInt32LE(0, 42);
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
  endOfCentralDirectory.writeUInt16LE(1, 8);
  endOfCentralDirectory.writeUInt16LE(1, 10);
  endOfCentralDirectory.writeUInt32LE(46 + name.length, 12);
  endOfCentralDirectory.writeUInt32LE(30 + name.length + fileContent.length, 16);
  return Buffer.concat([localHeader, name, fileContent, centralHeader, name, endOfCentralDirectory]);
}

function buildOleCompoundFile(directoryNames: string[]): Buffer {
  const sectorSize = 512;
  const header = Buffer.alloc(sectorSize, 0);
  header.writeUInt32LE(0xe011cfd0, 0);
  header.writeUInt32LE(0xe11ab1a1, 4);
  header.writeUInt16LE(0x003e, 24);
  header.writeUInt16LE(3, 26);
  header.writeUInt16LE(0xfffe, 28);
  header.writeUInt16LE(9, 30);
  header.writeUInt32LE(1, 44);
  header.writeInt32LE(1, 48);
  header.writeInt32LE(0, 76);
  const fatSector = Buffer.alloc(sectorSize, 0xff);
  fatSector.writeInt32LE(-3, 0);
  fatSector.writeInt32LE(-2, 4);
  const directorySector = Buffer.alloc(sectorSize, 0);
  const names = ["Root Entry", ...directoryNames];
  names.forEach((name, index) => {
    const offset = index * 128;
    const encoded = Buffer.from(name, "utf16le");
    encoded.copy(directorySector, offset);
    directorySector.writeUInt16LE(encoded.length + 2, offset + 64);
    directorySector[offset + 66] = index === 0 ? 5 : 1;
  });
  return Buffer.concat([header, fatSector, directorySector]);
}

describe("message content inspection", () => {
  it("accepts an ordinary message", () => {
    assert.equal(inspectMessageContent(message("Hello from Ada")), "");
  });

  it("rejects a test virus signature in the raw message", () => {
    assert.equal(inspectMessageContent(Buffer.from(testVirusSignature)), rejectedMessage);
    assert.equal(inspectMessageContent(message(testVirusSignature)), rejectedMessage);
  });

  it("rejects expanded dangerous finals and multi-suffix names", () => {
    assert.equal(inspectMessageContent(message("See attached", "invoice.exe")), rejectedMessage);
    assert.equal(inspectMessageContent(message("See attached", "macro.docm")), rejectedMessage);
    assert.equal(inspectMessageContent(message("See attached", "setup.pif")), rejectedMessage);
    assert.equal(inspectMessageContent(message("See attached", "invoice.pdf.exe")), rejectedMessage);
    assert.equal(inspectMessageContent(message("See attached", "malware.exe.pdf")), rejectedMessage);
    assert.equal(inspectMessageContent(message("See attached", "invoice.pdf")), "");
  });

  it("rejects zip members with dangerous suffixes and accepts a safe zip", () => {
    assert.equal(
      inspectMessageContent(messageWithAttachment("See attached", "bundle.zip", buildStoredZip("payload.exe"))),
      rejectedMessage
    );
    assert.equal(
      inspectMessageContent(messageWithAttachment("See attached", "bundle.zip", buildStoredZip("notes.pdf"))),
      ""
    );
  });

  it("rejects unparseable zip only when the attachment name is already dangerous", () => {
    const brokenZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02]);
    assert.equal(inspectMessageContent(messageWithAttachment("See attached", "files.zip", brokenZip)), "");
    assert.equal(inspectMessageContent(messageWithAttachment("See attached", "evil.exe", brokenZip)), rejectedMessage);
  });

  it("rejects ole files with macro directory markers and accepts safe unparseable ole names", () => {
    assert.equal(
      inspectMessageContent(
        messageWithAttachment("See attached", "report.doc", buildOleCompoundFile(["VBA", "_VBA_PROJECT"]))
      ),
      rejectedMessage
    );
    assert.equal(
      inspectMessageContent(messageWithAttachment("See attached", "report.doc", buildOleCompoundFile(["WordDocument"]))),
      ""
    );
    const brokenOle = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0x00, 0x01, 0x02]);
    assert.equal(inspectMessageContent(messageWithAttachment("See attached", "report.doc", brokenOle)), "");
    assert.equal(inspectMessageContent(messageWithAttachment("See attached", "report.docm", brokenOle)), rejectedMessage);
  });
});
