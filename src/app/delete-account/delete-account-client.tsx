"use client";

import { useEffect, useState, type ReactNode } from "react";
import { signOut } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";

import { signOutOnThisDevice } from "@/app/mini/_lib/signed-out-mark";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { accountDeletionErrorKey, type AccountDeletionErrorKey } from "@/lib/account-deletion-localization";

const SUPPORT_EMAIL = "support@wesetup.ru";

export function DeleteAccountFlow({
  renderTrigger,
}: {
  renderTrigger: (open: () => void, busy: boolean) => ReactNode;
}) {
  const t = useTranslations("accountDeletion");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmationWord, setConfirmationWord] = useState("");
  const [ownerRedirect, setOwnerRedirect] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<AccountDeletionErrorKey | "network" | null>(null);

  const errorMessage = (key: AccountDeletionErrorKey | "network"): ReactNode => {
    switch (key) {
      case "network": return t("errors.network");
      case "sessionRequired": return t("errors.sessionRequired");
      case "confirmationRequired": return t("errors.confirmationRequired");
      case "sharedDevice": return t("errors.sharedDevice");
      case "partnerContext": return t("errors.partnerContext");
      case "accountNotFound": return t("errors.accountNotFound");
      case "platformAdmin": return t("errors.platformAdmin");
      case "demoOrganization": return t("errors.demoOrganization");
      case "lastManager":
        return t.rich("errors.lastManager", {
          email: SUPPORT_EMAIL,
          supportAddress: chunks => <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold underline">{chunks}</a>,
        });
      case "ownerMustDeleteOrganization": return t("errors.ownerMustDeleteOrganization");
      case "unknown": return t("errors.unknown");
    }
  };

  async function handleDelete() {
    setErrorKey(null);
    setBusy(true);
    type Reply = { ok?: boolean; error?: string; errorCode?: string; redirect?: string } | null;
    let data: Reply;
    let status: number;
    try {
      const response = await fetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "УДАЛИТЬ" }),
      });
      status = response.status;
      data = (await response.json().catch(() => null)) as Reply;
    } catch {
      setBusy(false);
      setConfirmOpen(false);
      setErrorKey("network");
      return;
    }
    setConfirmOpen(false);

    if (status === 200 && data?.ok) {
      await signOutOnThisDevice({
        fetch: (input, init) => fetch(input, init),
        signOut: () => signOut({ redirect: false }),
      }).catch(() => undefined);
      window.location.replace("/mini/login?deleted=1");
      return;
    }
    setBusy(false);
    if (status === 409 && data?.redirect) {
      setOwnerRedirect(data.redirect);
      return;
    }
    setErrorKey(accountDeletionErrorKey(data?.errorCode));
  }

  const openConfirm = () => {
    setErrorKey(null);
    setConfirmationWord(t("flow.confirmationWord"));
    setConfirmOpen(true);
  };

  return (
    <>
      {renderTrigger(openConfirm, busy)}
      {errorKey ? (
        <div className="mini-err" role="alert" data-testid="delete-account-error">
          {errorMessage(errorKey)}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDelete}
        title={t("flow.confirmTitle")}
        description={t.rich("flow.confirmDescription", {
          confirmationWord,
          word: chunks => <strong>{chunks}</strong>,
        })}
        bullets={[
          { label: t("flow.confirmAccess"), tone: "warn" },
          { label: t("flow.confirmData"), tone: "warn" },
          { label: t("flow.confirmRecords"), tone: "info" },
        ]}
        confirmLabel={t("flow.confirmAction")}
        cancelLabel={t("flow.cancel")}
        variant="danger"
        typeToConfirm={confirmationWord}
      />

      <ConfirmDialog
        open={ownerRedirect !== null}
        onClose={() => setOwnerRedirect(null)}
        onConfirm={() => {
          if (ownerRedirect) window.location.assign(ownerRedirect);
        }}
        title={t("flow.ownerTitle")}
        description={t("flow.ownerDescription")}
        bullets={[
          { label: t("flow.ownerDelay"), tone: "info" },
          { label: t("flow.ownerCascade"), tone: "warn" },
          { label: t("flow.ownerBackup"), tone: "default" },
        ]}
        confirmLabel={t("flow.ownerAction")}
        cancelLabel={t("flow.ownerCancel")}
        variant="warn"
      />
    </>
  );
}

export function DeleteAccountButton() {
  const t = useTranslations("accountDeletion");
  return (
    <DeleteAccountFlow
      renderTrigger={(open, busy) => (
        <button
          type="button"
          onClick={open}
          disabled={busy}
          className="mini-btn-danger mini-press w-full disabled:opacity-50"
          data-testid="delete-account-button"
          aria-label={t("flow.button")}
        >
          <Trash2 className="size-5" aria-hidden />
          {busy ? t("flow.buttonBusy") : t("flow.button")}
        </button>
      )}
    />
  );
}

export function DeleteAccountThemeRoot({
  theme,
  children,
}: {
  theme: "light" | "dark" | null;
  children: ReactNode;
}) {
  const [resolved, setResolved] = useState<"light" | "dark">(theme ?? "light");
  useEffect(() => {
    if (theme) return;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return;
    const apply = () => setResolved(media.matches ? "dark" : "light");
    apply();
    media.addEventListener?.("change", apply);
    return () => media.removeEventListener?.("change", apply);
  }, [theme]);

  return <div className="mini-root min-h-dvh" data-theme={resolved}>{children}</div>;
}
