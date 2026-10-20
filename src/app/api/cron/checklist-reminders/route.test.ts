import assert from "node:assert/strict";
import test from "node:test";

// Секрет задан: без него маршрут ответил бы 503 «не настроено», а не 401.
process.env.CRON_SECRET = "checklist-reminders-test-secret";

test("напоминания о чек-листах: без секрета и с чужим секретом — 401, до базы не доходит", async () => {
  const { GET, POST } = await import("./route");
  const bare = await GET(new Request("http://local/api/cron/checklist-reminders?dryRun=1"));
  assert.equal(bare.status, 401);
  const wrong = await POST(
    new Request("http://local/api/cron/checklist-reminders", { method: "POST", headers: { Authorization: "Bearer nope" } }),
  );
  assert.equal(wrong.status, 401);
  const wrongQuery = await GET(new Request("http://local/api/cron/checklist-reminders?secret=nope&dryRun=1"));
  assert.equal(wrongQuery.status, 401);
});
