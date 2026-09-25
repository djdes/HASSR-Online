import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PfJobResult } from "@/lib/ai-assistant/pf-client";
import { shouldRetryWrongWorker, VISION_WRONG_WORKER_RETRIES } from "@/lib/ai-vision/retry";

const wrongWorker: PfJobResult = { ok: false, code: "job_failed", error: "x", workerError: "wrong_worker:wesetup_vision_extract" };

describe("shouldRetryWrongWorker", () => {
  it("повторяет, когда задание закрыл воркер без поддержки фото", () => {
    assert.equal(shouldRetryWrongWorker(wrongWorker, 1, 90_000), true);
  });

  it("не повторяет удачный ответ и другие ошибки", () => {
    assert.equal(shouldRetryWrongWorker({ ok: true, text: "{}", jobId: "j" }, 1, 90_000), false);
    assert.equal(shouldRetryWrongWorker({ ok: false, code: "timeout", error: "x" }, 1, 90_000), false);
    assert.equal(shouldRetryWrongWorker({ ok: false, code: "job_failed", error: "x", workerError: "claude:timeout" }, 1, 90_000), false);
    assert.equal(shouldRetryWrongWorker({ ok: false, code: "job_failed", error: "x" }, 1, 90_000), false);
  });

  it("останавливается по числу попыток и по времени", () => {
    assert.equal(shouldRetryWrongWorker(wrongWorker, VISION_WRONG_WORKER_RETRIES, 90_000), true);
    assert.equal(shouldRetryWrongWorker(wrongWorker, VISION_WRONG_WORKER_RETRIES + 1, 90_000), false);
    assert.equal(shouldRetryWrongWorker(wrongWorker, 1, 10_000), false);
  });
});
