import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayedImageType } from "../../../src/components/web/utils/displayedImageType.js";

describe("displayed image type", () => {
  it("recognizes image media types and image file names", () => {
    assert.equal(displayedImageType("image/png; name=IMG_4172.PNG", "IMG_4172.PNG"), "image/png");
    assert.equal(displayedImageType("image/jpg", "photo.jpg"), "image/jpeg");
    assert.equal(displayedImageType("application/octet-stream", "IMG_4172.PNG"), "image/png");
    assert.equal(displayedImageType("application/octet-stream", "notes.txt"), "");
  });
});
