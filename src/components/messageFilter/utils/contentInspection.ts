import { parseRawMessage } from "../../mime/index.js";

const rejectedMessage = "The message content was rejected";
const dangerousExtensions = new Set([
  "exe",
  "scr",
  "com",
  "bat",
  "cmd",
  "js",
  "vbs",
  "msi",
  "jar",
  "ps1",
  "dll",
  "hta",
  "vbe",
  "jse",
  "wsf",
  "pif",
  "cpl",
  "msc",
  "reg",
  "lnk",
  "iso",
  "img",
  "cab",
  "ace",
  "docm",
  "xlsm",
  "pptm",
  "potm",
  "xltm",
  "dotm",
  "ppam",
  "xlam",
  "sldm"
]);
const testVirusSignature = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
const zipLocalSignature = 0x04034b50;
const zipCentralSignature = 0x02014b50;
const zipEndSignature = 0x06054b50;
const oleSignature = 0xe011cfd0;
const oleSignatureTail = 0xe11ab1a1;
const oleEndOfChain = -2;
const oleFatSector = -3;
const macroDirectoryMarkers = ["vba", "_vba_project", "macrosheet"];

function fileBaseName(fileName: string): string {
  const normalized = fileName.replace(/\\/g, "/");
  const segments = normalized.split("/");
  return segments[segments.length - 1] || fileName;
}

function hasDangerousSuffix(fileName: string): boolean {
  const baseName = fileBaseName(fileName);
  const parts = baseName.split(".");
  if (parts.length < 2) {
    return false;
  }
  for (let index = 1; index < parts.length; index += 1) {
    if (dangerousExtensions.has(parts[index].toLowerCase())) {
      return true;
    }
  }
  return false;
}

function startsWithZipLocalHeader(content: Buffer): boolean {
  return content.length >= 4 && content.readUInt32LE(0) === zipLocalSignature;
}

function startsWithOleHeader(content: Buffer): boolean {
  return content.length >= 4 && content.readUInt32LE(0) === oleSignature;
}

function findZipEndOfCentralDirectory(content: Buffer): number {
  const maximumCommentLength = 65535;
  const minimumEndSize = 22;
  if (content.length < minimumEndSize) {
    return -1;
  }
  const searchStart = Math.max(0, content.length - minimumEndSize - maximumCommentLength);
  for (let offset = content.length - minimumEndSize; offset >= searchStart; offset -= 1) {
    if (content.readUInt32LE(offset) === zipEndSignature) {
      return offset;
    }
  }
  return -1;
}

function listZipEntryNames(content: Buffer): string[] | null {
  const endOffset = findZipEndOfCentralDirectory(content);
  if (endOffset === -1) {
    return listZipEntryNamesFromLocalHeaders(content);
  }
  const totalEntries = content.readUInt16LE(endOffset + 10);
  const centralDirectorySize = content.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = content.readUInt32LE(endOffset + 16);
  if (centralDirectoryOffset + centralDirectorySize > content.length) {
    return null;
  }
  const names: string[] = [];
  let offset = centralDirectoryOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (offset + 46 > content.length || content.readUInt32LE(offset) !== zipCentralSignature) {
      return null;
    }
    const fileNameLength = content.readUInt16LE(offset + 28);
    const extraFieldLength = content.readUInt16LE(offset + 30);
    const commentLength = content.readUInt16LE(offset + 32);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    if (fileNameEnd > content.length) {
      return null;
    }
    names.push(content.subarray(fileNameStart, fileNameEnd).toString("utf8"));
    offset = fileNameEnd + extraFieldLength + commentLength;
  }
  return names;
}

function listZipEntryNamesFromLocalHeaders(content: Buffer): string[] | null {
  if (!startsWithZipLocalHeader(content)) {
    return null;
  }
  const names: string[] = [];
  let offset = 0;
  while (offset + 30 <= content.length) {
    if (content.readUInt32LE(offset) !== zipLocalSignature) {
      break;
    }
    const generalPurposeFlag = content.readUInt16LE(offset + 6);
    const compressedSize = content.readUInt32LE(offset + 18);
    const fileNameLength = content.readUInt16LE(offset + 26);
    const extraFieldLength = content.readUInt16LE(offset + 28);
    const fileNameStart = offset + 30;
    const fileNameEnd = fileNameStart + fileNameLength;
    if (fileNameEnd > content.length) {
      return null;
    }
    names.push(content.subarray(fileNameStart, fileNameEnd).toString("utf8"));
    offset = fileNameEnd + extraFieldLength;
    if (generalPurposeFlag & 0x08) {
      return null;
    }
    offset += compressedSize;
    if (offset > content.length) {
      return null;
    }
  }
  return names.length ? names : null;
}

