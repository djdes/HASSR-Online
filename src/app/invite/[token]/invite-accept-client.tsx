"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Library, Loader2 } from "lucide-react";
import { pluralRu } from "@/lib/plural-ru";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Status = "valid" | "expired" | "used" | "not_found";

type Props = {
  status: Status;
  token: string;
  invite: { userId: string; expiresAt: Date } | null;
  user: {
    name: string;
    email: string;
    organization: { name: string; kind: string; poolObjects: number };
  } | null;
};

export function InviteAcceptClient({ status, token, user }: Props) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (status !== "valid" || !user) {
    const title =
      status === "expired"
        ? "Приглашение устарело"
        : status === "used"
          ? "Приглашение уже использовано"
          : "Приглашение не найдено";
    const message =
      status === "expired"
        ? "Срок действия этой ссылки истёк. Попросите администратора организации прислать новое приглашение."
        : status === "used"
          ? "Эта ссылка уже была использована для установки пароля. Войдите обычным способом."
          : "Ссылка некорректна или была отозвана.";
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="items-start gap-2">
          <AlertTriangle className="size-8 text-[#d2453d]" />
          <CardTitle>{title}</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild className="w-full">
            <Link href="/login">Вернуться ко входу</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const isDirectory = user.organization.kind === "directory";
  const poolObjects = user.organization.poolObjects;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Пароль должен быть не короче 6 символов");
      return;
    }
    if (password !== confirm) {
      setError("Пароли не совпадают");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/invite/${token}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Не удалось установить пароль");
      }
      // Use the custom login endpoint so we write the site's primary
      // session cookie (`haccp-online.session-token`) rather than the
      // NextAuth cookie which our server components ignore.
      const login = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user?.email, password }),
      });
      if (!login.ok) {
        router.push("/login?invite=accepted");
      } else {
        // Сотрудник бэк-офиса — сразу в мастер-кабинет, без крюка через /dashboard.
        router.push(isDirectory ? "/master" : "/dashboard");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Добро пожаловать, {user.name}!</CardTitle>
        <CardDescription>
          Вас пригласили в <strong>{user.organization.name}</strong>.
          Установите пароль, чтобы войти.
        </CardDescription>
        {isDirectory && (
          <div className="mt-3 flex gap-3 rounded-2xl bg-[#eef1ff] p-4 text-sm leading-relaxed text-[#3c4053]">
            <Library className="mt-0.5 size-5 shrink-0 text-[#5566f6]" />
            <div>
              <p className="font-medium text-[#0b1024]">Мастер-кабинет справочников</p>
              <p className="mt-1">
                Вы загружаете меню и сырьё — из Excel, CSV или списком.
                {poolObjects > 0
                  ? ` ${poolObjects} ${pluralRu(poolObjects, "пищеблок получит", "пищеблока получат", "пищеблоков получат")} их сразу в журналы бракеража готовой продукции и скоропортящейся продукции.`
                  : " Пищеблоки, подключённые по коду справочника, получат их сразу в журналы бракеража."}
              </p>
              <p className="mt-1 text-[#6f7282]">Журналы и сотрудники пищеблоков в кабинете не показываются — только эти два списка.</p>
            </div>
          </div>
        )}
        <p className="mt-3 text-sm text-[#6f7282]">
          Логин для входа: <span className="font-medium text-[#0b1024]">{user.email}</span>
        </p>
      </CardHeader>
      <form onSubmit={submit}>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">{error}</div>
          )}
          <div className="space-y-2">
            <Label htmlFor="password">Пароль</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm">Подтвердите пароль</Label>
            <Input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            Установить пароль и войти
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
