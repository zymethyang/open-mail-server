import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccountRepository } from "../../../../src/components/account/index.js";
import { AccountRole } from "../../../../src/components/account/enums/accountRole.js";
import { ProtocolSignInFailure } from "../../../../src/components/account/enums/protocolSignInFailure.js";
import { verifyProtocolSignIn } from "../../../../src/components/account/utils/protocolSignIn.js";
import { createOneTimePasswordSecret } from "../../../../src/components/oneTimePassword/index.js";
import { decodeBase32, oneTimePassword } from "../../../../src/components/oneTimePassword/utils/oneTimePasswordCode.js";
import { createTemporaryStorage, removeTemporaryStorage } from "../../../support/temporaryStorage.js";

describe("protocol sign-in", { concurrency: 1 }, () => {
  it("accepts the account password and ignores an authenticator code", async () => {
    const storageDirectory = await createTemporaryStorage();
    try {
      const accounts = new AccountRepository(storageDirectory);
      await accounts.createAccount({
        address: "ada@acme.test",
        displayName: "Ada Admin",
        password: "correct-horse",
        role: AccountRole.Administrator,
        domain: "acme.test"
      });
      const passwordOnly = await verifyProtocolSignIn(accounts, "ada@acme.test", "correct-horse");
      assert.equal(passwordOnly.failure, ProtocolSignInFailure.None);
      assert.equal(passwordOnly.account?.address, "ada@acme.test");
      assert.equal((await verifyProtocolSignIn(accounts, "ada@acme.test", "wrong-horse")).failure, ProtocolSignInFailure.Invalid);

      const secret = createOneTimePasswordSecret();
      await accounts.storePendingOneTimePassword("ada@acme.test", secret);
      const code = oneTimePassword(decodeBase32(secret));
      assert.ok(await accounts.confirmOneTimePassword("ada@acme.test", code));
      const withAuthenticator = await verifyProtocolSignIn(accounts, "ada@acme.test", "correct-horse");
      assert.equal(withAuthenticator.failure, ProtocolSignInFailure.None);
      assert.equal(withAuthenticator.account?.oneTimePasswordEnabled, true);
      assert.equal((await verifyProtocolSignIn(accounts, "ada@acme.test", `correct-horse${code}`)).failure, ProtocolSignInFailure.Invalid);
      assert.equal((await verifyProtocolSignIn(accounts, "ada@acme.test", code)).failure, ProtocolSignInFailure.Invalid);
    } finally {
      await removeTemporaryStorage(storageDirectory);
    }
  });
});
