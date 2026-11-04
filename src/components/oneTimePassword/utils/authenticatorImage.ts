import { codeVersions, type CodeVersion } from "../constants/codeVersions.js";

const fieldExponent = new Uint8Array(512);
const fieldLog = new Uint8Array(256);
let fieldReady = false;

function prepareField(): void {
  if (fieldReady) {
    return;
  }
  let value = 1;
  for (let index = 0; index < 255; index += 1) {
    fieldExponent[index] = value;
    fieldLog[value] = index;
    value <<= 1;
    if (value & 256) {
      value ^= 0x11d;
    }
  }
  for (let index = 255; index < 512; index += 1) {
    fieldExponent[index] = fieldExponent[index - 255];
  }
  fieldReady = true;
}

function fieldMultiply(left: number, right: number): number {
  if (left === 0 || right === 0) {
    return 0;
  }
  return fieldExponent[fieldLog[left] + fieldLog[right]];
}

export function errorCorrectionCodewords(data: number[], degree: number): number[] {
  prepareField();
  const divisor = new Uint8Array(degree);
  divisor[degree - 1] = 1;
  let root = 1;
  for (let index = 0; index < degree; index += 1) {
    for (let position = 0; position < divisor.length; position += 1) {
      divisor[position] = fieldMultiply(divisor[position], root);
      if (position + 1 < divisor.length) {
        divisor[position] ^= divisor[position + 1];
      }
    }
    root = fieldMultiply(root, 2);
  }
  const remainder = new Uint8Array(degree);
  for (const byte of data) {
    const factor = (byte ^ remainder[0]) & 255;
    remainder.copyWithin(0, 1);
    remainder[degree - 1] = 0;
    for (let position = 0; position < degree; position += 1) {
      remainder[position] ^= fieldMultiply(divisor[position], factor);
    }
  }
  return Array.from(remainder);
}

function dataCodewords(version: CodeVersion): number {
  return version.firstGroupBlocks * version.firstGroupData + version.secondGroupBlocks * version.secondGroupData;
}

function encodePayload(text: string, version: CodeVersion): number[] {
  const payload = Buffer.from(text, "utf8");
  const countLength = version.version < 10 ? 8 : 16;
  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let index = length - 1; index >= 0; index -= 1) {
      bits.push((value >> index) & 1);
    }
  };
  append(0b0100, 4);
  append(payload.length, countLength);
  for (const byte of payload) {
    append(byte, 8);
  }
  const capacity = dataCodewords(version) * 8;
  append(0, Math.min(4, Math.max(0, capacity - bits.length)));
  while (bits.length % 8 !== 0 && bits.length < capacity) {
    bits.push(0);
  }
  const words: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    let word = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      word = (word << 1) | bits[index + bit];
    }
    words.push(word);
  }
  let pad = 0xec;
  while (words.length < dataCodewords(version)) {
    words.push(pad);
    pad = pad === 0xec ? 0x11 : 0xec;
  }
  return words;
}

function chooseVersion(text: string): CodeVersion {
  const length = Buffer.byteLength(text, "utf8");
  for (const version of codeVersions) {
    const countLength = version.version < 10 ? 8 : 16;
    const used = 4 + countLength + length * 8;
    if (used <= dataCodewords(version) * 8) {
      return version;
    }
  }
  throw new Error("Authenticator image is too large");
}

function interleave(version: CodeVersion, words: number[]): number[] {
  const blocks: number[][] = [];
  let offset = 0;
  for (let index = 0; index < version.firstGroupBlocks; index += 1) {
    blocks.push(words.slice(offset, offset + version.firstGroupData));
    offset += version.firstGroupData;
  }
  for (let index = 0; index < version.secondGroupBlocks; index += 1) {
    blocks.push(words.slice(offset, offset + version.secondGroupData));
    offset += version.secondGroupData;
  }
  const corrections = blocks.map((block) => errorCorrectionCodewords(block, version.errorCodewordsPerBlock));
  const output: number[] = [];
  const longest = Math.max(...blocks.map((block) => block.length));
  for (let index = 0; index < longest; index += 1) {
    for (const block of blocks) {
      if (index < block.length) {
        output.push(block[index]);
      }
    }
  }
  for (let index = 0; index < version.errorCodewordsPerBlock; index += 1) {
    for (const block of corrections) {
      output.push(block[index]);
    }
  }
  return output;
}

function bit(value: number, index: number): boolean {
  return ((value >>> index) & 1) === 1;
}

function formatBits(mask: number): number {
  const data = mask;
  let remainder = data;
  for (let index = 0; index < 10; index += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  }
  return ((data << 10) | remainder) ^ 0x5412;
}

