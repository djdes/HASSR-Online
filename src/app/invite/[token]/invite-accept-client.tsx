"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Eye,
  EyeOff,
  Library,
  Loader2,
} from "lucide-react";
import { BILLING_LIMIT_CODE } from "@/lib/billing-period";
import { BrandLogo } from "@/components/brand/logo";

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
  /** Переход по ссылке восстановления пароля (`?reset=1` или уже активный пользователь). */
  isReset?: boolean;
};

export function InviteAcceptClient({ status, token, user, isReset = false }: Props) {
  const t = useTranslations("authInvite");
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<InviteError | null>(null);
  const [loading, setLoading] = useState(false);

  if (status !== "valid" || !user) {
    const title = status === "expired"
      ? t(isReset ? "reset.expiredTitle" : "invalid.expiredTitle")
      : status === "used"
        ? t(isReset ? "reset.usedTitle" : "invalid.usedTitle")
        : t(isReset ? "reset.missingTitle" : "invalid.missingTitle");
    const message = status === "expired"
      ? t(isReset ? "reset.expiredMessage" : "invalid.expiredMessage")
      : status === "used"
        ? t(isReset ? "reset.usedMessage" : "invalid.usedMessage")
        : t(isReset ? "reset.missingMessage" : "invalid.missingMessage");
    return (
      <div className="relative z-10 w-full max-w-[420px]">
        <div className="mb-6 flex justify-center">
          <Link href="/" className="text-[#0b1024]" aria-label="WeSetup">
            <BrandLogo height={24} title="" />
          </Link>
        </div>
        <div className="rounded-3xl border border-[#dcdfed] bg-white p-7 shadow-[0_20px_50px_-24px_rgba(11,16,36,0.12)] sm:p-8">
          <div className="mb-4 inline-flex size-11 items-center justify-center rounded-2xl bg-[#fff4f2] text-[#d2453d]">
            <AlertTriangle className="size-5" />
          </div>
          <h1 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
            {title}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[#6f7282]">
            {message}
          </p>
          <Link
            href="/login"
            className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-colors hover:bg-[#4a5bf0]"
          >
            <span>{t("invalid.backToLogin")}</span>
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    );
  }

  const inviteUser = user;
  const masterCabinet = inviteUser.masterCabinet ?? null;
  const isDirectory = !isReset && (inviteUser.organization.kind === "directory" || masterCabinet !== null);
  const poolObjects = masterCabinet ? masterCabinet.poolObjects : inviteUser.organization.poolObjects;
  const hasDistinctName =
    Boolean(inviteUser.name.trim()) &&
    inviteUser.name.trim().toLowerCase() !== inviteUser.email.trim().toLowerCase();

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
          setError({
            key: seatLimitKey(body.nextTier),
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
    <div className="relative z-10 w-full max-w-[420px]">
      <div className="mb-6 flex justify-center">
        <Link href="/" className="text-[#0b1024]" aria-label="WeSetup">
          <BrandLogo height={24} title="" />
        </Link>
      </div>

      <div className="rounded-3xl border border-[#dcdfed] bg-white p-7 shadow-[0_20px_50px_-24px_rgba(11,16,36,0.12)] sm:p-8">
        <div>
          <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
            {isReset
              ? t("reset.title")
              : t.rich("welcomeTitle", {
                  name: hasDistinctName ? inviteUser.name : inviteUser.email,
                  strong: (chunks) => <strong className="font-semibold">{chunks}</strong>,
                })}
          </h1>
          <p className="mt-2 text-[14px] leading-relaxed text-[#6f7282]">
            {isReset
              ? t.rich("reset.description", {
                  email: inviteUser.email,
                  strong: (chunks) => <strong className="font-medium text-[#0b1024]">{chunks}</strong>,
                })
              : t.rich("invitedToOrganization", {
                  organization: inviteUser.organization.name,
                  strong: (chunks) => <strong className="font-medium text-[#0b1024]">{chunks}</strong>,
                })}
          </p>

          {isDirectory && (
            <div className="mt-4 flex gap-3 rounded-2xl bg-[#eef1ff] p-4 text-[13.5px] leading-relaxed text-[#3c4053]">
              <Library className="mt-0.5 size-5 shrink-0 text-[#5566f6]" />
              <div>
                <p className="font-medium text-[#0b1024]">
                  {masterCabinet
                    ? t("directory.headingWithCabinet", { cabinet: masterCabinet.name })
                    : t("directory.heading")}
                </p>
                <p className="mt-1">
                  {t("directory.uploadDescription")}{" "}
                  {poolObjects > 0
                    ? t("directory.poolAccess", { count: poolObjects })
                    : t("directory.poolAccessWithoutCount")}
                </p>
                <p className="mt-1 text-[#6f7282]">{t("directory.hiddenDataNote")}</p>
              </div>
            </div>
          )}

          {!isReset && hasDistinctName && (
            <p className="mt-3 text-[13px] text-[#6f7282]">
              {t("loginEmail")} <span className="font-medium text-[#0b1024]">{inviteUser.email}</span>
            </p>
          )}
        </div>

        <form onSubmit={submit} className="mt-6 space-y-3.5">
          {error && (
            <div
              role="alert"
              className="rounded-2xl border border-[#ffd2cd] bg-[#fff4f2] px-4 py-3 text-[13px] leading-relaxed text-[#d2453d]"
            >
              {"activeUsers" in error
                ? t(error.key, { activeUsers: error.activeUsers, limit: error.limit })
                : t(error.key)}
            </div>
          )}

          <div className="relative flex items-center">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t(isReset ? "reset.setPlaceholder" : "password.setPlaceholder")}
              aria-label={t("password.setLabel")}
              autoComplete="new-password"
              minLength={6}
              required
              autoFocus
              className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 pr-11 text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-[border-color,box-shadow] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 rounded-lg p-1 text-[#8a8ea4] transition-colors hover:text-[#5566f6] focus:outline-none focus-visible:text-[#5566f6]"
              aria-label={showPassword ? t("password.hide") : t("password.show")}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>

          <div className="relative flex items-center">
            <input
              id="confirm"
              name="confirm"
              type={showConfirm ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={t(isReset ? "reset.confirmPlaceholder" : "password.confirmPlaceholder")}
              aria-label={t("password.confirmLabel")}
              autoComplete="new-password"
              required
              className="h-11 w-full rounded-2xl border border-[#dcdfed] bg-white px-4 pr-11 text-[16px] text-[#0b1024] placeholder:text-[#9b9fb3] transition-[border-color,box-shadow] focus:border-[#5566f6] focus:outline-none focus:ring-4 focus:ring-[#5566f6]/15"
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute right-3 rounded-lg p-1 text-[#8a8ea4] transition-colors hover:text-[#5566f6] focus:outline-none focus-visible:text-[#5566f6]"
              aria-label={showConfirm ? t("password.hide") : t("password.show")}
              tabIndex={-1}
            >
              {showConfirm ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={loading}
              className="group relative flex h-11 w-full items-center justify-center gap-2 overflow-hidden rounded-2xl bg-[#5566f6] px-5 text-[15px] font-medium text-white shadow-[0_10px_30px_-12px_rgba(85,102,246,0.55)] transition-all hover:bg-[#4a5bf0] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5566f6]/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:opacity-70"
            >
              {loading ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  <span>{t("submitLoading")}</span>
                </>
              ) : (
                <>
                  <span className="relative z-10">
                    {t(isReset ? "reset.submit" : "password.submit")}
                  </span>
                  <ArrowRight className="relative z-10 size-4 transition-transform group-hover:translate-x-0.5" />
                  <span
                    aria-hidden
                    className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                  />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
