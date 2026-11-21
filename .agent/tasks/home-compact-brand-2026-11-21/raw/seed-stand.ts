/*
 * Local stand for home-compact-brand-2026-11-21 (NOT for production).
 * One account, owner «Анна», home org «Доброе кафе» with an uploaded logo and
 * a brand colour (both audited as set by a person), plus organizations created
 * through `createOrganization` the way «+ Добавить организацию» does:
 *   - «Одинцовская гимназия» — «как текущая» (copyFrom = Доброе кафе);
 *   - «Пекарня Колос» — without copying;
 *   - «Столовая №5» — «как текущая», then the person uploads the same logo.
 * Prints ids as JSON. Run: npx tsx .agent/tasks/home-compact-brand-2026-11-21/raw/seed-stand.ts
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { attachAccountForNewOrganization, createOrganization } from "@/lib/create-organization";
import { setOrgLogo } from "@/lib/org-logo";
import { prepareOrgLogo } from "@/lib/org-logo-file";
import { LEGAL_VERSION } from "@/lib/legal-consent";

const EMAIL = "owner@local.test";
const PASSWORD = "OwnerPass123!";

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 110" width="240" height="110">
<path d="M118 10c6-8 16-9 22-4-7 1-14 6-17 13" fill="none" stroke="#1f9d3a" stroke-width="4"/>
<text x="120" y="52" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="40" fill="#1f9d3a">ДОБРОЕ</text>
<text x="120" y="96" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="40" fill="#1f9d3a">КАФЕ</text>
</svg>`;

async function upload(organizationId: string, userId: string) {
  const prepared = prepareOrgLogo(new TextEncoder().encode(LOGO_SVG), "image/svg+xml");
  if (!prepared.ok) throw new Error(prepared.error);
  const url = await setOrgLogo(organizationId, prepared);
  // The upload route writes this audit row for every upload by a person.
  await db.auditLog.create({
    data: { organizationId, userId, userName: "Анна", action: "organization.logo.upload", entity: "Organization", entityId: organizationId, details: { mime: prepared.mime } },
  });
  return url;
}

async function main() {
  const existing = await db.user.findUnique({ where: { email: EMAIL }, select: { id: true } });
  if (existing) throw new Error("stand already seeded");

  const { organizationId: homeId } = await createOrganization({ name: "Доброе кафе", sphere: "restaurant", accountId: null, ownerUserId: null });
  await db.organization.update({ where: { id: homeId }, data: { inn: "7701234567", journalShortName: "ООО «Доброе кафе»" } });
  const owner = await db.user.create({
    data: {
      email: EMAIL,
      name: "Анна Владелец",
      phone: "+79990000000",
      role: "owner",
      isActive: true,
      passwordHash: await bcrypt.hash(PASSWORD, 10),
      organizationId: homeId,
      legalVersion: LEGAL_VERSION,
      showWhatsNew: false,
    },
    select: { id: true },
  });
  const { accountId } = await db.$transaction((tx) => attachAccountForNewOrganization(tx, { ownerUserId: owner.id, organizationId: homeId, subscriptionPlan: "standard", subscriptionEnd: new Date(Date.now() + 90 * 86_400_000) }));

  await upload(homeId, owner.id);
  await db.organization.update({ where: { id: homeId }, data: { brandColor: "#1f9d3a" } });
  await db.auditLog.create({
    data: { organizationId: homeId, userId: owner.id, action: "organization.settings.update", entity: "organization", entityId: homeId, details: { changed: { brandColor: { from: null, to: "#1f9d3a" } } } },
  });

  const { organizationId: gymId } = await createOrganization({ name: "Одинцовская гимназия", sphere: "school", accountId, ownerUserId: owner.id, copyFromOrganizationId: homeId });
  const { organizationId: bakeryId } = await createOrganization({ name: "Пекарня Колос", sphere: "restaurant", accountId, ownerUserId: owner.id });
  const { organizationId: canteenId } = await createOrganization({ name: "Столовая №5", sphere: "restaurant", accountId, ownerUserId: owner.id, copyFromOrganizationId: homeId });
  await upload(canteenId, owner.id);

  const rows = await db.organization.findMany({
    where: { id: { in: [homeId, gymId, bakeryId, canteenId] } },
    select: { id: true, name: true, logoUrl: true, brandColor: true, website: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(JSON.stringify({ email: EMAIL, password: PASSWORD, ownerId: owner.id, accountId, homeId, gymId, bakeryId, canteenId, rows }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
