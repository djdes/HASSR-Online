"use client";

import { useTranslations } from "next-intl";
import { SelectGroup, SelectItem, SelectLabel } from "@/components/ui/select";
import { getPositionLabelsGrouped, type UserLike } from "@/lib/user-roles";
import { calibrationPositionLabel } from "./equipment-calibration-presentation";

/** Keep original selection values and grouping; translate only fallback role labels. */
export function EquipmentCalibrationPositionItems({ users }: { users: UserLike[] }) {
  const t = useTranslations("equipmentCalibration");
  const groups = useTranslations("journalControls.positionSelect");
  const positions = getPositionLabelsGrouped(users);
  const roles = { manager: t("roles.manager"), head_chef: t("roles.head_chef"), cook: t("roles.cook"), waiter: t("roles.waiter") };
  return <>{(["management", "staff"] as const).map(group => positions[group].length > 0 && (
    <SelectGroup key={group}>
      <SelectLabel>{groups(group)} · {positions[group].length}</SelectLabel>
      {positions[group].map(value => <SelectItem key={value} value={value}>{calibrationPositionLabel(value, users, roles)}</SelectItem>)}
    </SelectGroup>
  ))}</>;
}
