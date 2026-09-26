"use client";
import { RU_PHONE_PLACEHOLDER, phoneInputProps } from "@/lib/phone-input";
import { useSubmitLock } from "@/lib/use-submit-lock";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
          throw new Error(result.error || "Ошибка при создании сотрудника");
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
          throw new Error(result.error || "Ошибка при создании сотрудника");
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
      setError(
        err instanceof Error ? err.message : "Ошибка при создании сотрудника"
      );
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
          Пригласить сотрудника
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Пригласить сотрудника</DialogTitle>
        </DialogHeader>

        {tgResult ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-[#eef0fb] bg-[#f8f9ff] p-3 text-[13px] text-[#5464ff]">
              Готово! Отправьте ссылку сотруднику в любом мессенджере или
              покажите QR-код. При первом открытии в Telegram кабинет
              активируется автоматически. Ссылка действительна 7 дней.
            </div>
            <div className="flex justify-center">
              <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/5">
                <Image
                  src={tgResult.qrPngDataUrl}
                  alt="QR-код приглашения"
                  width={240}
                  height={brandQrHeightFor(240)}
                  className="h-auto"
                  unoptimized
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Ссылка</Label>
              <div className="flex gap-2">
                <Input readOnly value={tgResult.inviteUrl} />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCopy}
                  aria-label="Скопировать ссылку"
                >
                  <Copy className="size-4" />
                  {copied ? "Скопировано" : "Копировать"}
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
                Готово
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
                По email
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
                Telegram без пароля
              </button>
            </div>

            <div className="space-y-2">
              <Label htmlFor="user-name">
                Имя <span className="text-destructive">*</span>
              </Label>
              <Input
                id="user-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Иванов Иван"
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
                  Сотруднику на email придёт ссылка для установки пароля.
                  Ссылка действительна 7 дней.
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-[#eef0fb] bg-[#f8f9ff] p-3 text-[13px] text-[#5464ff]">
                Создадим сотрудника без email и пароля. Вы получите ссылку на
                бота и QR — отдадите сотруднику любым способом. Он откроет
                её и сразу попадёт в рабочий кабинет.
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="user-role">
                Должность <span className="text-destructive">*</span>
              </Label>
              <Select value={role} onValueChange={setRole} required>
                <SelectTrigger id="user-role" className="w-full">
                  <SelectValue placeholder="Выберите должность" />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="user-phone">
                Телефон <span className="text-destructive">*</span>
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
                По номеру сотрудник входит в приложение и связывается с
                TasksFlow. Без телефона задачи ему не дойдут.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Создание..." : "Пригласить"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
