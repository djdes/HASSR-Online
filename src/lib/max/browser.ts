/** Only the MAX launch surface may be framed by the messenger. */
export const MAX_FRAME_ANCESTORS="frame-ancestors 'self' https://max.ru https://web.max.ru";

export function maxBrowserHandoffUrl(siteBase:string,ticket:string):string {
  const origin=new URL(siteBase);
  if(origin.protocol!=="https:" && !(origin.protocol==="http:" && ["localhost","127.0.0.1"].includes(origin.hostname))) throw new Error("MAX browser handoff requires HTTPS");
  if(!/^[A-Za-z0-9_-]{43}$/.test(ticket)) throw new Error("Invalid MAX browser handoff");
  return origin.origin+"/max#ticket="+ticket;
}
