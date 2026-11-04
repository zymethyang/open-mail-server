import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authenticatorImage, authenticatorModules, errorCorrectionCodewords } from "../../src/components/oneTimePassword/utils/authenticatorImage.js";
import { codeVersions } from "../../src/components/oneTimePassword/constants/codeVersions.js";

describe("authenticator image logic", () => {
  it("builds a square code with the finder pattern and an image", () => {
    const modules = authenticatorModules("hi");
    assert.equal(modules.length, modules[0].length);
    assert.equal(modules[0][0], true);
    assert.equal(modules[0][modules.length - 1], true);
    const image = authenticatorImage("otpauth://totp/Email%20Server:ada@acme.test?secret=SECRET");
    assert.equal(image.startsWith("<svg "), true);
    assert.equal(image.includes("</svg>"), true);
    assert.equal(image.includes("fill=\"#0f172a\""), true);
  });

  it("returns a stable error-correction block of the requested size", () => {
    const first = errorCorrectionCodewords([1, 2, 3, 4], 10);
    const second = errorCorrectionCodewords([1, 2, 3, 4], 10);
    assert.equal(first.length, 10);
    assert.deepEqual(second, first);
    assert.notDeepEqual(errorCorrectionCodewords([1, 2, 3, 5], 10), first);
    assert.equal(codeVersions.length, 10);
    assert.equal(codeVersions[0].version, 1);
    assert.equal(codeVersions[9].version, 10);
  });
});
