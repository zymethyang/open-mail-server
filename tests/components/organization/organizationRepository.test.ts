import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { writeJson } from "../../../src/components/jsonFile/index.js";
import { OrganizationRepository } from "../../../src/components/organization/index.js";
import type { OrganizationRepository as OrganizationRepositoryContract } from "../../../src/components/organization/interfaces/organizationRepository.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../support/temporaryStorage.js";
import { statusCodeOf } from "../../support/statusCode.js";

describe("organization repository interface", () => {
  it("creates one company domain and ignores an invalid stored record", async () => {
    const storageDirectory = await createTemporaryStorage();
    const repository: OrganizationRepositoryContract = new OrganizationRepository(storageDirectory);
    try {
      assert.equal(await repository.read(), null);
      await assert.rejects(
        () => repository.create({ domain: "not a domain", displayName: "Acme", requiredDomain: "" }),
        (error: unknown) => statusCodeOf(error) === 400
      );
      await assert.rejects(
        () => repository.create({ domain: "example.test", displayName: "Acme", requiredDomain: "acme.test" }),
        (error: unknown) => statusCodeOf(error) === 400 && (error as Error).message.includes("acme.test")
      );
      await assert.rejects(
        () => repository.create({ domain: "acme.test", displayName: "   ", requiredDomain: "acme.test" }),
        (error: unknown) => statusCodeOf(error) === 400
      );

      const created = await repository.create({ domain: "  ACME.TEST ", displayName: "Acme\nCompany", requiredDomain: "acme.test" });
      assert.equal(created.domain, "acme.test");
      assert.equal(created.displayName, "Acme Company");
      assert.equal((await repository.read())?.domain, "acme.test");
      await assert.rejects(
        () => repository.create({ domain: "acme.test", displayName: "Again", requiredDomain: "" }),
        (error: unknown) => statusCodeOf(error) === 409
      );
      await repository.remove();
      assert.equal(await repository.read(), null);

      await writeJson(path.join(storageDirectory, "organization.json"), { domain: "not a domain", displayName: "Broken" });
      assert.equal(await repository.read(), null);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });
});
