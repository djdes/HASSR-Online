import { MapPin } from "lucide-react";

/** Режим «через вход»: вошёл сотрудник другой точки — объяснение вместо пустого списка. */
export function OtherPointScreen({ title, description, pointName }: { title: string; description: string; pointName: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#fafbff] px-4 py-10">
      <div className="w-full max-w-md rounded-3xl border border-[#ececf4] bg-white p-8 text-center shadow-[0_20px_60px_-30px_rgba(11,16,36,0.2)]">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-[#eef1ff] text-[#5566f6]">
          <MapPin className="size-6" />
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[#0b1024]">{title}</h1>
        {pointName ? (
          <span className="mt-3 inline-flex rounded-full bg-[#f5f6ff] px-3 py-1 text-[13px] font-medium text-[#3848c7]">{pointName}</span>
        ) : null}
        <p className="mt-3 text-[14px] leading-relaxed text-[#6f7282]">{description}</p>
      </div>
    </main>
  );
}
