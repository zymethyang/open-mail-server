import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contentTypes } from "../../../../src/components/web/constants/contentTypes.js";

describe("content types", () => {
  it("keeps the values written for the web console files", () => {
    assert.equal(contentTypes[".html"], "text/html; charset=utf-8");
    assert.equal(contentTypes[".css"], "text/css; charset=utf-8");
    assert.equal(contentTypes[".js"], "text/javascript; charset=utf-8");
  });
});