function versionBits(version: number): number {
  let remainder = version;
  for (let index = 0; index < 12; index += 1) {
    remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
  }
  return (version << 12) | remainder;
}

function emptyMatrix(size: number): { modules: boolean[][]; reserved: boolean[][] } {
  return {
    modules: Array.from({ length: size }, () => Array.from({ length: size }, () => false)),
    reserved: Array.from({ length: size }, () => Array.from({ length: size }, () => false))
  };
}

function setModule(modules: boolean[][], reserved: boolean[][], row: number, column: number, dark: boolean): void {
  modules[row][column] = dark;
  reserved[row][column] = true;
}

function drawFinder(modules: boolean[][], reserved: boolean[][], row: number, column: number): void {
  const size = modules.length;
  for (let y = -1; y <= 7; y += 1) {
    for (let x = -1; x <= 7; x += 1) {
      const nextRow = row + y;
      const nextColumn = column + x;
      if (nextRow < 0 || nextColumn < 0 || nextRow >= size || nextColumn >= size) {
        continue;
      }
      const inside = x >= 0 && x <= 6 && y >= 0 && y <= 6;
      const edge = x === 0 || x === 6 || y === 0 || y === 6;
      const center = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      setModule(modules, reserved, nextRow, nextColumn, inside && (edge || center));
    }
  }
}

function overlapsFinder(size: number, row: number, column: number): boolean {
  const nearTop = row <= 8;
  const nearBottom = row >= size - 9;
  const nearLeft = column <= 8;
  const nearRight = column >= size - 9;
  return (nearTop && nearLeft) || (nearTop && nearRight) || (nearBottom && nearLeft);
}

function drawAlignment(modules: boolean[][], reserved: boolean[][], centerRow: number, centerColumn: number): void {
  for (let y = -2; y <= 2; y += 1) {
    for (let x = -2; x <= 2; x += 1) {
      const dark = Math.max(Math.abs(x), Math.abs(y)) !== 1;
      setModule(modules, reserved, centerRow + y, centerColumn + x, dark);
    }
  }
}

function drawFunctionPatterns(version: CodeVersion): { modules: boolean[][]; reserved: boolean[][] } {
  const size = 21 + (version.version - 1) * 4;
  const { modules, reserved } = emptyMatrix(size);
  drawFinder(modules, reserved, 0, 0);
  drawFinder(modules, reserved, 0, size - 7);
  drawFinder(modules, reserved, size - 7, 0);
  for (let index = 8; index < size - 8; index += 1) {
    const dark = index % 2 === 0;
    setModule(modules, reserved, 6, index, dark);
    setModule(modules, reserved, index, 6, dark);
  }
  for (const row of version.alignmentCenters) {
    for (const column of version.alignmentCenters) {
      if (overlapsFinder(size, row, column)) {
        continue;
      }
      drawAlignment(modules, reserved, row, column);
    }
  }
  setModule(modules, reserved, size - 8, 8, true);
  for (let index = 0; index < 9; index += 1) {
    reserved[8][index] = true;
    reserved[index][8] = true;
  }
  for (let index = 0; index < 8; index += 1) {
    reserved[8][size - 1 - index] = true;
    reserved[size - 1 - index][8] = true;
  }
  if (version.version >= 7) {
    for (let index = 0; index < 18; index += 1) {
      reserved[Math.floor(index / 3)][size - 11 + (index % 3)] = true;
      reserved[size - 11 + (index % 3)][Math.floor(index / 3)] = true;
    }
    const bits = versionBits(version.version);
    for (let index = 0; index < 18; index += 1) {
      const dark = bit(bits, index);
      setModule(modules, reserved, Math.floor(index / 3), size - 11 + (index % 3), dark);
      setModule(modules, reserved, size - 11 + (index % 3), Math.floor(index / 3), dark);
    }
  }
  return { modules, reserved };
}

function maskMatches(mask: number, row: number, column: number): boolean {
  if (mask === 0) return (row + column) % 2 === 0;
  if (mask === 1) return row % 2 === 0;
  if (mask === 2) return column % 3 === 0;
  if (mask === 3) return (row + column) % 3 === 0;
  if (mask === 4) return (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0;
  if (mask === 5) return ((row * column) % 2) + ((row * column) % 3) === 0;
  if (mask === 6) return (((row * column) % 2) + ((row * column) % 3)) % 2 === 0;
  return (((row + column) % 2) + ((row * column) % 3)) % 2 === 0;
}

function placeData(modules: boolean[][], reserved: boolean[][], words: number[], remainderBits: number, mask: number): void {
  const bits: number[] = [];
  for (const word of words) {
    for (let index = 7; index >= 0; index -= 1) {
      bits.push((word >> index) & 1);
    }
  }
  for (let index = 0; index < remainderBits; index += 1) {
    bits.push(0);
  }
  const size = modules.length;
  let bitIndex = 0;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) {
      right -= 1;
    }
    const upward = ((right + 1) & 2) === 0;
    for (let vertical = 0; vertical < size; vertical += 1) {
      const row = upward ? size - 1 - vertical : vertical;
      for (let offset = 0; offset < 2; offset += 1) {
        const column = right - offset;
        if (reserved[row][column]) {
          continue;
        }
        const value = bitIndex < bits.length ? bits[bitIndex] : 0;
        bitIndex += 1;
        modules[row][column] = maskMatches(mask, row, column) ? value === 0 : value === 1;
      }
    }
  }
}

