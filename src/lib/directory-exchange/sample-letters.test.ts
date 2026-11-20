import assert from "node:assert/strict";
import test from "node:test";

import {
  SAMPLE_CABINET_NAME,
  SAMPLE_LETTER_SUBJECT_PREFIX,
  SAMPLE_REQUESTER_NAME,
  sampleExchangeLetters,
} from "@/lib/directory-exchange/sample-letters";

const NOW = new Date("2026-11-20T10:00:00.000Z");

test("sampleExchangeLetters: both letters, marked as a check, with made-up names and the cabinet link", () => {
  const letters = sampleExchangeLetters("https://wesetup.ru/", NOW);
  assert.deepEqual(
    letters.map((sample) => sample.kind),
    ["request", "decision"],
  );
  for (const { letter } of letters) {
    assert.ok(letter.subject.startsWith(SAMPLE_LETTER_SUBJECT_PREFIX), letter.subject);
    assert.ok(letter.body.includes(`«${SAMPLE_CABINET_NAME}»`), "the sample cabinet name");
    assert.ok(letter.body.includes(`«${SAMPLE_REQUESTER_NAME}»`), "the sample organization name");
    assert.ok(letter.body.includes('href="https://wesetup.ru/settings/master-cabinet"'), "one slash between the host and the path");
  }
  assert.equal(letters[0].letter.subject, `[Проверка] Запрос на обмен справочниками от «${SAMPLE_REQUESTER_NAME}»`);
  assert.equal(letters[1].letter.subject, "[Проверка] Запрос на обмен справочниками подтверждён");
  // The title inside the letter stays as in the real one: the mark is only in the subject.
  assert.ok(!letters[0].letter.title.includes(SAMPLE_LETTER_SUBJECT_PREFIX.trim()));
});
