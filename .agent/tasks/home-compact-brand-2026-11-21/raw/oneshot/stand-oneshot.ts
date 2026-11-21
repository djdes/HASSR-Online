/*
 * Local stand for the deploy one-shot (prisma/seed-repair-inherited-org-brand-2026-11.ts).
 * createOrganization no longer copies the brand, so the old behaviour is reproduced by hand,
 * exactly as the code before #295 did it: a copy of the donor's logo file (no upload audit)
 * and the donor's brand colour.
 *   seed  — create the stand;  state — print brand state of the stand organizations.
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { createOrganization } from "@/lib/create-organization";
import { readOrgLogo, setOrgLogo } from "@/lib/org-logo";
import { prepareOrgLogo } from "@/lib/org-logo-file";

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 110"><text x="120" y="52" text-anchor="middle" font-size="40" fill="#1f9d3a">ДОБРОЕ</text><text x="120" y="96" text-anchor="middle" font-size="40" fill="#1f9d3a">КАФЕ</text></svg>`;

async function copyLikeBefore(donorId: string, organizationId: string) {
  const file = await readOrgLogo(donorId);
  if (file) await setOrgLogo(organizationId, file);
  const donor = await db.organization.findUniqueOrThrow({ where: { id: donorId }, select: { brandColor: true } });
  await db.organization.update({ where: { id: organizationId }, data: { brandColor: donor.brandColor } });
}

async function seed() {
  const owner = await db.user.create({ data: { email: "oneshot-owner@local.test", name: "Анна", role: "owner", isActive: true, passwordHash: "x", organization: { create: { name: "Доброе кафе", type: "restaurant" } } }, select: { id: true, organizationId: true } });
  const account = await db.account.create({ data: { ownerUserId: owner.id }, select: { id: true } });
  const homeId = owner.organizationId;
  await db.organization.update({ where: { id: homeId }, data: { accountId: account.id, brandColor: "#1f9d3a" } });
  const prepared = prepareOrgLogo(new TextEncoder().encode(LOGO_SVG), "image/svg+xml");
  if (!prepared.ok) throw new Error(prepared.error);
  await setOrgLogo(homeId, prepared);
  await db.auditLog.create({ data: { organizationId: homeId, userId: owner.id, action: "organization.logo.upload", entity: "Organization", entityId: homeId } });
  await db.auditLog.create({ data: { organizationId: homeId, userId: owner.id, action: "organization.settings.update", entity: "organization", entityId: homeId, details: { changed: { brandColor: { from: null, to: "#1f9d3a" } } } } });

  const make = (name: string) => createOrganization({ name, sphere: "restaurant", accountId: account.id, ownerUserId: owner.id, copyFromOrganizationId: homeId });
  const { organizationId: gymId } = await make("Одинцовская гимназия");
  await copyLikeBefore(homeId, gymId);
  const { organizationId: canteenId } = await make("Столовая №5");
  await copyLikeBefore(homeId, canteenId);
  // В «Столовой» человек сам загрузил тот же логотип — его не трогаем.
  await setOrgLogo(canteenId, prepared);
  await db.auditLog.create({ data: { organizationId: canteenId, userId: owner.id, action: "organization.logo.upload", entity: "Organization", entityId: canteenId } });
  await make("Пекарня Колос");
  console.log(JSON.stringify({ accountId: account.id, homeId, gymId, canteenId }));
}

async function state() {
  const rows = await db.organization.findMany({
    where: { account: { owner: { email: "oneshot-owner@local.test" } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, logoUrl: true, brandColor: true, logo: { select: { version: true } } },
  });
  for (const row of rows) console.log(`  ${row.id} «${row.name}»: logo=${row.logoUrl ? `file v${row.logo?.version ?? "—"}` : "—"} colour=${row.brandColor ?? "—"}`);
  const once = await db.platformSetting.findUnique({ where: { key: "once:inherited-org-brand:v1" } });
  console.log(`  once:inherited-org-brand:v1 = ${once ? once.value : "—"}`);
  const audits = await db.auditLog.count({ where: { action: "organization.brand.inherited_removed" } });
  console.log(`  audit organization.brand.inherited_removed: ${audits}`);
}

(process.argv[2] === "state" ? state() : seed())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
