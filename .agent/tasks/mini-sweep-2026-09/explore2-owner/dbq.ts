import { db } from "../tg-session";
const q = process.argv[2];
(async () => { const f = new Function("db", "return (async()=>{ " + q + " })()"); console.log(JSON.stringify(await f(db), null, 1)); await db.$disconnect(); })();
