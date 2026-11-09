import { login, close } from "./lib.mjs";
const alexey = await login("alexey");
const t0 = Date.now();
const r = await alexey.api("POST", "/api/root/crm/automation/run");
console.log("run:", r.status, ((Date.now() - t0) / 1000).toFixed(1) + "s", JSON.stringify(r.data).slice(0, 600));
await close();
