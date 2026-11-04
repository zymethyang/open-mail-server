import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { AccountRole } from "../../src/components/account/enums/accountRole.js";
import { AccountRepository } from "../../src/components/account/index.js";
import type { AccountRepository as AccountRepositoryContract } from "../../src/components/account/interfaces/accountRepository.js";
import { readJson, writeJson } from "../../src/components/jsonFile/index.js";
import { decodeBase32, oneTimePassword } from "../../src/components/oneTimePassword/utils/oneTimePasswordCode.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../support/temporaryStorage.js";
import { statusCodeOf } from "../support/statusCode.js";

describe("account repository interface", { concurrency: 1 }, () => {
  let storageDirectory = "";
  let repository: AccountRepositoryContract;

  it("creates, finds, and verifies a mailbox without returning the password", async () => {
    storageDirectory = await createTemporaryStorage();
    repository = new AccountRepository(storageDirectory);
    assert.equal(await repository.hasAccounts(), false);
    await assert.rejects(
      () => repository.createAccount({ address: "ada", displayName: "Ada", password: "correct-horse", role: AccountRole.Administrator, domain: "acme.test" }),
      (error: unknown) => statusCodeOf(error) === 400
    );
    await assert.rejects(
      () =>
        repository.createAccount({
          address: "ada@example.test",
          displayName: "Ada",
          password: "correct-horse",
          role: AccountRole.Administrator,
          domain: "acme.test"
        }),
      (error: unknown) => statusCodeOf(error) === 400 && (error as Error).message.includes("acme.test")
    );
    await assert.rejects(
      () =>
        repository.createAccount({
          address: "ada@acme.test",
          displayName: "   ",
          password: "correct-horse",
          role: AccountRole.Administrator,
          domain: "acme.test"
        }),
      (error: unknown) => statusCodeOf(error) === 400 && (error as Error).message === "Name is required"
    );
    await assert.rejects(
      () =>
        repository.createAccount({
          address: "ada@acme.test",
          displayName: "Ada",
          password: "short",
          role: AccountRole.Administrator,
          domain: "acme.test"
        }),
      (error: unknown) => statusCodeOf(error) === 400
    );
    await assert.rejects(
      () =>
        repository.createAccount({
          address: "ada@acme.test",
          displayName: "Ada",
          password: "x".repeat(201),
          role: AccountRole.Administrator,
          domain: "acme.test"
        }),
      (error: unknown) => statusCodeOf(error) === 400
    );

    const created = await repository.createAccount({
      address: "  <Ada@Acme.Test> ",
      displayName: "Ada\nAdmin",
      password: "correct-horse",
      role: AccountRole.Administrator,
      domain: "acme.test"
    });
    assert.equal(created.address, "ada@acme.test");
    assert.equal(created.displayName, "Ada Admin");
    assert.equal(created.role, AccountRole.Administrator);
    assert.equal(created.disabled, false);
    assert.equal(created.oneTimePasswordEnabled, false);
    assert.equal("passwordHash" in created, false);
    const stored = await readJson<{ accounts: Array<{ passwordHash: string; passwordSalt: string }> }>(path.join(storageDirectory, "accounts.json"));
    assert.equal(typeof stored.accounts[0].passwordHash, "string");
    assert.notEqual(stored.accounts[0].passwordHash, "correct-horse");

    await assert.rejects(
      () =>
        repository.createAccount({
          address: "ada@acme.test",
          displayName: "Ada",
          password: "correct-horse",
          role: AccountRole.Member,
          domain: "acme.test"
        }),
      (error: unknown) => statusCodeOf(error) === 409
    );
    assert.equal(await repository.exists("ADA@acme.test"), true);
    assert.equal((await repository.findAccount("missing@acme.test")), null);
    assert.equal((await repository.verifyCredentials("ada@acme.test", "correct-horse"))?.address, "ada@acme.test");
    assert.equal(await repository.verifyCredentials("ada@acme.test", "wrong-horse"), null);
    assert.equal(await repository.verifyCredentials("missing@acme.test", "correct-horse"), null);
  });

  it("replaces a password and refuses to disable the only administrator", async () => {
    const replaced = await repository.replacePassword("ADA@acme.test", "another-horse");
    assert.equal(replaced.address, "ada@acme.test");
    assert.equal(await repository.verifyCredentials("ada@acme.test", "correct-horse"), null);
    assert.equal((await repository.verifyCredentials("ada@acme.test", "another-horse"))?.address, "ada@acme.test");
    await assert.rejects(() => repository.replacePassword("missing@acme.test", "another-horse"), (error: unknown) => statusCodeOf(error) === 404);
    await assert.rejects(() => repository.setDisabled("ada@acme.test", true), (error: unknown) => statusCodeOf(error) === 409);
    await assert.rejects(() => repository.setDisabled("missing@acme.test", true), (error: unknown) => statusCodeOf(error) === 404);

    const member = await repository.createAccount({
      address: "bea@acme.test",
      displayName: "Bea Member",
      password: "member-horse",
      role: AccountRole.Member,
      domain: "acme.test"
    });
    assert.equal(member.role, AccountRole.Member);
    const disabled = await repository.setDisabled("bea@acme.test", true);
    assert.equal(disabled.disabled, true);
    assert.equal(await repository.verifyCredentials("bea@acme.test", "member-horse"), null);
    const enabled = await repository.setDisabled("bea@acme.test", false);
    assert.equal(enabled.disabled, false);

    await repository.createAccount({
      address: "cam@acme.test",
      displayName: "Cam Admin",
      password: "admin-horse",
      role: AccountRole.Administrator,
      domain: "acme.test"
    });
    const disabledAdministrator = await repository.setDisabled("ada@acme.test", true);
    assert.equal(disabledAdministrator.disabled, true);
    await repository.setDisabled("ada@acme.test", false);
    const accounts = await repository.listAccounts();
    assert.equal(accounts.length, 3);
    assert.equal(accounts.some((account) => "passwordHash" in account), false);
  });

  it("stores a pending authenticator secret until the code is confirmed", async () => {
    const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
    await assert.rejects(() => repository.storePendingOneTimePassword("missing@acme.test", secret), (error: unknown) => statusCodeOf(error) === 404);
    await repository.storePendingOneTimePassword("bea@acme.test", secret);
    await assert.rejects(() => repository.confirmOneTimePassword("ada@acme.test", "000000"), (error: unknown) => statusCodeOf(error) === 400);
    assert.equal(await repository.confirmOneTimePassword("bea@acme.test", "000000"), null);
    assert.equal(await repository.oneTimePasswordMatches("bea@acme.test", "000000"), false);
    const code = oneTimePassword(decodeBase32(secret));
    const confirmed = await repository.confirmOneTimePassword("bea@acme.test", code);
    assert.equal(confirmed?.oneTimePasswordEnabled, true);
    assert.equal(await repository.oneTimePasswordMatches("bea@acme.test", code), true);
    const cleared = await repository.clearOneTimePassword("bea@acme.test");
    assert.equal(cleared.oneTimePasswordEnabled, false);
    assert.equal(await repository.oneTimePasswordMatches("bea@acme.test", code), false);
    await assert.rejects(() => repository.clearOneTimePassword("missing@acme.test"), (error: unknown) => statusCodeOf(error) === 404);
    await removeTemporaryStorage(storageDirectory);
  });

  it("treats an unknown stored role as a member", async () => {
    const directory = await createTemporaryStorage();
    try {
      const accounts = new AccountRepository(directory);
      await accounts.createAccount({
        address: "ada@acme.test",
        displayName: "Ada",
        password: "correct-horse",
        role: AccountRole.Administrator,
        domain: "acme.test"
      });
      const stored = await readJson<{ accounts: Array<{ role: string }> }>(path.join(directory, "accounts.json"));
      stored.accounts[0].role = "owner";
      await writeJson(path.join(directory, "accounts.json"), stored);
      const listed = await accounts.listAccounts();
      assert.equal(listed[0].role, AccountRole.Member);
    } finally {
      await removeTemporaryStorage(directory);
    }
  });
});
