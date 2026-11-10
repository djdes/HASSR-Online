import assert from "node:assert/strict";
import { test } from "node:test";

import { photoMark, photoSlotsOf, withPhotoLinks } from "./photo-slots";

test("slots are found anywhere in the body, joined lists included", () => {
  const body = { token: "t", photo: photoMark("reading"), values: { note: "ок", shots: `${photoMark("field:shots#0")},${photoMark("field:shots#1")}` } };
  assert.deepEqual(photoSlotsOf(body), ["field:shots#0", "field:shots#1", "reading"]);
  assert.deepEqual(photoSlotsOf({ temperature: 4 }), []);
});

test("markers become links; other values are untouched", () => {
  const body = { photo: photoMark("reading"), values: { shots: `${photoMark("field:shots#0")},${photoMark("field:shots#1")}`, temp: 4, ok: true, note: "a,b" } };
  const out = withPhotoLinks(body, { reading: "/uploads/readings/r.jpg", "field:shots#0": "/uploads/a.jpg", "field:shots#1": "/uploads/b.jpg" });
  assert.deepEqual(out, { photo: "/uploads/readings/r.jpg", values: { shots: "/uploads/a.jpg,/uploads/b.jpg", temp: 4, ok: true, note: "a,b" } });
  // The original body keeps its markers — a retry substitutes again.
  assert.equal(body.photo, photoMark("reading"));
});

test("a marker without a link is left as is, so it is visible that the photo is missing", () => {
  assert.deepEqual(withPhotoLinks({ photo: photoMark("reading") }, {}), { photo: photoMark("reading") });
});
