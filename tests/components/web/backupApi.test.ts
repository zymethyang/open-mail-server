import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { endRestore, tryBeginRestore } from "../../../src/components/backup/index.js";
import { requestJson, startWebConsole } from "../../support/webConsole.js";

describe("backup admin api", () => {
  it("lets an administrator create, list, delete, and restore with stamp validation", async () => {
    let restartRequested = 0;
    const consoleServer = await startWebConsole({
      requestProcessRestart() {
        restartRequested += 1;
      }
    });
    try {
      const setup = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
        organizationName: "Acme",
        domain: "acme.test",
        publicAddress: "203.0.113.10",
        displayName: "Ada Admin",
        address: "ada@acme.test",
        password: "correct-horse"
      });
      assert.equal(setup.status, 201);
      await writeFile(path.join(consoleServer.storageDirectory, "storage-key"), Buffer.alloc(32, 3));
      const created = await requestJson(consoleServer.baseUrl, "POST", "/api/admin/backup", undefined, setup.cookieHeader);
      assert.equal(created.status, 201);
      const backupName = String(created.payload.backupName);
      await writeFile(path.join(consoleServer.storageDirectory, "backups", "notes.txt"), Buffer.from("skip"));
      await mkdir(path.join(consoleServer.storageDirectory, "backups", "not-a-stamp"), { recursive: true });
      const listed = await requestJson(consoleServer.baseUrl, "GET", "/api/admin/backup", undefined, setup.cookieHeader);
      assert.equal(listed.status, 200);
      assert.deepEqual(listed.payload.backups, [backupName]);

      for (const invalid of [".", "..", "../outside", "a/b", "not-a-stamp"]) {
        const rejectedRestore = await requestJson(
          consoleServer.baseUrl,
          "POST",
          "/api/admin/backup/restore",
          { backupName: invalid },
          setup.cookieHeader
        );
        assert.equal(rejectedRestore.status, 400, invalid);
        const rejectedDelete = await requestJson(
          consoleServer.baseUrl,
          "DELETE",
          "/api/admin/backup",
          { backupName: invalid },
          setup.cookieHeader
        );
        assert.equal(rejectedDelete.status, 400, invalid);
      }
      assert.deepEqual(await readFile(path.join(consoleServer.storageDirectory, "storage-key")), Buffer.alloc(32, 3));
      assert.deepEqual(
        (await requestJson(consoleServer.baseUrl, "GET", "/api/admin/backup", undefined, setup.cookieHeader)).payload.backups,
        [backupName]
      );

      const kept = await requestJson(consoleServer.baseUrl, "POST", "/api/admin/backup", undefined, setup.cookieHeader);
      assert.equal(kept.status, 201);
      const keptName = String(kept.payload.backupName);
      const deleted = await requestJson(
        consoleServer.baseUrl,
        "DELETE",
        "/api/admin/backup",
        { backupName },
        setup.cookieHeader
      );
      assert.equal(deleted.status, 200);
      assert.equal(deleted.payload.deleted, true);
      assert.equal(deleted.payload.backupName, backupName);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(restartRequested, 0);
      assert.deepEqual(await readFile(path.join(consoleServer.storageDirectory, "storage-key")), Buffer.alloc(32, 3));
      const afterDelete = await requestJson(consoleServer.baseUrl, "GET", "/api/admin/backup", undefined, setup.cookieHeader);
      assert.deepEqual(afterDelete.payload.backups, [keptName]);

      const restored = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/admin/backup/restore",
        { backupName: keptName },
        setup.cookieHeader
      );
      assert.equal(restored.status, 200);
      assert.equal(restored.payload.restarting, true);
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(restartRequested, 1);
    } finally {
      await consoleServer.stop();
    }
  });

  it("rejects create, restore, and delete while a restore lock is held", async () => {
    const consoleServer = await startWebConsole();
    try {
      const setup = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
        organizationName: "Acme",
        domain: "acme.test",
        publicAddress: "203.0.113.10",
        displayName: "Ada Admin",
        address: "ada@acme.test",
        password: "correct-horse"
      });
      assert.equal(setup.status, 201);
      const created = await requestJson(consoleServer.baseUrl, "POST", "/api/admin/backup", undefined, setup.cookieHeader);
      assert.equal(created.status, 201);
      assert.equal(tryBeginRestore(), true);
      try {
        const createBlocked = await requestJson(consoleServer.baseUrl, "POST", "/api/admin/backup", undefined, setup.cookieHeader);
        assert.equal(createBlocked.status, 409);
        assert.equal(createBlocked.payload.error, "A restore is already in progress");
        const restoreBlocked = await requestJson(
          consoleServer.baseUrl,
          "POST",
          "/api/admin/backup/restore",
          { backupName: created.payload.backupName },
          setup.cookieHeader
        );
        assert.equal(restoreBlocked.status, 409);
        const deleteBlocked = await requestJson(
          consoleServer.baseUrl,
          "DELETE",
          "/api/admin/backup",
          { backupName: created.payload.backupName },
          setup.cookieHeader
        );
        assert.equal(deleteBlocked.status, 409);
      } finally {
        endRestore();
      }
    } finally {
      endRestore();
      await consoleServer.stop();
    }
  });

  it("rejects member and anonymous backup mutations and keeps session delete working", async () => {
    const consoleServer = await startWebConsole();
    try {
      const setup = await requestJson(consoleServer.baseUrl, "POST", "/api/setup", {
        organizationName: "Acme",
        domain: "acme.test",
        publicAddress: "203.0.113.10",
        displayName: "Ada Admin",
        address: "ada@acme.test",
        password: "correct-horse"
      });
      assert.equal(setup.status, 201);
      const member = await requestJson(
        consoleServer.baseUrl,
        "POST",
        "/api/admin/mailboxes",
        { address: "bea@acme.test", displayName: "Bea Member", password: "member-horse" },
        setup.cookieHeader
      );
      assert.equal(member.status, 201);
      const memberSession = await requestJson(consoleServer.baseUrl, "POST", "/api/session", {
        address: "bea@acme.test",
        password: "member-horse"
      });
      assert.equal(memberSession.status, 200);
      const cookie = memberSession.cookieHeader;
      for (const request of [
        { method: "GET", pathName: "/api/admin/backup" },
        { method: "POST", pathName: "/api/admin/backup" },
        { method: "DELETE", pathName: "/api/admin/backup", body: { backupName: "2026-11-11T12-00-00-000Z" } },
        { method: "POST", pathName: "/api/admin/backup/restore", body: { backupName: "2026-11-11T12-00-00-000Z" } }
      ]) {
        const response = await requestJson(consoleServer.baseUrl, request.method, request.pathName, request.body, cookie);
        assert.equal(response.status, 403, request.method);
        assert.equal(response.payload.error, "Administrator access is required");
      }
      for (const request of [
        { method: "GET", pathName: "/api/admin/backup" },
        { method: "POST", pathName: "/api/admin/backup" },
        { method: "DELETE", pathName: "/api/admin/backup", body: { backupName: "2026-11-11T12-00-00-000Z" } },
        { method: "POST", pathName: "/api/admin/backup/restore", body: { backupName: "2026-11-11T12-00-00-000Z" } }
      ]) {
        const response = await requestJson(consoleServer.baseUrl, request.method, request.pathName, request.body);
        assert.equal(response.status, 401, request.method);
      }
      const retired = await requestJson(consoleServer.baseUrl, "GET", "/api/backup");
      assert.equal(retired.status, 404);
      const crossSite = await requestJson(
        consoleServer.baseUrl,
        "DELETE",
        "/api/admin/backup",
        { backupName: "2026-11-11T12-00-00-000Z" },
        setup.cookieHeader,
        { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.test" }
      );
      assert.equal(crossSite.status, 403);
      assert.equal(crossSite.payload.error, "Origin is not allowed");
      const signedOut = await requestJson(consoleServer.baseUrl, "DELETE", "/api/session", undefined, cookie);
      assert.equal(signedOut.status, 200);
    } finally {
      await consoleServer.stop();
    }
  });
});
