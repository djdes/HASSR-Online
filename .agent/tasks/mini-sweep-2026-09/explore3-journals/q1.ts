import { db, state } from "./lib";
(async () => {
  const o = await db.organization.findMany({ select: { id: true, name: true } });
  console.log(o);
  await db.$disconnect();
})();
