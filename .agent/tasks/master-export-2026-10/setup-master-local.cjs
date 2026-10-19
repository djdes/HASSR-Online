// Только локальная wesetup_integ: мастер-кабинет «Мастер-кабинет Школы» (kind=directory),
// пользователь master@haccp.local (пароль как у admin@haccp.local — admin1234),
// в пуле — «Столовая «Берёзка»» и «Кафе «Одна точка»». Повторный запуск ничего не дублирует.
const { Client } = require("pg");
const URL = "postgresql://postgres:postgres@localhost:5432/wesetup_integ";
const CODE = "MSTRX-TEST1";
(async () => {
  if (!URL.endsWith("/wesetup_integ")) throw new Error("не та база");
  const c = new Client({ connectionString: URL });
  await c.connect();
  await c.query("begin");
  const admin = (await c.query(`select "passwordHash", "legalVersion" from "User" where email = 'admin@haccp.local'`)).rows[0];
  let cab = (await c.query(`select id from "Organization" where "serviceCode" = $1`, [CODE])).rows[0];
  if (!cab) {
    cab = (await c.query(
      `insert into "Organization" (id, name, kind, type, "serviceCode", "createdAt", "updatedAt") select 'mx-cabinet', 'Мастер-кабинет Школы', 'directory', type, $1, now(), now() from "Organization" where id = 'cmvbfyemt0000uw9mywdjiurr' returning id`,
      [CODE]
    )).rows[0];
  }
  const user = (await c.query(`select id from "User" where email = 'master@haccp.local'`)).rows[0];
  if (!user) {
    await c.query(
      `insert into "User" (id, email, name, "passwordHash", role, "organizationId", "isActive", "legalVersion", "createdAt") values ('mx-user', 'master@haccp.local', 'Мастер Тестовый', $1, 'manager', $2, true, $3, now())`,
      [admin.passwordHash, cab.id, admin.legalVersion]
    );
  }
  const linked = await c.query(
    `update "Organization" set "linkedServiceCode" = $1 where id in ('cmvbfyemt0000uw9mywdjiurr', 'fx-org-single') returning name`,
    [CODE]
  );
  await c.query("commit");
  console.log("cabinet", cab.id, "pool:", linked.rows.map((r) => r.name).join(", "));
  await c.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
