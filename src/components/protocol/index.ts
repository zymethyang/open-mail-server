import net from "node:net";
import type { ProtocolReader } from "./interfaces/protocolReader.js";

export type { ProtocolReader };

export function createProtocolReader(options: { acceptLiterals: boolean; maximumDataBytes: number }): ProtocolReader {
  let buffer = Buffer.alloc(0);
  let literalBytesRemaining = 0;
  let literalChunks: Buffer[] = [];
  let pendingLine = "";
  let collectingData = false;
  let dataChunks: Buffer[] = [];
  let dataBytes = 0;
  let chain: Promise<void> = Promise.resolve();
  let socket: net.Socket | null = null;
  let closed = false;

  const reader: ProtocolReader = {
    onLine: () => undefined,
    onLiteral: () => undefined,
    onLiteralRequest: () => undefined,
    onDataBlock: () => undefined,
    onClose: () => undefined,
    get socket() {
      return socket;
    },

    attach(nextSocket) {
      if (socket) {
        socket.removeAllListeners("data");
        socket.removeAllListeners("close");
        socket.removeAllListeners("end");
        socket.removeAllListeners("error");
      }
      socket = nextSocket;
      closed = false;
      nextSocket.on("data", (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        schedule();
      });
      nextSocket.on("error", () => finish());
      nextSocket.on("end", () => finish());
      nextSocket.on("close", () => finish());
    },

    send(data) {
      if (!socket || socket.destroyed) {
        return;
      }
      socket.write(data);
    },

    close() {
      if (socket && !socket.destroyed) {
        socket.end();
      }
    }
  };

  function finish(): void {
    if (closed) {
      return;
    }
    closed = true;
    reader.onClose();
  }

  function schedule(): void {
    chain = chain
      .then(() => pump())
      .catch((error: Error) => {
        console.error(`Protocol read failed: ${error.message}`);
        reader.close();
      });
  }

  async function pump(): Promise<void> {
    while (!closed) {
      if (collectingData) {
        const line = takeLineBuffer();
        if (!line) {
          return;
        }
        if (line.length === 1 && line[0] === 0x2e) {
          collectingData = false;
          const block = Buffer.concat(dataChunks);
          dataChunks = [];
          dataBytes = 0;
          await reader.onDataBlock(block);
          continue;
        }
        const content = line[0] === 0x2e ? line.subarray(1) : line;
        dataBytes += content.length + 2;
        if (dataBytes > options.maximumDataBytes) {
          reader.send("552 Message is too large\r\n");
          reader.close();
          return;
        }
        dataChunks.push(content, Buffer.from("\r\n"));
        continue;
      }

      if (literalBytesRemaining > 0) {
        if (buffer.length < literalBytesRemaining && buffer.length < options.maximumDataBytes) {
          return;
        }
        const take = Math.min(literalBytesRemaining, buffer.length);
        literalChunks.push(buffer.subarray(0, take));
        buffer = buffer.subarray(take);
        literalBytesRemaining -= take;
        if (literalBytesRemaining === 0) {
          const literal = Buffer.concat(literalChunks);
          const line = pendingLine;
          literalChunks = [];
          pendingLine = "";
          await reader.onLiteral(line, literal);
        }
        continue;
      }

      const splitAt = buffer.indexOf("\r\n");
      if (splitAt === -1) {
        if (buffer.length > 1024 * 1024) {
          reader.close();
        }
        return;
      }
      const line = buffer.subarray(0, splitAt).toString("utf8");
      buffer = buffer.subarray(splitAt + 2);
      const literalMatch = options.acceptLiterals ? /\{(\d+)(\+)?\}$/.exec(line) : null;
      if (literalMatch) {
        const byteCount = Number(literalMatch[1]);
        if (byteCount > options.maximumDataBytes) {
          reader.close();
          return;
        }
        pendingLine = line;
        literalBytesRemaining = byteCount;
        if (!literalMatch[2]) {
          reader.onLiteralRequest(line);
        }
        continue;
      }
      if (line === "") {
        continue;
      }
      const result = await reader.onLine(line);
      if (result === "collect-data") {
        collectingData = true;
      }
    }
  }

  function takeLineBuffer(): Buffer | null {
    const splitAt = buffer.indexOf("\r\n");
    if (splitAt === -1) {
      return null;
    }
    const line = buffer.subarray(0, splitAt);
    buffer = buffer.subarray(splitAt + 2);
    return line;
  }

  return reader;
}

export function dotStuff(buffer: Buffer): Buffer {
  const pieces: Buffer[] = [];
  let lineStart = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 0x0d && buffer[index + 1] === 0x0a) {
      const line = buffer.subarray(lineStart, index);
      if (line[0] === 0x2e) {
        pieces.push(Buffer.from("."));
      }
      pieces.push(line, Buffer.from("\r\n"));
      index += 1;
      lineStart = index + 1;
    }
  }
  const lastLine = buffer.subarray(lineStart);
  if (lastLine.length) {
    if (lastLine[0] === 0x2e) {
      pieces.push(Buffer.from("."));
    }
    pieces.push(lastLine);
    if (!(lastLine[lastLine.length - 2] === 0x0d && lastLine[lastLine.length - 1] === 0x0a)) {
      pieces.push(Buffer.from("\r\n"));
    }
  }
  pieces.push(Buffer.from(".\r\n"));
  return Buffer.concat(pieces);
}
