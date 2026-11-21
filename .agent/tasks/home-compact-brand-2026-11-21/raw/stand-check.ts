/*
 * AC1 on the local stand (after the fix): a new organization created «как текущая»
 * gets the donor's positions, journal set and locale, but no logo / colour.
 * Usage: npx tsx .agent/tasks/home-compact-brand-2026-11-21/raw/stand-check.ts <stand.json> [state]
 *   state — only print the brand state of the stand organizations.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
import { createOrganization } from "@/lib/create-organization";

const stand = JSON.parse(readFileSync(process.argv[2], "utf8"));
let failed = 0;
const check = (name: string, ok: boolean, details?: unknown) => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${details === undefined ? "" : ` — ${JSON.stringify(details)}`}`);
};

async function state() {
  const rows = await db.organization.findMany({
    where: { accountId: stand.accountId },
    orderBy: { createdAt: "asc" },
    select: { name: true, logoUrl: true, brandColor: true, logo: { select: { version: true } } },
  });
  for (const row of rows) console.log(`  «${row.name}»: logoUrl=${row.logoUrl ?? "—"} file=${row.logo ? `v${row.logo.version}` : "—"} brandColor=${row.brandColor ?? "—"}`);
}

async function main() {
  if (process.argv[3] === "state") return state();
  await db.jobPosition.create({ data: { organizationId: stand.homeId, name: "Повар (стенд)", categoryKey: "staff", sortOrder: 1 } });
  await db.organization.update({ where: { id: stand.homeId }, data: { locale: "ru", disabledJournalCodes: ["med_books"] as never } });
  const donor = await db.organization.findUniqueOrThrow({ where: { id: stand.homeId }, select: { logoUrl: true, brandColor: true, locale: true, disabledJournalCodes: true } });
  const { organizationId } = await createOrganization({
    name: "Новая после исправления",
    sphere: "restaurant",
    accountId: stand.accountId,
    ownerUserId: stand.ownerId,
    copyFromOrganizationId: stand.homeId,
  });
  const created = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { logoUrl: true, brandColor: true, brandColor2: true, brandColor3: true, website: true, qrIconUrl: true, locale: true, disabledJournalCodes: true, logo: { select: { version: true } }, jobPositions: { select: { name: true } } },
  });
  check("donor has a logo and a colour (precondition)", Boolean(donor.logoUrl && donor.brandColor), donor);
  check("AC1 new org «как текущая»: no logo url", created.logoUrl === null, created.logoUrl);
  check("AC1 new org: no logo file", created.logo === null, created.logo);
  check("AC1 new org: no brand colours, site, QR icon", !created.brandColor && !created.brandColor2 && !created.brandColor3 && !created.website && !created.qrIconUrl, created);
  check("AC1 new org: positions copied", created.jobPositions.some((p) => p.name === "Повар (стенд)"), created.jobPositions);
  check("AC1 new org: journal set and locale copied", JSON.stringify(created.disabledJournalCodes) === JSON.stringify(donor.disabledJournalCodes) && created.locale === donor.locale, { disabled: created.disabledJournalCodes, locale: created.locale });
  console.log(JSON.stringify({ newOrgId: organizationId }));
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