function sectorFileOffset(sectorNumber: number, sectorSize: number): number {
  return (sectorNumber + 1) * sectorSize;
}

function readOleDirectoryNames(content: Buffer): string[] | null {
  if (content.length < 512) {
    return null;
  }
  if (content.readUInt32LE(0) !== oleSignature || content.readUInt32LE(4) !== oleSignatureTail) {
    return null;
  }
  const sectorShift = content.readUInt16LE(30);
  if (sectorShift !== 9) {
    return null;
  }
  const sectorSize = 1 << sectorShift;
  const fatSectorCount = content.readUInt32LE(44);
  const firstDirectorySector = content.readInt32LE(48);
  if (firstDirectorySector < 0 || fatSectorCount < 1 || fatSectorCount > 109) {
    return null;
  }
  const fatSectorIndexes: number[] = [];
  for (let index = 0; index < fatSectorCount; index += 1) {
    const fatSectorIndex = content.readInt32LE(76 + index * 4);
    if (fatSectorIndex < 0) {
      return null;
    }
    fatSectorIndexes.push(fatSectorIndex);
  }
  const fatEntriesPerSector = sectorSize / 4;
  const fileAllocationTable: number[] = [];
  for (const fatSectorIndex of fatSectorIndexes) {
    const offset = sectorFileOffset(fatSectorIndex, sectorSize);
    if (offset + sectorSize > content.length) {
      return null;
    }
    for (let entryIndex = 0; entryIndex < fatEntriesPerSector; entryIndex += 1) {
      fileAllocationTable.push(content.readInt32LE(offset + entryIndex * 4));
    }
  }
  const directoryBytes: Buffer[] = [];
  let sectorNumber = firstDirectorySector;
  const visited = new Set<number>();
  while (sectorNumber >= 0) {
    if (visited.has(sectorNumber) || sectorNumber >= fileAllocationTable.length) {
      return null;
    }
    visited.add(sectorNumber);
    const offset = sectorFileOffset(sectorNumber, sectorSize);
    if (offset + sectorSize > content.length) {
      return null;
    }
    directoryBytes.push(content.subarray(offset, offset + sectorSize));
    const nextSector = fileAllocationTable[sectorNumber];
    if (nextSector === oleEndOfChain) {
      break;
    }
    if (nextSector === oleFatSector || nextSector < 0) {
      return null;
    }
    sectorNumber = nextSector;
  }
  const directory = Buffer.concat(directoryBytes);
  const names: string[] = [];
  for (let offset = 0; offset + 128 <= directory.length; offset += 128) {
    const nameLength = directory.readUInt16LE(offset + 64);
    const entryType = directory[offset + 66];
    if (!entryType || nameLength < 2 || nameLength > 64) {
      continue;
    }
    const name = directory.subarray(offset, offset + nameLength - 2).toString("utf16le");
    if (name) {
      names.push(name);
    }
  }
  return names;
}

function oleContainsMacroMarkers(content: Buffer): boolean | null {
  const names = readOleDirectoryNames(content);
  if (!names) {
    return null;
  }
  return names.some((name) => macroDirectoryMarkers.includes(name.toLowerCase()));
}

function attachmentContentIsRejected(fileName: string, content: Buffer): boolean {
  if (content.includes(testVirusSignature)) {
    return true;
  }
  if (hasDangerousSuffix(fileName)) {
    return true;
  }
  if (startsWithZipLocalHeader(content)) {
    const entryNames = listZipEntryNames(content);
    if (entryNames) {
      return entryNames.some((entryName) => hasDangerousSuffix(entryName));
    }
    return hasDangerousSuffix(fileName);
  }
  if (startsWithOleHeader(content)) {
    const macroMarkers = oleContainsMacroMarkers(content);
    if (macroMarkers === true) {
      return true;
    }
    if (macroMarkers === null) {
      return hasDangerousSuffix(fileName);
    }
  }
  return false;
}

export function inspectMessageContent(message: Buffer): string {
  if (message.includes(testVirusSignature)) {
    return rejectedMessage;
  }
  let parsed: ReturnType<typeof parseRawMessage>;
  try {
    parsed = parseRawMessage(message);
  } catch {
    return "";
  }
  const pieces = [parsed.text, parsed.html];
  for (const attachment of parsed.attachments) {
    const content = Buffer.from(attachment.contentEncoded || "", "base64");
    pieces.push(content.toString("utf8"));
    if (attachmentContentIsRejected(attachment.fileName || "", content)) {
      return rejectedMessage;
    }
  }
  if (pieces.some((piece) => piece.includes(testVirusSignature))) {
    return rejectedMessage;
  }
  return "";
}
