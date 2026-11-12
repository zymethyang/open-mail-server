import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ServiceName } from "../../../src/components/emailServer/enums/serviceName.js";
import { serviceNames } from "../../../src/components/emailServer/serviceNames.js";
import { WorkerMessageKind } from "../../../src/components/emailServer/enums/workerMessageKind.js";
import { ProtocolSignInFailure } from "../../../src/components/account/enums/protocolSignInFailure.js";
import { JsonTransactionSuffix } from "../../../src/components/jsonFile/enums/jsonTransactionSuffix.js";
import { FlagStoreMode } from "../../../src/components/imap/enums/flagStoreMode.js";

describe("release contracts", () => {
  it("starts each mail service in its own worker", () => {
    assert.deepEqual(serviceNames, [
      ServiceName.Smtp,
      ServiceName.Imap,
      ServiceName.Pop3,
      ServiceName.Web,
      ServiceName.Queue
    ]);
    assert.equal(new Set(serviceNames).size, serviceNames.length);
  });

  it("names every message exchanged by the workers", () => {
    const kinds = Object.values(WorkerMessageKind);
    assert.deepEqual(kinds, [
      WorkerMessageKind.ResolveMailExchange,
      WorkerMessageKind.ParentResponse,
      WorkerMessageKind.Listening,
      WorkerMessageKind.Listeners,
      WorkerMessageKind.Ready,
      WorkerMessageKind.Failed,
      WorkerMessageKind.Stop,
      WorkerMessageKind.ShutdownRequested
    ]);
    assert.equal(new Set(kinds).size, kinds.length);
  });

  it("keeps protocol sign-in, flag changes, and json saves on named values", () => {
    assert.deepEqual(Object.values(ProtocolSignInFailure), [ProtocolSignInFailure.None, ProtocolSignInFailure.Invalid]);
    assert.deepEqual(Object.values(FlagStoreMode), [FlagStoreMode.Add, FlagStoreMode.Remove, FlagStoreMode.Replace]);
    assert.equal(JsonTransactionSuffix.Temporary, ".temporary");
    assert.equal(JsonTransactionSuffix.Backup, ".backup");
  });
});
