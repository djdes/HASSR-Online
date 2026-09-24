import type { OrgOwnership, OrgSphere } from "@/lib/org-profile";

/**
 * Что можно вывести о заведении из ответа ЕГРЮЛ (DaData), чтобы
 * подставить в анкету: сфера по основному ОКВЭД и тип по ОПФ. Только
 * подсказки — человек может выбрать иное.
 */
const OKVED_TO_SPHERE: Array<[prefix: string, sphere: OrgSphere]> = [
  ["56.30", "bar"],
  ["56.29", "canteen"],
  ["56.21", "catering"],
  ["56.10.2", "fastfood"],
  ["56.", "restaurant"],
  ["10.71", "bakery"],
  ["10.72", "bakery"],
  ["10.", "production"],
  ["11.", "production"],
  ["47.30", "gas_station"],
  ["47.1", "retail"],
  ["47.2", "retail"],
  ["55.", "hotel"],
  ["85.", "education"],
  ["86.", "medical"],
  ["87.", "medical"],
  // Спорт: 93.11 спортобъекты, 93.12 спортклубы, 93.13 фитнес-центры,
  // 93.19 прочая спортивная деятельность; 96.04 — физкультурно-
  // оздоровительная деятельность (бани, сауны, бассейны).
  ["93.11", "fitness"],
  ["93.12", "fitness"],
  ["93.13", "fitness"],
  ["93.19", "fitness"],
  ["96.04", "fitness"],
  // 96.02 — предоставление услуг парикмахерскими и салонами красоты
  // (в том числе маникюр, барбершопы).
  ["96.02", "beauty"],
];

export function sphereFromOkved(okved: string | null | undefined): OrgSphere | null {
  const code = (okved ?? "").trim();
  if (!code) return null;
  for (const [prefix, sphere] of OKVED_TO_SPHERE) {
    if (code.startsWith(prefix)) return sphere;
  }
  return null;
}

const STATE_OPF = /государствен|муниципальн|бюджетн|казенн|казённ|унитарн|автономн\S* учрежден/i;

export function ownershipFromOpf(
  opfFull: string | null | undefined,
  type: string | null | undefined,
): OrgOwnership | null {
  if (type === "INDIVIDUAL") return "private";
  const opf = (opfFull ?? "").trim();
  if (!opf) return null;
  return STATE_OPF.test(opf) ? "state" : "private";
}
