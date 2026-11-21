/* Local stand: pin two pages to the owner's home favorites (third slot stays empty). */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";

const stand = JSON.parse(readFileSync(process.argv[2], "utf8"));
const hrefs = process.argv.slice(3);
db.user
  .update({ where: { id: stand.ownerId }, data: { homeFavorites: hrefs }, select: { homeFavorites: true } })
  .then((row) => console.log(JSON.stringify(row)))
  .finally(() => db.$disconnect());
