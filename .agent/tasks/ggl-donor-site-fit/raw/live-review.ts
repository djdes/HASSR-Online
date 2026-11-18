import { assessGglDonorSite } from "../../../../src/lib/seo/gogetlinks-site-fit.server";

void Promise.all(["resttrade.ru", "astrakhan.net", "vkyrse.com", "restoranoff.ru"].map(async (domain) => ({
  domain,
  fit: await assessGglDonorSite(domain, "/sanpin-2-3-2-4-4282-26", "санпин для общепита"),
}))).then((rows) => console.log(JSON.stringify(rows, null, 2)));
