import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { writeJson } from "../../../src/components/jsonFile/index.js";
import { OrganizationRepository } from "../../../src/components/organization/index.js";
import type { OrganizationRepository as OrganizationRepositoryContract } from "../../../src/components/organization/interfaces/organizationRepository.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";
import { statusCodeOf } from "../../support/statusCode.js";

describe("organization repository interface", () => {
  it("stores the public address and administrator email with the company", async () => {
    const storageDirectory = await createTemporaryStorage();
    const repository: OrganizationRepositoryContract = new OrganizationRepository(storageDirectory);
    try {
      assert.equal(await repository.read(), null);
      await assert.rejects(
        () =>
          repository.create({
            domain: "not a domain",
            displayName: "Acme",
            requiredDomain: "",
            publicAddress: "203.0.113.10",
            administratorAddress: "ada@acme.test"
          }),
        (error: unknown) => statusCodeOf(error) === 400
      );
      await assert.rejects(
        () =>
          repository.create({
            domain: "example.test",
            displayName: "Acme",
            requiredDomain: "acme.test",
            publicAddress: "203.0.113.10",
            administratorAddress: "ada@example.test"
          }),
        (error: unknown) => statusCodeOf(error) === 400 && (error as Error).message.includes("acme.test")
      );
      await assert.rejects(
        () =>
          repository.create({
            domain: "acme.test",
            displayName: "   ",
            requiredDomain: "acme.test",
            publicAddress: "203.0.113.10",
            administratorAddress: "ada@acme.test"
          }),
        (error: unknown) => statusCodeOf(error) === 400
      );
      await assert.rejects(
        () =>
          repository.create({
            domain: "acme.test",
            displayName: "Acme",
            requiredDomain: "acme.test",
            publicAddress: "192.168.1.20",
            administratorAddress: "ada@acme.test"
          }),
        (error: unknown) => statusCodeOf(error) === 400 && /public IP address/.test((error as Error).message)
      );
      await assert.rejects(
        () =>
          repository.create({
            domain: "acme.test",
            displayName: "Acme",
            requiredDomain: "acme.test",
            publicAddress: "203.0.113.10",
            administratorAddress: "ada@example.test"
          }),
        (error: unknown) => statusCodeOf(error) === 400 && (error as Error).message.includes("acme.test")
      );

      const created = await repository.create({
        domain: "  ACME.TEST ",
        displayName: "Acme\nCompany",
        requiredDomain: "acme.test",
        publicAddress: " 203.0.113.10 ",
        administratorAddress: " Ada@Acme.Test "
      });
      assert.equal(created.domain, "acme.test");
      assert.equal(created.displayName, "Acme Company");
      assert.equal(created.publicAddress, "203.0.113.10");
      assert.equal(created.administratorAddress, "ada@acme.test");
      const stored = await repository.read();
      assert.equal(stored?.domain, "acme.test");
      assert.equal(stored?.publicAddress, "203.0.113.10");
      assert.equal(stored?.administratorAddress, "ada@acme.test");
      await assert.rejects(
        () =>
          repository.create({
            domain: "acme.test",
            displayName: "Again",
            requiredDomain: "",
            publicAddress: "203.0.113.10",
            administratorAddress: "ada@acme.test"
          }),
        (error: unknown) => statusCodeOf(error) === 409
      );
      await repository.remove();
      assert.equal(await repository.read(), null);

      await writeJson(path.join(storageDirectory, "organization.json"), { domain: "not a domain", displayName: "Broken" });
      assert.equal(await repository.read(), null);
      await writeJson(path.join(storageDirectory, "organization.json"), {
        domain: "acme.test",
        displayName: "Acme",
        publicAddress: "192.168.1.20",
        administratorAddress: "person@example.test",
        createdAt: "2026-11-09T00:00:00.000Z"
      });
      const ignored = await repository.read();
      assert.equal(ignored?.domain, "acme.test");
      assert.equal(ignored?.publicAddress, "");
      assert.equal(ignored?.administratorAddress, "");
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });
});
