"use client";
import { RU_PHONE_PLACEHOLDER, phoneInputProps } from "@/lib/phone-input";
import { useSubmitLock } from "@/lib/use-submit-lock";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Image from "next/image";
import { brandQrHeightFor } from "@/lib/brand-qr-shared";
import { Copy, Plus, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { USER_ROLE_OPTIONS } from "@/lib/user-roles";
import { toastPlanUpgraded } from "@/lib/plan-upgraded-toast";

const roles = USER_ROLE_OPTIONS;

type InviteMode = "email" | "telegram";

type TgInviteResult = {
  inviteUrl: string;
  qrPngDataUrl: string;
  expiresAt: string;
};

export function InviteUserDialog() {
  const t = useTranslations("settingsUi.inviteUserDialog");
  const tc = useTranslations("common");
  const tRole = useTranslations("staffManagement.roleLabels");
  const roleLabel = (value: string, fallback: string) => {
    switch (value) {
      case "manager":
        return tRole("manager");
      case "head_chef":
        return tRole("head_chef");
      case "cook":
        return tRole("cook");
      case "waiter":
        return tRole("waiter");
      default:
        return fallback;
    }
  };
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<InviteMode>("email");
  // Двойной тап по кнопке успевал отправить два одинаковых запроса:
  // setState применяется только к следующему рендеру. Замок синхронный.
  const { busy: isSubmitting, acquire, release } = useSubmitLock();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [phone, setPhone] = useState("");
  const [tgResult, setTgResult] = useState<TgInviteResult | null>(null);
  const [copied, setCopied] = useState(false);

  function resetForm() {
    setName("");
    setEmail("");
    setRole("");
    setPhone("");
    setError(null);
    setTgResult(null);
    setCopied(false);
    setMode("email");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!acquire()) return;
    setError(null);

    try {
      if (mode === "email") {
        const response = await fetch("/api/users/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            email,
            role,
            phone: phone || undefined,
          }),
        });
        const result = (await response.json()) as {
          error?: string;
          planUpgraded?: boolean;
        };
        if (!response.ok) {
          throw new Error(result.error || t("createError"));
        }
        if (result.planUpgraded) toastPlanUpgraded();
        resetForm();
        setOpen(false);
        router.refresh();
      } else {
        const response = await fetch("/api/users/invite/tg", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            role,
            phone: phone || undefined,
          }),
        });
        const result = (await response.json()) as TgInviteResult & {
          error?: string;
          planUpgraded?: boolean;
        };
        if (!response.ok) {
          throw new Error(result.error || t("createError"));
        }
        if (result.planUpgraded) toastPlanUpgraded();
        setTgResult({
          inviteUrl: result.inviteUrl,
          qrPngDataUrl: result.qrPngDataUrl,
          expiresAt: result.expiresAt,
        });
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("createError"));
    } finally {
      release();
    }
  }

  async function handleCopy() {
    if (!tgResult) return;
    try {
      await navigator.clipboard.writeText(tgResult.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked — user can still select the URL visually */
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) resetForm();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" />
          {t("invite")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("invite")}</DialogTitle>
        </DialogHeader>

        {tgResult ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-[#eef0fb] bg-[#f8f9ff] p-3 text-[13px] text-[#5464ff]">
              {t("tgDone")}
            </div>
            <div className="flex justify-center">
              <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/5">
                <Image
                  src={tgResult.qrPngDataUrl}
                  alt={t("qrAlt")}
                  width={240}
                  height={brandQrHeightFor(240)}
                  className="h-auto"
                  unoptimized
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("link")}</Label>
              <div className="flex gap-2">
                <Input readOnly value={tgResult.inviteUrl} />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCopy}
                  aria-label={t("copyLinkAria")}
                >
                  <Copy className="size-4" />
                  {copied ? t("copied") : t("copy")}
                </Button>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                type="button"
                onClick={() => {
                  resetForm();
                  setOpen(false);
                }}
              >
                {t("done")}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2 rounded-lg border border-[#eef0fb] bg-[#f8f9ff] p-1">
              <button
                type="button"
                onClick={() => setMode("email")}
                className={`rounded-md px-3 py-2 text-sm font-medium transition ${
                  mode === "email"
                    ? "bg-white text-[#5464ff] shadow-sm"
                    : "text-[#5464ff]/60"
                }`}
              >
                {t("modeEmail")}
              </button>
              <button
                type="button"
                onClick={() => setMode("telegram")}
                className={`flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition ${
                  mode === "telegram"
                    ? "bg-white text-[#5464ff] shadow-sm"
                    : "text-[#5464ff]/60"
                }`}
              >
                <Send className="size-3.5" />
                {t("modeTelegram")}
              </button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="user-name">
                {t("nameLabel")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="user-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("namePlaceholder")}
                required
              />
            </div>
            {mode === "email" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="user-email">
                    Email <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="user-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ivanov@example.com"
                    required
                  />
                </div>
                <div className="rounded-lg border border-[#eef0fb] bg-[#f8f9ff] p-3 text-[13px] text-[#5464ff]">
                  {t("emailHint")}
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-[#eef0fb] bg-[#f8f9ff] p-3 text-[13px] text-[#5464ff]">
                {t("telegramHint")}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="user-role">
                {t("roleLabel")} <span className="text-destructive">*</span>
              </Label>
              <Select value={role} onValueChange={setRole} required>
                <SelectTrigger id="user-role" className="w-full">
                  <SelectValue placeholder={t("rolePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {roleLabel(item.value, item.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-phone">
                {t("phoneLabel")} <span className="text-destructive">*</span>
              </Label>
              <Input
                id="user-phone"
                type="tel"
                {...phoneInputProps(phone, setPhone)}
                placeholder={RU_PHONE_PLACEHOLDER}
                required
              />
              {/* Номер — ключ связки с TasksFlow (П-8): без него сотрудник
                  не получит задачи и его приходится «дружить» вручную. */}
              <p className="text-xs text-muted-foreground">
                {t("phoneHint")}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
              >
                {tc("cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? t("creating") : t("inviteShort")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