function drawFormat(modules: boolean[][], mask: number): void {
  const size = modules.length;
  const bits = formatBits(mask);
  const paint = (column: number, row: number, index: number) => {
    modules[row][column] = bit(bits, index);
  };
  for (let index = 0; index <= 5; index += 1) {
    paint(8, index, index);
  }
  paint(8, 7, 6);
  paint(8, 8, 7);
  paint(7, 8, 8);
  for (let index = 9; index < 15; index += 1) {
    paint(14 - index, 8, index);
  }
  for (let index = 0; index < 8; index += 1) {
    paint(size - 1 - index, 8, index);
  }
  for (let index = 8; index < 15; index += 1) {
    paint(8, size - 15 + index, index);
  }
  modules[size - 8][8] = true;
}

function penalty(modules: boolean[][]): number {
  const size = modules.length;
  let score = 0;
  for (let row = 0; row < size; row += 1) {
    let run = 1;
    for (let column = 1; column < size; column += 1) {
      if (modules[row][column] === modules[row][column - 1]) {
        run += 1;
      } else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    if (run >= 5) score += run - 2;
  }
  for (let column = 0; column < size; column += 1) {
    let run = 1;
    for (let row = 1; row < size; row += 1) {
      if (modules[row][column] === modules[row - 1][column]) {
        run += 1;
      } else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    if (run >= 5) score += run - 2;
  }
  for (let row = 0; row < size - 1; row += 1) {
    for (let column = 0; column < size - 1; column += 1) {
      const color = modules[row][column];
      if (color === modules[row][column + 1] && color === modules[row + 1][column] && color === modules[row + 1][column + 1]) {
        score += 3;
      }
    }
  }
  const finder = [true, false, true, true, true, false, true];
  const scan = (values: boolean[]) => {
    for (let index = 0; index <= values.length - 7; index += 1) {
      let matches = true;
      for (let offset = 0; offset < 7; offset += 1) {
        if (values[index + offset] !== finder[offset]) {
          matches = false;
        }
      }
      if (!matches) {
        continue;
      }
      const before = values.slice(Math.max(0, index - 4), index);
      const after = values.slice(index + 7, index + 11);
      if ((before.length === 4 && before.every((value) => !value)) || (after.length === 4 && after.every((value) => !value))) {
        score += 40;
      }
    }
  };
  for (let index = 0; index < size; index += 1) {
    scan(modules[index]);
    scan(modules.map((row) => row[index]));
  }
  let dark = 0;
  for (const row of modules) {
    for (const module of row) {
      if (module) dark += 1;
    }
  }
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

function cloneModules(modules: boolean[][]): boolean[][] {
  return modules.map((row) => row.slice());
}

export function authenticatorModules(text: string): boolean[][] {
  const version = chooseVersion(text);
  const words = interleave(version, encodePayload(text, version));
  const base = drawFunctionPatterns(version);
  let best: boolean[][] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let mask = 0; mask < 8; mask += 1) {
    const modules = cloneModules(base.modules);
    const reserved = base.reserved.map((row) => row.slice());
    placeData(modules, reserved, words, version.remainderBits, mask);
    drawFormat(modules, mask);
    const score = penalty(modules);
    if (score < bestScore) {
      bestScore = score;
      best = modules;
    }
  }
  return best || base.modules;
}

export function authenticatorImage(text: string): string {
  const modules = authenticatorModules(text);
  const quiet = 4;
  const size = modules.length + quiet * 2;
  const shapes = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="220" height="220" role="img">`];
  shapes.push(`<rect width="${size}" height="${size}" fill="#ffffff"/>`);
  for (let row = 0; row < modules.length; row += 1) {
    let column = 0;
    while (column < modules.length) {
      if (!modules[row][column]) {
        column += 1;
        continue;
      }
      const start = column;
      while (column < modules.length && modules[row][column]) {
        column += 1;
      }
      shapes.push(`<rect x="${start + quiet}" y="${row + quiet}" width="${column - start}" height="1" fill="#0f172a"/>`);
    }
  }
  shapes.push("</svg>");
  return shapes.join("");
}
