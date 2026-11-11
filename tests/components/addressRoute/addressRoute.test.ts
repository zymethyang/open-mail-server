import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AddressRouteRepository } from "../../../src/components/addressRoute/index.js";
import { blockedSenderDetail, resolveDeliveryAddress } from "../../../src/components/addressRoute/utils/resolveDeliveryAddress.js";
import type { AddressRoutes } from "../../../src/components/addressRoute/interfaces/addressRoutes.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";
import { statusCodeOf } from "../../support/statusCode.js";

const companyDomain = "acme.test";

function routes(overrides: Partial<AddressRoutes> = {}): AddressRoutes {
  return {
    domains: [],
    aliases: [],
    lists: [],
    catchAllMailboxes: [],
    blockedSenders: [],
    blockedDomains: [],
    blockedRemoteAddresses: [],
    ...overrides
  };
}

describe("address routes", () => {
  it("saves domains, aliases, lists, catch-all mailboxes, and blocked senders", async () => {
    const storageDirectory = await createTemporaryStorage();
    const repository = new AddressRouteRepository(storageDirectory);
    try {
      assert.deepEqual(await repository.read(), routes());
      await repository.addDomain("example.com", companyDomain);
      await repository.addDomain("Example.com", companyDomain);
      await assert.rejects(() => repository.addDomain("acme.test", companyDomain), (error: unknown) => statusCodeOf(error) === 400);
      await assert.rejects(() => repository.addDomain("not a domain", companyDomain), (error: unknown) => statusCodeOf(error) === 400);

      await repository.addAlias({ address: "Sales@acme.test", mailboxAddress: "ada@acme.test" }, companyDomain);
      await assert.rejects(
        () => repository.addAlias({ address: "sales@acme.test", mailboxAddress: "bea@acme.test" }, companyDomain),
        (error: unknown) => statusCodeOf(error) === 400 && (error as Error).message.includes("already in use")
      );
      await assert.rejects(
        () => repository.addAlias({ address: "ada@acme.test", mailboxAddress: "ada@acme.test" }, companyDomain),
        (error: unknown) => statusCodeOf(error) === 400
      );
      await assert.rejects(
        () => repository.addAlias({ address: "sales@other.test", mailboxAddress: "ada@acme.test" }, companyDomain),
        (error: unknown) => statusCodeOf(error) === 400 && (error as Error).message.includes("Add other.test")
      );

      await repository.addList({ address: "team@example.com", mailboxAddresses: ["ada@acme.test", "Ada@acme.test", "bea@acme.test"] }, companyDomain);
      await assert.rejects(
        () => repository.addList({ address: "empty@acme.test", mailboxAddresses: [] }, companyDomain),
        (error: unknown) => statusCodeOf(error) === 400
      );
      await repository.addCatchAll({ domain: "acme.test", mailboxAddress: "ada@acme.test" }, companyDomain);
      await repository.addCatchAll({ domain: "example.com", mailboxAddress: "bea@acme.test" }, companyDomain);
      await repository.addBlockedSender("Spam@bad.test");
      await repository.addBlockedSender("bad.test");
      await repository.addBlockedSender("203.0.113.10");
      await repository.addBlockedSender("203.0.113.10");

      const saved = await repository.read();
      assert.deepEqual(saved.domains, ["example.com"]);
      assert.deepEqual(saved.aliases, [{ address: "sales@acme.test", mailboxAddress: "ada@acme.test" }]);
      assert.deepEqual(saved.lists, [{ address: "team@example.com", mailboxAddresses: ["ada@acme.test", "bea@acme.test"] }]);
      assert.deepEqual(saved.catchAllMailboxes, [
        { domain: "acme.test", mailboxAddress: "ada@acme.test" },
        { domain: "example.com", mailboxAddress: "bea@acme.test" }
      ]);
      assert.deepEqual(saved.blockedSenders, ["spam@bad.test"]);
      assert.deepEqual(saved.blockedDomains, ["bad.test"]);
      assert.deepEqual(saved.blockedRemoteAddresses, ["203.0.113.10"]);

      await repository.removeAlias("sales@acme.test");
      await repository.removeList("team@example.com");
      await repository.removeCatchAll("example.com");
      await repository.removeBlockedSender("spam@bad.test");
      await repository.removeBlockedSender("bad.test");
      await repository.removeBlockedSender("::ffff:203.0.113.10");
      await repository.removeDomain("example.com");
      const cleared = await repository.read();
      assert.deepEqual(cleared.domains, []);
      assert.deepEqual(cleared.aliases, []);
      assert.deepEqual(cleared.lists, []);
      assert.deepEqual(cleared.catchAllMailboxes, [{ domain: "acme.test", mailboxAddress: "ada@acme.test" }]);
      assert.deepEqual(cleared.blockedSenders, []);
      assert.deepEqual(cleared.blockedDomains, []);
      assert.deepEqual(cleared.blockedRemoteAddresses, []);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });

  it("removes addresses that belong to a removed domain", async () => {
    const storageDirectory = await createTemporaryStorage();
    const repository = new AddressRouteRepository(storageDirectory);
    try {
      await repository.addDomain("example.com", companyDomain);
      await repository.addAlias({ address: "sales@example.com", mailboxAddress: "ada@acme.test" }, companyDomain);
      await repository.addList({ address: "team@example.com", mailboxAddresses: ["ada@acme.test"] }, companyDomain);
      await repository.addCatchAll({ domain: "example.com", mailboxAddress: "ada@acme.test" }, companyDomain);
      await repository.removeDomain("example.com");
      const saved = await repository.read();
      assert.deepEqual(saved.aliases, []);
      assert.deepEqual(saved.lists, []);
      assert.deepEqual(saved.catchAllMailboxes, []);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });
});

describe("delivery address resolution", () => {
  const mailboxes = new Set(["ada@acme.test", "bea@acme.test"]);
  const mailboxExists = async (address: string) => mailboxes.has(address);

  it("keeps an exact mailbox ahead of an alias, a list, and a catch-all", async () => {
    const saved = routes({
      aliases: [{ address: "ada@acme.test", mailboxAddress: "bea@acme.test" }],
      lists: [{ address: "ada@acme.test", mailboxAddresses: ["bea@acme.test"] }],
      catchAllMailboxes: [{ domain: "acme.test", mailboxAddress: "bea@acme.test" }]
    });
    assert.deepEqual(await resolveDeliveryAddress("Ada@acme.test", companyDomain, saved, mailboxExists), {
      kind: "mailboxes",
      mailboxAddresses: ["ada@acme.test"]
    });
  });

  it("resolves an alias, a list, a catch-all, a missing mailbox, and an outside domain", async () => {
    const saved = routes({
      domains: ["example.com"],
      aliases: [{ address: "sales@acme.test", mailboxAddress: "ada@acme.test" }],
      lists: [{ address: "team@example.com", mailboxAddresses: ["ada@acme.test", "bea@acme.test", "gone@acme.test"] }],
      catchAllMailboxes: [{ domain: "example.com", mailboxAddress: "bea@acme.test" }]
    });
    assert.deepEqual(await resolveDeliveryAddress("sales@acme.test", companyDomain, saved, mailboxExists), {
      kind: "mailboxes",
      mailboxAddresses: ["ada@acme.test"]
    });
    assert.deepEqual(await resolveDeliveryAddress("team@example.com", companyDomain, saved, mailboxExists), {
      kind: "mailboxes",
      mailboxAddresses: ["ada@acme.test", "bea@acme.test"]
    });
    assert.deepEqual(await resolveDeliveryAddress("unknown@example.com", companyDomain, saved, mailboxExists), {
      kind: "mailboxes",
      mailboxAddresses: ["bea@acme.test"]
    });
    assert.deepEqual(await resolveDeliveryAddress("unknown@acme.test", companyDomain, saved, mailboxExists), { kind: "missing" });
    assert.deepEqual(await resolveDeliveryAddress("person@elsewhere.test", companyDomain, saved, mailboxExists), { kind: "external" });
    assert.deepEqual(
      await resolveDeliveryAddress("sales@acme.test", companyDomain, saved, async () => false),
      { kind: "missing" }
    );
  });

  it("names a blocked sender, domain, and remote address", () => {
    const saved = routes({
      blockedSenders: ["spam@bad.test"],
      blockedDomains: ["bad.test"],
      blockedRemoteAddresses: ["203.0.113.10"]
    });
    assert.equal(blockedSenderDetail(saved, "Spam@bad.test", ""), "The sender is blocked");
    assert.equal(blockedSenderDetail(saved, "ada@bad.test", ""), "The sender domain is blocked");
    assert.equal(blockedSenderDetail(saved, "ada@acme.test", "::ffff:203.0.113.10"), "The sending address is blocked");
    assert.equal(blockedSenderDetail(saved, "ada@acme.test", "198.51.100.20"), "");
  });
});
