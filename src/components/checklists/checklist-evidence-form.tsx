"use client";

import { formatChecklistTimestamp } from "@/lib/custom-checklist-display";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { ChecklistEvidence } from "@/lib/custom-checklist-rules";
import type { ChecklistRequirements } from "@/lib/custom-checklist-runtime";

export type ChecklistUpload = (questionId: string, purpose: "photo" | "video" | "audio", file: File) => Promise<string>;
export const checklistMediaUrl = (ref: string) => ref.startsWith("file:") ? `/api/checklists/attachments/${ref.slice(5)}` : ref.startsWith("data:image/") ? ref : "";
export function ChecklistMedia({ refs, kind, onRemove }: { refs: string[]; kind: "photo" | "video" | "audio"; onRemove?: (ref: string) => void }) {
  const t = useTranslations("checklistsUi.checklistEvidenceForm");
  return <div className="space-y-2">{refs.map((ref, index) => <div key={ref} className="space-y-1">{kind === "photo" ?
    // eslint-disable-next-line @next/next/no-img-element
    <a href={checklistMediaUrl(ref)} target="_blank" rel="noopener noreferrer"><img src={checklistMediaUrl(ref)} alt={t("proofAlt", { number: index + 1 })} className="max-h-60 max-w-full rounded-xl object-contain" /></a>
    : kind === "video" ? <video className="max-h-60 max-w-full rounded-xl" src={checklistMediaUrl(ref)} controls preload="metadata" /> : <audio className="max-w-full" src={checklistMediaUrl(ref)} controls preload="metadata" />}{onRemove ? <Button variant="ghost" size="sm" onClick={() => onRemove(ref)}>{t("removeFile")}</Button> : null}</div>)}</div>;
}

function ChecklistBarcodeReader({ onRead, onClose }: { onRead: (value: string) => void; onClose: () => void }) {
  const t = useTranslations("checklistsUi.checklistEvidenceForm");
  const id = `checklist-code-${useId().replace(/:/g, "")}`;
  const readRef = useRef(onRead); readRef.current = onRead;
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false; let scanner: import("html5-qrcode").Html5Qrcode | undefined;
    void import("html5-qrcode").then(async ({ Html5Qrcode }) => {
      if (cancelled) return; scanner = new Html5Qrcode(id);
      try { await scanner.start({ facingMode: "environment" }, { fps: 8, qrbox: {width:250,height:180} }, text => readRef.current(text), () => {}); if (cancelled && scanner.isScanning) await scanner.stop(); }
      catch { if (!cancelled) setError(t("cameraFailed")); }
    });
    return () => { cancelled = true; if (scanner?.isScanning) void scanner.stop().catch(() => {}); };
  }, [id, t]);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="rounded-3xl"><DialogHeader><DialogTitle>{t("scanTitle")}</DialogTitle><DialogDescription>{t("scanHint")}</DialogDescription></DialogHeader><div id={id} />{error ? <p role="alert">{error}</p> : null}</DialogContent></Dialog>;
}

