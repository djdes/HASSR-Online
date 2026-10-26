import "dotenv/config";
import { maxApi } from "../src/lib/max/client";
import { maxConfig } from "../src/lib/max/config";

async function main() {
  const cfg=maxConfig();
  if(!cfg.configured) throw new Error("Set MAX_BOT_TOKEN and MAX_BOT_USERNAME in the server environment");
  const bot=await maxApi<{username:string;first_name:string;is_bot:boolean}>("/me");
  if(bot.username!==cfg.username || !bot.is_bot) throw new Error("MAX_BOT_USERNAME does not match the supplied bot token");
  const subscriptions=await maxApi<{subscriptions:Array<{url:string;update_types?:string[]}>}>("/subscriptions");
  const webhook=cfg.siteBase+"/api/max/webhook";
  console.log(JSON.stringify({bot:bot.username,name:bot.first_name,apiBase:cfg.apiBase,webhook,webhookRegistered:subscriptions.subscriptions.some(s=>s.url===webhook)},null,2));
  if(!process.argv.includes("--apply")) {
    console.log("Read-only check. After deployment, run with --apply to register this webhook and bot commands.");return;
  }
  if(cfg.webhookSecret.length<32 || !/^[A-Za-z0-9_-]+$/.test(cfg.webhookSecret)) throw new Error("MAX_WEBHOOK_SECRET must be 32+ letters/digits/underscores/hyphens");
  if(new URL(cfg.siteBase).protocol!=="https:") throw new Error("Webhook requires HTTPS");
  const subscribed=await maxApi<{success:boolean}>("/subscriptions",{method:"POST",body:{url:webhook,secret:cfg.webhookSecret,update_types:["bot_started","bot_stopped","message_created","message_callback"]}});
  if(subscribed.success!==true) throw new Error("MAX did not accept the webhook subscription");
  const commands=[{name:"menu",description:"Главное меню"},{name:"tasks",description:"Мои задачи на сегодня"},{name:"journals",description:"Заполнить журнал"},{name:"help",description:"Как это работает"}];
  const updated=await maxApi<{commands?:Array<{name:string}>}>("/me/commands",{method:"PATCH",body:{commands}});
  if(!commands.every(command=>updated.commands?.some(saved=>saved.name===command.name))) throw new Error("MAX did not confirm the bot commands");
  console.log("Webhook and commands configured. The bot works in chat only (no mini-app); confirm with a real-device smoke test.");
}
main().catch(()=>{console.error("MAX setup failed. Check configuration, API availability and trusted TLS certificates. Secrets and upstream payloads are intentionally omitted.");process.exitCode=1;});
