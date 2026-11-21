/*
 * Local stand for one-shot v2: the cases v1 missed.
 *  - «Гимназия»: copy made by the 2026-11-01 repair script (file written long after the org was
 *    created), and the donor uploaded a new logo afterwards — hash no longer matches.
 *  - «Одиночка»: the only organization of its account, logoUrl points to «Доброе кафе»'s file.
 *  - «Столовая»: the person uploaded the same logo — must stay.
 *  - «Сеть-2»: inherited colour only.
 *   seed | state
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { setOrgLogo } from "@/lib/org-logo";
import { prepareOrgLogo } from "@/lib/org-logo-file";

const svg = (text: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 60"><text x="120" y="40" text-anchor="middle" font-size="30" fill="#1f9d3a">${text}</text></svg>`;
const file = (text: string) => {
  const prepared = prepareOrgLogo(new TextEncoder().encode(svg(text)), "image/svg+xml");
  if (!prepared.ok) throw new Error(prepared.error);
  return prepared;
};
const HOUR = 3_600_000;

async function user(email: string, orgName: string, createdAt: Date) {
  return db.user.create({
    data: { email, name: "Анна", role: "owner", isActive: true, passwordHash: "x", organization: { create: { name: orgName, type: "restaurant", createdAt } } },
    select: { id: true, organizationId: true },
  });
}

async function seed() {
  const t0 = Date.now() - 30 * 24 * HOUR;
  const owner = await user("v2-owner@local.test", "Доброе кафе", new Date(t0));
  const account = await db.account.create({ data: { ownerUserId: owner.id }, select: { id: true } });
  const cafe = owner.organizationId;
  await db.organization.update({ where: { id: cafe }, data: { accountId: account.id, brandColor: "#1f9d3a" } });
  await setOrgLogo(cafe, file("ДОБРОЕ КАФЕ v1"));
  await db.auditLog.create({ data: { organizationId: cafe, userId: owner.id, action: "organization.logo.upload", entity: "Organization", entityId: cafe } });
  await db.auditLog.create({ data: { organizationId: cafe, userId: owner.id, action: "organization.settings.update", entity: "organization", entityId: cafe, details: { changed: { brandColor: { from: null, to: "#1f9d3a" } } } } });

  const org = (name: string, hoursAfter: number, accountId: string | null) =>
    db.organization.create({ data: { name, type: "restaurant", accountId, createdAt: new Date(t0 + hoursAfter * HOUR) }, select: { id: true } });

  // «Гимназия»: копия, сделанная скриптом через неделю после создания.
  const gym = await org("Одинцовская гимназия", 24, account.id);
  await setOrgLogo(gym.id, file("ДОБРОЕ КАФЕ v1"));
  await db.organizationLogo.update({ where: { organizationId: gym.id }, data: { updatedAt: new Date(t0 + 24 * 8 * HOUR) } });
  // Донор потом перезалил логотип — хеш копии больше не совпадает.
  await setOrgLogo(cafe, file("ДОБРОЕ КАФЕ v2"));
  await db.auditLog.create({ data: { organizationId: cafe, userId: owner.id, action: "organization.logo.upload", entity: "Organization", entityId: cafe } });

  // «Столовая»: человек сам загрузил тот же логотип.
  const canteen = await org("Столовая №5", 48, account.id);
  await setOrgLogo(canteen.id, file("ДОБРОЕ КАФЕ v2"));
  await db.auditLog.create({ data: { organizationId: canteen.id, userId: owner.id, action: "organization.logo.upload", entity: "Organization", entityId: canteen.id } });

  // «Сеть-2»: унаследованный цвет.
  const second = await org("Сеть-2", 72, account.id);
  await db.organization.update({ where: { id: second.id }, data: { brandColor: "#1F9D3A" } });

  // «Одиночка»: другой аккаунт, единственная организация, адрес файла «Доброго кафе».
  const soloOwner = await user("v2-solo@local.test", "Одиночка", new Date(t0 + 96 * HOUR));
  const soloAccount = await db.account.create({ data: { ownerUserId: soloOwner.id }, select: { id: true } });
  const cafeLogo = await db.organization.findUniqueOrThrow({ where: { id: cafe }, select: { logoUrl: true } });
  await db.organization.update({ where: { id: soloOwner.organizationId }, data: { accountId: soloAccount.id, logoUrl: cafeLogo.logoUrl } });

  console.log(JSON.stringify({ cafe, gym: gym.id, canteen: canteen.id, second: second.id, solo: soloOwner.organizationId }));
}

async function state() {
  const rows = await db.organization.findMany({
    where: { users: { some: { email: { in: ["v2-owner@local.test", "v2-solo@local.test"] } } } },
    select: { id: true },
  });
  const accountIds = (await db.organization.findMany({ where: { id: { in: rows.map((row) => row.id) } }, select: { accountId: true } })).map((row) => row.accountId!);
  const orgs = await db.organization.findMany({
    where: { accountId: { in: accountIds } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, logoUrl: true, brandColor: true, logo: { select: { version: true } } },
  });
  for (const row of orgs) console.log(`  ${row.id} «${row.name}»: logoUrl=${row.logoUrl ?? "—"} file=${row.logo ? `v${row.logo.version}` : "—"} colour=${row.brandColor ?? "—"}`);
  const once = await db.platformSetting.findUnique({ where: { key: "once:inherited-org-brand:v2" } });
  console.log(`  once:inherited-org-brand:v2 = ${once ? once.value : "—"}`);
}

(process.argv[2] === "state" ? state() : seed())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
