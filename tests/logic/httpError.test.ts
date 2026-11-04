import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpError } from "../../src/components/httpError/index.js";

describe("http error logic", () => {
  it("keeps the status code on the error", () => {
    const error = new HttpError(404, "Not found");
    assert.equal(error.name, "HttpError");
    assert.equal(error.message, "Not found");
    assert.equal(error.statusCode, 404);
    assert.equal(error instanceof Error, true);
  });
});
