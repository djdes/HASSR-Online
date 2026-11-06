"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { GglApplication, GglApplicationsView, GglSiteCardResult, GglWebmasterAnalysis } from "@/lib/seo/gogetlinks-applications";
import type { GglCampaignDto } from "./types";

const endpoint = "/api/root/gogetlinks/applications";
const button = "inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-[#dcdfed] bg-white px-4 text-[13px] font-medium text-[#0b1024] hover:bg-[#f5f6ff] disabled:opacity-50";
const input = "h-10 rounded-2xl border border-[#dcdfed] bg-white px-3 text-[13px] text-[#0b1024] focus:border-[#5566f6] focus:outline-none";
const metric = (n: number | null) => n === null ? "—" : n.toLocaleString("ru-RU");
const verdicts = { recommended: "Рекомендует", consider: "Рассмотреть", avoid: "Не рекомендует" };

async function api<T>(body?: unknown, campaignId?: number): Promise<T> {
  const response = await fetch(body ? endpoint : `${endpoint}${campaignId ? `?campaignId=${campaignId}` : ""}`, body ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  } : { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error ?? "Не удалось получить данные GoGetLinks");
  return data as T;
}

export function ApplicationsTab({ campaigns, defaultCampaignId }: { campaigns: GglCampaignDto[]; defaultCampaignId: number | null }) {
  const [campaignId, setCampaignId] = useState<number | undefined>(defaultCampaignId ?? undefined);
  const [view, setView] = useState<GglApplicationsView | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recommendations");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<GglApplication | null>(null);
  const mounted = useRef(false);

  const load = useCallback(async (refresh = false) => {
    setLoading(true); setError(null);
    try {
      const value = await api<GglApplicationsView>(refresh ? { action: "refresh", campaignId } : undefined, campaignId);
      if (mounted.current) { setView(value); setPage(1); }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Ошибка загрузки"); }
    finally { if (mounted.current) setLoading(false); }
  }, [campaignId]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  const cardMap = useMemo(() => new Map(view?.cards.map(c => [c.siteId, c]) ?? []), [view?.cards]);
  const recommendations = useMemo(() => new Map(view?.analysis?.recommendations.map((r, index) => [r.siteId, { ...r, index }]) ?? []), [view?.analysis]);
  const siteCount = new Set(view?.snapshot.applications.map(a => a.siteId)).size;
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (view?.snapshot.applications ?? []).filter(a => !q || `${a.domain} ${a.placementType} ${cardMap.get(a.siteId)?.card?.fields.map(f => f.value).join(" ") ?? ""}`.toLowerCase().includes(q)).sort((a, b) => {
      if (sort === "price") return (a.priceRub ?? Infinity) - (b.priceRub ?? Infinity);
      if (sort === "trust") return (b.trust ?? -1) - (a.trust ?? -1);
      if (sort === "traffic") return (b.dailyTraffic ?? -1) - (a.dailyTraffic ?? -1);
      return (recommendations.get(a.siteId)?.index ?? Infinity) - (recommendations.get(b.siteId)?.index ?? Infinity) || (b.trust ?? -1) - (a.trust ?? -1);
    });
  }, [view?.snapshot.applications, query, cardMap, sort, recommendations]);

  function mergeCards(current: GglApplicationsView, cards: GglSiteCardResult[]) {
    const merged = new Map(current.cards.map(c => [c.siteId, c]));
    cards.forEach(c => merged.set(c.siteId, c));
    return { ...current, cards: [...merged.values()], analysis: null };
  }

  async function openCard(application: GglApplication) {
    setSelected(application);
    if (!view || cardMap.get(application.siteId)?.card) return;
    setBusy(true);
    try {
      const result = await api<{ cards: GglSiteCardResult[] }>({ action: "cards", campaignId: view.campaignId, snapshotId: view.snapshotId, siteIds: [application.siteId] });
      if (mounted.current) setView(current => current ? mergeCards(current, result.cards) : current);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Не удалось загрузить карточку"); }
    finally { if (mounted.current) setBusy(false); }
  }

  async function analyze() {
    if (!view) return;
    setBusy(true); setError(null);
    let current = view;
    try {
      while (mounted.current && new Set(current.cards.map(c => c.siteId)).size < siteCount) {
        setProgress(`Карточки площадок: ${current.cards.length} из ${siteCount}. Можно продолжить позже — загруженные данные сохраняются.`);
        const result = await api<{ cards: GglSiteCardResult[] }>({ action: "cards", campaignId: current.campaignId, snapshotId: current.snapshotId });
        if (!result.cards.length) throw new Error("Список изменился. Обновите заявки и повторите анализ");
        current = mergeCards(current, result.cards);
        if (mounted.current) setView(current);
      }
      if (!mounted.current) return;
      setProgress(`Диспетчер сравнивает все ${current.snapshot.applications.length} заявок…`);
      const result = await api<{ analysis: GglWebmasterAnalysis }>({ action: "analyze", campaignId: current.campaignId, snapshotId: current.snapshotId });
      if (mounted.current) { setView({ ...current, analysis: result.analysis }); toast.success("Рекомендации диспетчера готовы"); }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Не удалось выполнить анализ"); }
    finally { if (mounted.current) { setBusy(false); setProgress(""); } }
  }

  const cardResult = selected ? cardMap.get(selected.siteId) : null;
  const card = cardResult?.card;
  const selectedRecommendation = selected ? recommendations.get(selected.siteId) : null;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Кампания для заявок" value={campaignId ?? ""} disabled={busy || loading} onChange={e => { setView(null); setSelected(null); setCampaignId(Number(e.target.value) || undefined); }} className={input}>
        <option value="">Основная кампания wesetup.ru</option>
        {campaigns.filter(c => c.isWesetup).map(c => <option key={c.id} value={c.gglCampaignId}>{c.name}</option>)}
      </select>
      <button type="button" className={button} disabled={busy || loading} onClick={() => void load(true)}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />Обновить заявки</button>
      <button type="button" disabled={busy || loading || !view?.snapshot.complete || !view.snapshot.applications.length} onClick={() => void analyze()} className={cn(button, "border-[#5566f6] bg-[#5566f6] text-white hover:bg-[#4a5bf0]")}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}Анализ всех площадок
      </button>
    </div>
    <p className="text-[13px] leading-relaxed text-[#6f7282]">Входящие предложения вебмастеров до покупки. Карточки содержат все доступные GoGetLinks характеристики и примеры размещения. Анализ только рекомендует площадки и не расходует баланс. Первая загрузка всех карточек может занять несколько минут.</p>
    {progress ? <p role="status" className="rounded-2xl bg-[#eef1ff] px-4 py-3 text-[13px] text-[#3848c7]">{progress}</p> : null}
    {error ? <p role="alert" className="rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] text-[#a13a32]">{error}</p> : null}
    {loading ? <div role="status" className="flex items-center gap-2 rounded-3xl border border-[#ececf4] bg-white p-6 text-[14px] text-[#6f7282]"><Loader2 className="size-4 animate-spin" />Читаем все страницы заявок GoGetLinks…</div> : null}
    {view ? <>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-[#6f7282]">
        <span>Заявок: {view.snapshot.applications.length} из {view.snapshot.sourceTotal}</span><span>Площадок: {siteCount}</span><span>Карточек: {view.cards.filter(c => c.card).length} · недоступно: {view.cards.filter(c => !c.card).length}</span><span>Срез: {new Date(view.snapshot.fetchedAt).toLocaleString("ru-RU")}</span>
      </div>
      {view.snapshot.warning ? <p role="alert" className="rounded-2xl bg-[#fff4f2] px-4 py-3 text-[13px] text-[#a13a32]">{view.snapshot.warning}</p> : null}
      {view.analysis ? <div className="space-y-3 rounded-3xl border border-[#ececf4] bg-[#fafbff] p-5">
        <h2 className="text-[18px] font-semibold text-[#0b1024]">Рекомендации диспетчера</h2>
        <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-[#3c4053]">{view.analysis.summary}</p>
        <p className="text-[12px] text-[#6f7282]">В анализ переданы все {view.snapshot.applications.length} заявок ({view.analysis.consideredSiteIds.length} площадок). {new Date(view.analysis.createdAt).toLocaleString("ru-RU")}. Короткий список — в таблице; остальные площадки рассмотрены и не включены в него.</p>
        {view.analysis.limitations.length ? <ul className="list-disc space-y-1 pl-5 text-[13px] text-[#6f7282]">{view.analysis.limitations.map((item, i) => <li key={i}>{item}</li>)}</ul> : null}
      </div> : null}
      <div className="flex flex-wrap gap-2">
        <input aria-label="Поиск по домену и характеристикам" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} placeholder="Домен, тематика, регион…" className={`${input} min-w-[220px] flex-1`} />
        <select aria-label="Сортировка заявок" value={sort} onChange={e => { setSort(e.target.value); setPage(1); }} className={input}><option value="recommendations">Рекомендации и траст</option><option value="price">Цена по возрастанию</option><option value="trust">Траст по убыванию</option><option value="traffic">Трафик по убыванию</option></select>
      </div>
      {rows.length ? <div className="overflow-x-auto rounded-3xl border border-[#ececf4] bg-white"><table className="w-full min-w-[900px] text-left text-[13px]">
        <thead className="bg-[#fafbff] text-[#6f7282]"><tr>{["Площадка", "Размещение", "Цена", "Трафик/сутки", "TF / CF", "ИКС", "Траст", "Диспетчер"].map(label => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
        <tbody>{rows.slice((page - 1) * 50, page * 50).map(a => {
          const r = recommendations.get(a.siteId);
          return <tr key={a.id} className="border-t border-[#ececf4] align-top text-[#0b1024]">
            <td className="px-4 py-3"><button type="button" disabled={busy} onClick={() => void openCard(a)} className="text-left font-medium text-[#3848c7] hover:underline">{a.domain}</button>{a.badges.map(b => <div key={b} className="mt-1 max-w-[230px] text-[11px] text-[#6f7282]">{b}</div>)}</td>
            <td className="px-4 py-3">{a.placementType}</td><td className="px-4 py-3 whitespace-nowrap tabular-nums">{metric(a.priceRub)} ₽</td><td className="px-4 py-3 tabular-nums">{metric(a.dailyTraffic)}</td><td className="px-4 py-3 whitespace-nowrap">{metric(a.tf)} / {metric(a.cf)}</td><td className="px-4 py-3">{metric(a.iks)}</td><td className="px-4 py-3">{metric(a.trust)}</td>
            <td className="max-w-[310px] px-4 py-3">{r ? <><span className={`font-medium ${r.verdict === "recommended" ? "text-[#116b2a]" : r.verdict === "avoid" ? "text-[#a13a32]" : "text-[#3848c7]"}`}>{verdicts[r.verdict]}</span><p className="mt-1 text-[12px] leading-relaxed text-[#6f7282]">{r.reason}</p></> : <span className="text-[#9b9fb3]">{view.analysis ? "Вне короткого списка" : "Анализ не выполнен"}</span>}</td>
          </tr>;
        })}</tbody>
      </table></div> : <div className="rounded-3xl border border-dashed border-[#dcdfed] bg-[#fafbff] px-6 py-12 text-center text-[14px] text-[#6f7282]">{query ? "По вашему запросу ничего не найдено" : "Входящих заявок в этой кампании пока нет"}</div>}
      {rows.length > 50 ? <div className="flex items-center justify-end gap-3 text-[13px] text-[#6f7282]"><button type="button" className={button} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Предыдущая</button><span>{page} / {Math.ceil(rows.length / 50)}</span><button type="button" className={button} disabled={page * 50 >= rows.length} onClick={() => setPage(p => p + 1)}>Следующая</button></div> : null}
    </> : null}
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}><DialogContent className="max-h-[90vh] overflow-y-auto rounded-3xl border-[#ececf4] bg-white sm:max-w-[760px]"><DialogHeader><DialogTitle className="text-[#0b1024]">{selected?.domain}</DialogTitle><DialogDescription>Характеристики площадки и примеры размещения из GoGetLinks.</DialogDescription></DialogHeader>
      {selected ? <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-[13px] text-[#6f7282]"><span>{selected.placementType} · предложение {metric(selected.priceRub)} ₽</span><a href={selected.siteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#3848c7]">Открыть сайт<ExternalLink className="size-3" /></a></div>
        {selectedRecommendation ? <p className="rounded-2xl bg-[#eef1ff] p-3 text-[13px] leading-relaxed text-[#3848c7]">{verdicts[selectedRecommendation.verdict]}: {selectedRecommendation.reason}</p> : null}
        {busy && !card ? <p role="status" className="text-[13px] text-[#6f7282]">Загружаем полную карточку…</p> : null}
        {cardResult?.error ? <div className="space-y-2"><p role="alert" className="text-[13px] text-[#a13a32]">{cardResult.error}</p><button type="button" disabled={busy} onClick={() => void openCard(selected)} className={button}>Повторить загрузку</button></div> : null}
        {card ? <>
          {[...new Set(card.fields.map(f => f.group))].map(group => <section key={group} className="rounded-2xl border border-[#ececf4] bg-[#fafbff] p-4"><h3 className="mb-3 text-[14px] font-semibold text-[#0b1024]">{group || "Характеристики"}</h3><dl className="space-y-2">{card.fields.filter(f => f.group === group).map((f, i) => <div key={i} className="flex justify-between gap-5 text-[13px]"><dt className="text-[#6f7282]">{f.label}</dt><dd className="max-w-[65%] text-right text-[#0b1024]">{f.value}</dd></div>)}</dl></section>)}
          {card.examples.length ? <section><h3 className="mb-2 text-[14px] font-semibold text-[#0b1024]">Примеры размещения</h3><ul className="space-y-2">{card.examples.map((url, i) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer" className="break-all text-[13px] text-[#3848c7] hover:underline">Пример {i + 1}: {url}</a></li>)}</ul></section> : null}
          <p className="text-[12px] text-[#6f7282]">Источник: GoGetLinks · {new Date(card.fetchedAt).toLocaleString("ru-RU")}. Сведения о владельце, которых нет в карточке сервиса, не подставляются.</p>
        </> : null}
      </div> : null}
    </DialogContent></Dialog>
  </div>;
}
