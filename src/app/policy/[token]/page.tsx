import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import type { PolicyData } from "@/lib/ppk/records";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Политика качества",
  robots: { index: false, follow: false },
};

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Публичная страница политики качества `/policy/<token>`: открывается по QR с
 * листа в цехе, без входа. Токен — единственный ключ; «Сменить ссылку» в кабинете
 * выпускает новый, старый перестаёт находить запись.
 */
export default async function PublicPolicyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) notFound();

  const record = await db.ppkRecord.findFirst({
    where: { block: "policy", data: { path: ["token"], equals: token } },
    select: { data: true, organization: { select: { name: true, logoUrl: true } } },
  });
  if (!record) notFound();
  const data = record.data as unknown as PolicyData;
  const t = await getTranslations("acknowledge");

  const paragraphs = data.text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  return (
    <main className="min-h-screen bg-[#f4f5fb]">
      <div className="mx-auto w-full max-w-[680px] px-4 py-10">
        <div className="rounded-3xl border border-[#ececf4] bg-white p-6 shadow-[0_20px_60px_-40px_rgba(11,16,36,0.35)] sm:p-9">
          <div className="flex items-center gap-3">
            {record.organization.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={record.organization.logoUrl} alt="" className="h-12 w-auto max-w-[160px] object-contain" />
            ) : null}
            <div className="text-[15px] font-semibold text-[#0b1024]">{record.organization.name}</div>
          </div>
          <h1 className="mt-6 text-[22px] font-semibold leading-tight tracking-[-0.02em] text-[#0b1024]">
            Политика в области качества и безопасности пищевой продукции
          </h1>
          <div className="mt-5 space-y-3 text-[15px] leading-[1.65] text-[#0b1024]">
            {paragraphs.map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
          {/* Сотрудник входит в кабинет и отмечает ознакомление (нужен вход). */}
          <Link
            href="/acknowledge/policy"
            className="mt-7 inline-flex h-11 items-center rounded-2xl border border-[#dcdfed] bg-white px-5 text-[14px] font-medium text-[#0b1024] transition-colors duration-150 hover:border-[#5566f6]/40 hover:bg-[#f5f6ff] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#5566f6]/15"
          >
            {t("publicButton")}
          </Link>
        </div>
      </div>
    </main>
  );
}
