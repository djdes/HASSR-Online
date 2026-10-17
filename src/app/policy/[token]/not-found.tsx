import { getTranslations } from "next-intl/server";

/** Ссылка на политику устарела или неверна: объясняем, что делать. */
export default async function PolicyNotFound() {
  const t = await getTranslations("productionControl.publicPolicy");
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f5fb] px-4">
      <p className="max-w-[420px] rounded-3xl border border-[#ececf4] bg-white p-8 text-center text-[15px] leading-[1.6] text-[#3c4053]">
        {t("notFound")}
      </p>
    </main>
  );
}
