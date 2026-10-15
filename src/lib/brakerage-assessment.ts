import type { BrakerageCommissionMember, BrakerageRowSignature } from "@/lib/brakerage-commission";

function gradeKey(value: string) {
  return value.trim().toLocaleLowerCase("ru").replace(/\s+/g, "");
}

export function brakerageCommentRequired(grade: string): boolean {
  return gradeKey(grade) !== "отлично";
}

export function brakerageRelease(grade: string): "yes" | "no" {
  return ["неудовлетворительно", "недоброкачественно", "недоброкачественная", "poor_quality", "non_compliant"].includes(gradeKey(grade)) ? "no" : "yes";
}

/** Each assessor owns their assessment. Another member cannot clear a rejection. */
export function aggregateBrakerageAssessment(signatures: readonly Pick<BrakerageRowSignature, "grade">[], grade: string) {
  const grades = [...signatures.map(item => item.grade ?? ""), grade].filter(Boolean);
  const denied = grades.find(value => brakerageRelease(value) === "no");
  const rank = (value: string) => ({ "отлично": 4, "хорошо": 3, "удовлетворительно": 2 }[gradeKey(value)] ?? 3);
  return {
    grade: denied ?? grades.reduce((worst, value) => rank(value) < rank(worst) ? value : worst, grade),
    releaseAllowed: denied ? "no" as const : "yes" as const,
  };
}

export function allCommissionMembersAssessed(
  row: { productName?: string; portionWeight?: string; signatures?: readonly BrakerageRowSignature[] },
  members: readonly BrakerageCommissionMember[],
): boolean {
  return members.length > 0 && members.every(member => member.employeeId && row.signatures?.some(signature =>
    signature.userId === member.employeeId && Boolean(signature.grade?.trim()) && !signature.outdated &&
    ["productName", "portionWeight"].every(key => {
      const previous = signature.snapshot?.[key];
      const current = row[key as "productName" | "portionWeight"];
      return previous === undefined || current === undefined || previous.trim() === current.trim();
    })
  ));
}

/** Input is HHMM only; stored journal times remain HH:mm. */
export function parseBrakerageTimeDigits(value: string): string | null {
  return /^(?:[01]\d|2[0-3])[0-5]\d$/.test(value) ? `${value.slice(0, 2)}:${value.slice(2)}` : null;
}

export function brakerageTimeDigits(value: string): string {
  const match = /(\d{2}):(\d{2})$/.exec(value.trim());
  return match ? `${match[1]}${match[2]}` : value.replace(/\D/g, "").slice(0, 4);
}

export function formatBrakerageDateTime(value: string): string {
  return value.replace(/^(\d{4})-(\d{2})-(\d{2})(?:T| )?/, (_match, year, month, day) => `${day}-${month}-${year}${value.length > 10 ? " " : ""}`);
}
