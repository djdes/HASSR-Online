// Временные приглашения для проверки страницы /invite/[token] (tariffs-limits-ui AC2).
// create — печатает «email raw-токен»; cleanup — удаляет приглашённых и токены.
// DATABASE_URL=... npx tsx --tsconfig tsconfig.json .agent/tasks/tariffs-limits-ui-2026-10/raw/invite-tokens.ts create|cleanup
import { db } from "@/lib/db";
import { generateInviteToken, hashInviteToken, inviteExpiresAt } from "@/lib/invite-tokens";

const OWNERS = ["lim-free@example.test", "lim-std-full@example.test", "lim-prem-full@example.test"];
const inviteeEmail = (owner: string) => `lim-invite-${owner.split("@")[0]}@example.test`;

async function main() {
  console.info = () => {};
  if (process.argv[2] === "cleanup") {
    const emails = OWNERS.map(inviteeEmail);
    const users = await db.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    await db.inviteToken.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    console.log(`удалено приглашённых: ${users.length}`);
    return;
  }
  for (const owner of OWNERS) {
    const host = await db.user.findUnique({ where: { email: owner }, select: { organizationId: true } });
    if (!host) throw new Error(`нет ${owner}`);
    const email = inviteeEmail(owner);
    const user = await db.user.upsert({
      where: { email },
      update: { organizationId: host.organizationId, isActive: false, archivedAt: null, passwordHash: "" },
      create: { email, name: "Приглашённый по ссылке", passwordHash: "", role: "cook", organizationId: host.organizationId, isActive: false, journalAccessMigrated: true },
    });
    await db.inviteToken.deleteMany({ where: { userId: user.id } });
    const raw = generateInviteToken();
    await db.inviteToken.create({ data: { userId: user.id, tokenHash: hashInviteToken(raw), expiresAt: inviteExpiresAt() } });
    console.log(`${owner} ${raw}`);
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
