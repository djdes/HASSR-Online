import test from "node:test";
import assert from "node:assert/strict";

import { pickSpokenNumber, speechErrorMessage } from "./spoken-number";

test("число берётся из первого варианта, где оно распознаётся", () => {
  assert.deepEqual(pickSpokenNumber(["два и восемь"]), { transcript: "два и восемь", number: 2.8 });
  assert.deepEqual(pickSpokenNumber(["привет", "минус три"]), { transcript: "минус три", number: -3 });
  assert.equal(pickSpokenNumber(["привет", "как дела"]), null);
  assert.equal(pickSpokenNumber([]), null);
  assert.equal(pickSpokenNumber(undefined), null);
});

test("ошибки распознавания — по-русски, без технических кодов и слова «браузер»", () => {
  for (const code of ["not-allowed", "service-not-allowed", "no-speech", "audio-capture", "network", "aborted", "whatever", "Missing permission", "No match", "Didn't understand, please try again."]) {
    const text = speechErrorMessage(code);
    assert.ok(text, code);
    assert.doesNotMatch(text, /[a-z]{3,}/i, `${code}: ${text}`);
    assert.doesNotMatch(text, /браузер/i, `${code}: ${text}`);
  }
  assert.match(speechErrorMessage("not-allowed"), /микрофон/i);
  assert.match(speechErrorMessage("Missing permission"), /микрофон/i);
  assert.match(speechErrorMessage("no-speech"), /Не слышно/);
  assert.match(speechErrorMessage("No match"), /Не слышно/);
});
