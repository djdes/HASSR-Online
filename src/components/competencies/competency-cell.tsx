"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useFormatter } from "next-intl";
import { isCompetencyLevel, isCompetencySkill, saveCompetencyLevel, type competencyErrorKey } from "./competency-presentation";

const LEVEL_COLORS = ["bg-gray-200 text-gray-500", "bg-yellow-300 text-yellow-800", "bg-blue-400 text-white", "bg-green-500 text-white"];

interface Props {
  userId: string;
  userName: string;
  skill: string;
  level: number;
}

export function CompetencyCell({ userId, userName, skill, level: initialLevel }: Props) {
  const t = useTranslations("competenciesManagement");
  const format = useFormatter();
  const router = useRouter();
  const [level, setLevel] = useState(initialLevel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ReturnType<typeof competencyErrorKey> | null>(null);

  async function handleClick() {
    const previousLevel = level;
    const nextLevel = (level + 1) % 4;
    setLevel(nextLevel);
    setSaving(true);
    setError(null);

    try {
      const result = await saveCompetencyLevel({ userId, skill, level: nextLevel });
      if (!result.ok) {
        setLevel(previousLevel);
        setError(result.error);
        return;
      }
      router.refresh();
    } catch {
      setLevel(previousLevel);
      setError("saveFailed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="inline-flex flex-col items-center gap-1">
    <button
      type="button"
      onClick={handleClick}
      disabled={saving}
      className={`inline-flex items-center justify-center rounded-md size-8 text-xs font-bold transition-colors cursor-pointer ${LEVEL_COLORS[level]} ${saving ? "opacity-50" : "hover:ring-2 hover:ring-primary"}`}
      title={t("levelTitle", { level })}
      aria-label={t("cellLabel", { name: userName, skill: isCompetencySkill(skill) ? t(`skills.${skill}`) : skill, level: isCompetencyLevel(level) ? t(`levels.${level}`) : format.number(level) })}
      aria-busy={saving}
    >
      {format.number(level)}
    </button>
    {error && <span role="alert" className="max-w-44 text-xs text-destructive">{t(`errors.${error}`)}</span>}
    </div>
  );
}
