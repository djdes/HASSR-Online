export function maxConfig() {
  const token=process.env.MAX_BOT_TOKEN?.trim() ?? "";
  const username=process.env.MAX_BOT_USERNAME?.trim().replace(/^@/,"") ?? "";
  const webhookSecret=process.env.MAX_WEBHOOK_SECRET?.trim() ?? "";
  const apiBase=process.env.MAX_API_BASE_URL?.trim() || "https://platform-api2.max.ru";
  const siteBase=process.env.MAX_SITE_URL?.trim() || process.env.NEXTAUTH_URL || "https://wesetup.ru";
  // Restrict the credential destination: configuration must never exfiltrate a bot token.
  if (!["https://platform-api2.max.ru","https://platform-api.max.ru"].includes(apiBase)) throw new Error("MAX API URL is not supported");
  const site=new URL(siteBase);
  if (site.protocol!=="https:" && !(process.env.NODE_ENV!=="production" && ["localhost","127.0.0.1"].includes(site.hostname))) throw new Error("MAX site URL requires HTTPS");
  return {token,username,webhookSecret,apiBase,siteBase:site.origin,configured:!!token && /^[A-Za-z0-9_]+$/.test(username)};
}
