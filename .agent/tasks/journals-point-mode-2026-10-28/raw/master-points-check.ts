// Мастер-кабинет: у каждой точки свой код журнала бракеража, выгрузка — по точкам.
// Проверка на e2e-базе (не прод): коды точек, подключение по коду точки (как
// `POST /api/master/objects` с confirm), объекты пула и привязка точек.
import { readFileSync, writeFileSync } from "node:fs";
import { db } from "@/lib/db";
import { ensureServiceCode, getDishPoolInfo } from "@/lib/dish-pool";
import { isPoolObjectInPool, listPoolOrganizations, masterPoolCode, MASTER_ORG_KIND } from "@/lib/master-directory";

const dir = ".agent/tasks/journals-point-mode-2026-10-28/raw";

async function main() {
  if (!(process.env.DATABASE_URL ?? "").includes("localhost:5432/wesetup_e2e")) throw new Error("e2e only");
  const seed = JSON.parse(readFileSync(".agent/tasks/qr-point-roster-uv-2026-10/raw/seed.json", "utf8"));
  const out: string[] = [];
  const check = (name: string, ok: boolean, detail = "") => out.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);

  const points = await db.building.findMany({ where: { organizationId: seed.orgId, kind: { not: "office" } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const orgCode = await ensureServiceCode(seed.orgId);
  const infos = await Promise.all(points.map((point) => getDishPoolInfo(seed.orgId, point.id)));
  const codes = infos.map((info) => info.ownCode);
  check("у каждой точки свой код", new Set(codes).size === points.length, codes.join(", "));
  check("код точки не равен коду организации", !codes.includes(orgCode), `организация ${orgCode}`);
  check("в настройках журнала на точке — название точки", infos.every((info, index) => info.pointName === points[index].name));

  // Вторая организация с одной точкой — «независимо от организации».
  const stamp = Date.now().toString(36);
  const master = await db.organization.create({ data: { name: `Мастер ${stamp}`, type: "school", kind: MASTER_ORG_KIND } as never });
  const other = await db.organization.create({ data: { name: `Школа ${stamp}`, type: "school", perLocationJournals: true } as never });
  const [otherA, otherB] = await Promise.all([
    db.building.create({ data: { organizationId: other.id, name: "Корпус 1", sortOrder: 0 } }),
    db.building.create({ data: { organizationId: other.id, name: "Корпус 2", sortOrder: 1 } }),
  ]);
  try {
    await ensureServiceCode(master.id);
    const poolCode = (await masterPoolCode(master.id))!;
    const otherCode = (await getDishPoolInfo(other.id, otherA.id)).ownCode;
    // Подключение по коду точки — то же, что делает API: привязка точки к пулу.
    const connect = async (code: string) => {
      const building = await db.building.findUnique({ where: { serviceCode: code }, select: { id: true } });
      if (!building) throw new Error(`код ${code} не найден среди точек`);
      await db.building.update({ where: { id: building.id }, data: { linkedServiceCode: poolCode } });
    };
    await connect(codes[0]);
    await connect(codes[1]);
    await connect(otherCode);
    const objects = await listPoolOrganizations(master.id);
    check(
      "кабинет видит три точки отдельными объектами (две — одной организации)",
      objects.length === 3 && objects.every((object) => object.buildingId),
      objects.map((object) => object.name).join(" | "),
    );
    check("вторая точка той же организации подключилась (раньше — «уже подключён»)", objects.filter((object) => object.organizationId === seed.orgId).length === 2);
    check("корпус 2 второй школы не подключён — у него свой код", !objects.some((object) => object.buildingId === otherB.id));
    const inPool = await Promise.all(objects.map((object) => isPoolObjectInPool(object, poolCode)));
    check("выгрузка и исправления видят каждую точку в пуле", inPool.every(Boolean));
  } finally {
    await db.building.updateMany({ where: { organizationId: seed.orgId }, data: { linkedServiceCode: null } });
    await db.building.deleteMany({ where: { organizationId: other.id } });
    await db.organization.deleteMany({ where: { id: { in: [other.id, master.id] } } });
  }
  writeFileSync(`${dir}/master-points-check.txt`, out.join("\n") + "\n");
  console.log(out.join("\n"));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
