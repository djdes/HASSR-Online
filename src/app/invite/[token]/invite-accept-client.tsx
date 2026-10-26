"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Library, Loader2 } from "lucide-react";
import { BILLING_LIMIT_CODE } from "@/lib/billing-period";
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
type InviteError =
  | { key: "password.tooShort" | "password.mismatch" | "password.invalidInvite" | "password.failure" | "password.genericError" }
  | {
      /** Места заняты: просьба к руководителю по следующему тарифу (`nextTier` ответа 402). */
      key: "password.seatLimit" | "password.seatLimitStandard" | "password.seatLimitPremium" | "password.seatLimitContact";
      activeUsers: number;
      limit: number;
    };

/** Какой текст отказа по местам: следующий тариф или «по согласованию» у «Премиума». */
function seatLimitKey(nextTier: unknown): Extract<InviteError, { activeUsers: number }>["key"] {
  if (nextTier === "standard") return "password.seatLimitStandard";
  if (nextTier === "premium") return "password.seatLimitPremium";
  if (nextTier === null) return "password.seatLimitContact";
  return "password.seatLimit";
}

type Props = {
  status: Status;
  token: string;
  invite: { userId: string; expiresAt: Date } | null;
  user: {
    name: string;
    email: string;
    organization: { name: string; kind: string; poolObjects: number };
    masterCabinet?: { id: string; name: string; poolObjects: number } | null;
  } | null;
};

export function InviteAcceptClient({ status, token, user }: Props) {
  const t = useTranslations("authInvite");
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<InviteError | null>(null);
  const [loading, setLoading] = useState(false);

  if (status !== "valid" || !user) {
    const title = status === "expired"
      ? t("invalid.expiredTitle")
      : status === "used"
        ? t("invalid.usedTitle")
        : t("invalid.missingTitle");
    const message = status === "expired"
      ? t("invalid.expiredMessage")
      : status === "used"
        ? t("invalid.usedMessage")
        : t("invalid.missingMessage");
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="items-start gap-2">
          <AlertTriangle className="size-8 text-[#d2453d]" />
          <CardTitle>{title}</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild className="w-full">
            <Link href="/login">{t("invalid.backToLogin")}</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  const inviteUser = user;
  const masterCabinet = inviteUser.masterCabinet ?? null;
  const isDirectory = inviteUser.organization.kind === "directory" || masterCabinet !== null;
  const poolObjects = masterCabinet ? masterCabinet.poolObjects : inviteUser.organization.poolObjects;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError({ key: "password.tooShort" });
      return;
    }
    if (password !== confirm) {
      setError({ key: "password.mismatch" });
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
        if (body?.code === "invalid_invite") {
          setError({ key: "password.invalidInvite" });
        } else if (body?.code === "invalid_password") {
          setError({ key: "password.tooShort" });
        } else if (body?.code === BILLING_LIMIT_CODE) {
          setError({ key: seatLimitKey(body.nextTier),
            activeUsers: Number.isFinite(body.activeUsers) ? body.activeUsers : 0,
            limit: Number.isFinite(body.limit) ? body.limit : 0,
          });
        } else {
          setError({ key: "password.failure" });
        }
        return;
      }
      // The regular password login issues the session cookie and clears any other session left in this browser.
      const login = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteUser.email, password }),
      });
      if (!login.ok) {
        router.push("/login?invite=accepted");
      } else {
        if (masterCabinet) {
          await fetch("/api/me/active-organization", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ organizationId: masterCabinet.id }),
          }).catch(() => null);
          window.location.assign("/master");
          return;
        }
        router.push(isDirectory ? "/master" : "/dashboard");
        router.refresh();
      }
    } catch {
      setError({ key: "password.genericError" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>{t.rich("welcomeTitle", { name: user.name, strong: (chunks) => <strong>{chunks}</strong> })}</CardTitle>
        <CardDescription>
          {t.rich("invitedToOrganization", {
            organization: user.organization.name,
            strong: (chunks) => <strong>{chunks}</strong>,
          })}
        </CardDescription>
        {isDirectory && (
          <div className="mt-3 flex gap-3 rounded-2xl bg-[#eef1ff] p-4 text-sm leading-relaxed text-[#3c4053]">
            <Library className="mt-0.5 size-5 shrink-0 text-[#5566f6]" />
            <div>
              <p className="font-medium text-[#0b1024]">
                {masterCabinet
                  ? t("directory.headingWithCabinet", { cabinet: masterCabinet.name })
                  : t("directory.heading")}
              </p>
              <p className="mt-1">
                {t("directory.uploadDescription")} {poolObjects > 0
                  ? t("directory.poolAccess", { count: poolObjects })
                  : t("directory.poolAccessWithoutCount")}
              </p>
              <p className="mt-1 text-[#6f7282]">{t("directory.hiddenDataNote")}</p>
            </div>
          </div>
        )}
        <p className="mt-3 text-sm text-[#6f7282]">
          {t("loginEmail")} <span className="font-medium text-[#0b1024]">{user.email}</span>
        </p>
      </CardHeader>
      <form onSubmit={submit}>
        <CardContent className="space-y-4">
          {error && (
            <div role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-600">
              {"activeUsers" in error
                ? t(error.key, { activeUsers: error.activeUsers, limit: error.limit })
                : t(error.key)}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="password">{t("password.setLabel")}</Label>
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
            <Label htmlFor="confirm">{t("password.confirmLabel")}</Label>
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
            {loading ? t("submitLoading") : t("password.submit")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