export function ChecklistEvidenceForm({ questionId, value = {}, requirements, onChange, upload, readOnly, errors }: {
  questionId: string; value?: ChecklistEvidence[string]; requirements: ChecklistRequirements; onChange: (value: ChecklistEvidence[string]) => void; upload?: ChecklistUpload; readOnly: boolean; errors: Record<string,string>;
}) {
  const t = useTranslations("checklistsUi.checklistEvidenceForm");
  const [busy, setBusy] = useState(false);
  const [scanner, setScanner] = useState(false);
  const valueRef = useRef(value); valueRef.current = value;
  const readOnlyRef = useRef(readOnly); readOnlyRef.current = readOnly;
  const patch = (next: Partial<ChecklistEvidence[string]>) => { if (!readOnlyRef.current) onChange({ ...valueRef.current, ...next }); };
  const any = Object.values(requirements).some(Boolean) || Object.keys(value).length > 0;
  if (!any) return null;
  return <div className="space-y-3 rounded-xl border border-indigo-100 bg-white p-3">
    <p className="text-sm font-medium">{t("heading")}</p>
    {requirements.comment || value.comment ? <div><Textarea aria-label={t("commentLabel")} placeholder={t("commentPlaceholder")} maxLength={3000} readOnly={readOnly} value={value.comment ?? ""} onChange={e => patch({ comment: e.target.value })} />{errors[`${questionId}:comment`] ? <p role="alert" className="text-sm text-red-700">{errors[`${questionId}:comment`]}</p> : null}</div> : null}
    {(["photos", "videos", "audios"] as const).map(key => {
      const kind = key === "photos" ? "photo" : key === "videos" ? "video" : "audio";
      if (!requirements[key] && !value[key]?.length) return null;
      return <div key={key} className="space-y-2"><p className="text-sm">{requirements[key] ? t("minimum", { label: key === "photos" ? t("photos") : key === "videos" ? t("videos") : t("audios"), count: Number(requirements[key]) }) : key === "photos" ? t("photos") : key === "videos" ? t("videos") : t("audios")}</p>
        <ChecklistMedia kind={kind} refs={value[key] ?? []} onRemove={readOnly ? undefined : ref => patch({ [key]: value[key]?.filter(item => item !== ref) })} />
        {!readOnly ? <Input aria-label={kind === "photo" ? t("addPhoto") : kind === "video" ? t("addVideo") : t("addAudio")} type="file" accept={kind === "photo" ? "image/png,image/jpeg,image/webp" : kind === "video" ? "video/mp4,video/webm" : "audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/webm"} capture={kind === "photo" || kind === "video" ? "environment" : undefined} disabled={busy || !upload || (value[key]?.length ?? 0) >= (kind === "photo" ? 10 : 3)} onChange={async e => {
          const file = e.target.files?.[0]; e.target.value = ""; if (!file || !upload) return;
          if (file.size > 10 * 1024 * 1024) { toast.error(t("fileTooBig")); return; }
          setBusy(true); try { const ref = await upload(questionId, kind, file); patch({ [key]: [...(valueRef.current[key] ?? []), ref] }); } catch (error) { toast.error(error instanceof Error ? error.message : t("uploadFailed")); } finally { setBusy(false); }
        }} /> : null}{errors[`${questionId}:${key}`] ? <p role="alert" className="text-sm text-red-700">{errors[`${questionId}:${key}`]}</p> : null}</div>;
    })}
    {requirements.barcode || value.barcode ? <div className="space-y-2"><Input aria-label={t("barcodeLabel")} placeholder={t("barcodePlaceholder")} value={value.barcode ?? ""} maxLength={1000} readOnly={readOnly} onChange={e => patch({ barcode: e.target.value })} />{!readOnly ? <Button variant="outline" onClick={() => setScanner(true)}>{t("scanWithCamera")}</Button> : null}{errors[`${questionId}:barcode`] ? <p role="alert" className="text-sm text-red-700">{errors[`${questionId}:barcode`]}</p> : null}</div> : null}
    {requirements.location || value.location ? <div className="space-y-2">{value.location ? <p className="text-sm">{t("location", { latitude: value.location.latitude.toFixed(6), longitude: value.location.longitude.toFixed(6), time: formatChecklistTimestamp(value.location.capturedAt) })}</p> : null}{!readOnly ? <Button variant="outline" disabled={busy} onClick={() => {
      if (!navigator.geolocation) { toast.error(t("geoUnsupported")); return; }
      setBusy(true); navigator.geolocation.getCurrentPosition(position => { patch({ location: { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: Math.min(position.coords.accuracy,100000), capturedAt: new Date(position.timestamp).toISOString() } }); setBusy(false); }, () => { setBusy(false); toast.error(t("geoDenied")); }, { enableHighAccuracy: true, timeout:15000, maximumAge:0 });
    }}>{t("addLocation")}</Button> : null}{errors[`${questionId}:location`] ? <p role="alert" className="text-sm text-red-700">{errors[`${questionId}:location`]}</p> : null}</div> : null}
    {!upload && !readOnly ? <p className="text-xs text-muted-foreground">{t("uploadsDuringInspection")}</p> : null}
    {errors[`${questionId}:evidence`] ? <p role="alert" className="text-sm text-red-700">{errors[`${questionId}:evidence`]}</p> : null}
    {scanner ? <ChecklistBarcodeReader onRead={text => { patch({ barcode: text.slice(0,1000) }); setScanner(false); }} onClose={() => setScanner(false)} /> : null}
  </div>;
}

export function ChecklistDescription({ text }: { text: string }) {
  return <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{text.split(/(https?:\/\/[^\s<>]+)/g).map((part, index) => /^https?:\/\//.test(part) ? <a key={index} href={part} className="text-indigo-600 underline" target="_blank" rel="noopener noreferrer">{part}</a> : part)}</p>;
}
