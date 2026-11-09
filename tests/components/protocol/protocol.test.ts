import assert from "node:assert/strict";
import net from "node:net";
import { describe, it } from "node:test";
import { createProtocolReader, dotStuff } from "../../../src/components/protocol/index.js";
import { describeListenError, listen } from "../../../src/components/protocol/utils/listen.js";
import { readResponse } from "../../support/protocolClient.js";

describe("protocol logic", () => {
  it("describes listener failures", () => {
    assert.equal(describeListenError({ code: "EADDRINUSE" } as NodeJS.ErrnoException), "port is already in use");
    assert.match(describeListenError({ code: "EACCES" } as NodeJS.ErrnoException), /permission denied/);
    assert.match(describeListenError({ code: "EPERM" } as NodeJS.ErrnoException), /permission denied/);
    assert.equal(describeListenError({ message: "broken" } as NodeJS.ErrnoException), "broken");
    assert.equal(describeListenError({} as NodeJS.ErrnoException), "could not start");
  });

  it("returns the assigned port and reports a port that is already in use", async () => {
    const first = net.createServer();
    const port = await listen(first, 0, "127.0.0.1");
    assert.equal(port > 0, true);
    const second = net.createServer();
    await assert.rejects(listen(second, port, "127.0.0.1"), (error: unknown) => {
      assert.equal(describeListenError(error as NodeJS.ErrnoException), "port is already in use");
      return true;
    });
    await new Promise<void>((resolve) => first.close(() => resolve()));
  });

  it("stuffs lines that begin with a period and ends the block", () => {
    const stuffed = dotStuff(Buffer.from(".secret\r\nnext\r\n")).toString("utf8");
    assert.equal(stuffed, "..secret\r\nnext\r\n.\r\n");
  });

  it("reads a command, a period-terminated block, and a literal", async () => {
    const pair = await openPair();
    try {
      const reader = createProtocolReader({ acceptLiterals: true, maximumDataBytes: 1000 });
      const line = new Promise<string>((resolve) => {
        reader.onLine = (value) => {
          resolve(value);
          return "collect-data";
        };
      });
      const block = new Promise<Buffer>((resolve) => {
        reader.onDataBlock = (value) => resolve(value);
      });
      reader.attach(pair.serverSocket);
      pair.client.write("DATA\r\nhello\r\n..secret\r\n.\r\n");
      assert.equal(await line, "DATA");
      assert.equal((await block).toString("utf8"), "hello\r\n.secret\r\n");
    } finally {
      pair.close();
    }

    const literalPair = await openPair();
    try {
      const reader = createProtocolReader({ acceptLiterals: true, maximumDataBytes: 1000 });
      const requested = new Promise<string>((resolve) => {
        reader.onLiteralRequest = (value) => resolve(value);
      });
      const literal = new Promise<{ line: string; value: Buffer }>((resolve) => {
        reader.onLiteral = (line, value) => resolve({ line, value });
      });
      reader.attach(literalPair.serverSocket);
      literalPair.client.write("A001 LOGIN {5}\r\nhello\r\n");
      assert.equal(await requested, "A001 LOGIN {5}");
      const received = await literal;
      assert.equal(received.line, "A001 LOGIN {5}");
      assert.equal(received.value.toString("utf8"), "hello");
    } finally {
      literalPair.close();
    }
  });

  it("refuses a data block larger than the configured limit", async () => {
    const pair = await openPair();
    try {
      const reader = createProtocolReader({ acceptLiterals: false, maximumDataBytes: 20 });
      reader.onLine = () => "collect-data";
      reader.attach(pair.serverSocket);
      pair.client.write(`DATA\r\n${"x".repeat(30)}\r\n.\r\n`);
      const response = await readResponse(pair.client);
      assert.match(response, /^552 /);
    } finally {
      pair.close();
    }
  });
});

function openPair(): Promise<{ client: net.Socket; serverSocket: net.Socket; close(): void }> {
  const server = net.createServer();
  return listen(server, 0, "127.0.0.1").then(
    (port) =>
      new Promise((resolve, reject) => {
        const client = net.connect(port, "127.0.0.1");
        const fail = (error: Error) => {
          client.destroy();
          server.close();
          reject(error);
        };
        server.once("connection", (serverSocket) => {
          client.off("error", fail);
          resolve({
            client,
            serverSocket,
            close() {
              client.destroy();
              serverSocket.destroy();
              server.close();
            }
          });
        });
        client.once("error", fail);
      })
  );
}
