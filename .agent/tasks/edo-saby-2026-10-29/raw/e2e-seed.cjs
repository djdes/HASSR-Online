// Подготовка ЛОКАЛЬНОЙ БД wesetup_edo (127.0.0.1:5432, не прод) для e2e ЭДО:
// ROOT-пользователь, клиент с ИНН/КПП, реквизиты ООО «БФС», пустые таблицы ЭДО.
const { Client } = require("pg");
const bcrypt = require("bcryptjs");

const DB = "postgresql://postgres:postgres@127.0.0.1:5432/wesetup_edo";
const ROOT_EMAIL = "dk-admin5@test.local";
const ROOT_PASSWORD = "e2e-root-pass-1";

async function seed() {
  if (!/127\.0\.0\.1:5432\/wesetup_edo$/.test(DB)) throw new Error("only local wesetup_edo");
  const c = new Client({ connectionString: DB });
  await c.connect();
  try {
    const hash = await bcrypt.hash(ROOT_PASSWORD, 10);
    await c.query(`UPDATE "User" SET "isRoot" = true, "passwordHash" = $1, "legalVersion" = '2026-09-30', "isActive" = true WHERE email = $2`, [hash, ROOT_EMAIL]);
    await c.query(
      `UPDATE "Organization" SET inn = '7707083893', kpp = '773601001', "legalFullName" = 'ООО «Доброе кафе»', "isDemo" = false WHERE id = 'org-one'`,
    );
    const requisites = {
      nameFull: "ООО «БФС»",
      nameShort: "ООО «БФС»",
      inn: "5018215599",
      kpp: "501801001",
      // Тестовые значения только для локальной БД: полный комплект нужен, чтобы выпускался УПД.
      ogrn: "1000000000000",
      address: "141000, Московская обл., тестовый адрес, д. 1",
      bank: { name: "Тестовый банк", bik: "044525000", account: "40702810000000000000", corrAccount: "30101810000000000000" },
      head: { post: "Генеральный директор", name: "Тестов Тест Тестович" },
      vatMode: "none",
      email: "",
      phone: "",
      facsimileFile: "facsimile.png",
      stampFile: "stamp.png",
      updatedAt: new Date().toISOString(),
    };
    await c.query(
      `INSERT INTO "PlatformSetting" (key, value, "updatedAt") VALUES ('legal.requisites', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = now()`,
      [JSON.stringify(requisites)],
    );
    await c.query(`DELETE FROM "EdoDocument"`);
    await c.query(`DELETE FROM "EdoCabinet"`);
    // Счёт по безналу (пополнение баланса) и оплаченный заказ — для отправки счёта и УПД.
    await c.query(`DELETE FROM "ClosingDocument" WHERE "orderId" IN (SELECT id FROM "PaymentOrder" WHERE email = 'edo-e2e@test.local')`);
    await c.query(`DELETE FROM "PaymentOrder" WHERE email = 'edo-e2e@test.local'`);
    await c.query(
      `INSERT INTO "PaymentOrder" (email, "tariffKey", "amountRub", description, status, "organizationId", "paymentMethod", "invoiceDueAt")
       VALUES ('edo-e2e@test.local', 'balance_topup', 1500, 'Пополнение баланса', 'pending', 'org-one', 'invoice', now() + interval '5 days')`,
    );
    await c.query(
      `INSERT INTO "PaymentOrder" (email, "tariffKey", "amountRub", description, status, "organizationId", "paymentMethod", "paidAt")
       VALUES ('edo-e2e@test.local', 'balance_topup', 2500, 'Пополнение баланса', 'paid', 'org-one', 'card', now())`,
    );
  } finally {
    await c.end();
  }
}

async function readCabinetRow() {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query(`SELECT "clientId", "appSecretEnc", "sessionEnc", status FROM "EdoCabinet"`)).rows;
  } finally {
    await c.end();
  }
}

module.exports = { seed, readCabinetRow, ROOT_EMAIL, ROOT_PASSWORD };

if (require.main === module) {
  seed().then(() => console.log("seeded"), (e) => {
    console.error(e);
    process.exit(1);
  });
}
