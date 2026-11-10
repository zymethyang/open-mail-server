import assert from "node:assert/strict";
import net from "node:net";
import { describe, it } from "node:test";
import { listen, listenWhenPortIsFree } from "../../../../src/components/protocol/utils/listen.js";

describe("listen when the port is busy", () => {
  it("starts after the port is released and stops when asked", async () => {
    const held = net.createServer();
    await new Promise<void>((resolve) => {
      held.listen(0, "127.0.0.1", () => resolve());
    });
    const address = held.address();
    if (!address || typeof address === "string") {
      throw new Error("The held port did not start");
    }
    let attempts = 0;
    const started = listenWhenPortIsFree(async () => {
      attempts += 1;
      const server = net.createServer();
      const port = await listen(server, address.port, "127.0.0.1");
      return { server, port };
    }, () => false, (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds > 50 ? 50 : milliseconds)));
    setTimeout(() => {
      held.close();
    }, 80);
    const listening = await started;
    assert.equal(listening.port, address.port);
    assert.equal(attempts > 1, true);
    await new Promise<void>((resolve, reject) => {
      listening.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    let stopping = false;
    const waiting = listenWhenPortIsFree(
      async () => {
        throw Object.assign(new Error("busy"), { code: "EADDRINUSE" });
      },
      () => stopping,
      () => new Promise((resolve) => setTimeout(resolve, 20))
    );
    setTimeout(() => {
      stopping = true;
    }, 30);
    await assert.rejects(waiting, (error: NodeJS.ErrnoException) => error.code === "STOPPING");
    await assert.rejects(
      listenWhenPortIsFree(async () => {
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      }, () => false),
      (error: NodeJS.ErrnoException) => error.code === "EACCES"
    );
  });
});
