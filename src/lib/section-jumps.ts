/**
 * Куда вести человека из пустого списка выбора (владелец, 2026-11-19: «где
 * нужно указать сотрудников, оборудование и т. д. — переход в нужный раздел,
 * чтобы пользователь не искал»).
 *
 * Один справочник — один адрес: раздел, где его заполняют. Подписи ссылок —
 * `sharedUi.sectionJump.<вид>` на трёх языках. Модуль без React: его берут
 * компонент `SectionJump` и тест (каждый адрес — существующая страница).
 */
export const SECTION_JUMPS = {
  /** Сотрудники: список и приглашение. */
  staff: "/settings/users",
  /** Должности. */
  positions: "/settings/positions",
  /** Оборудование. */
  equipment: "/settings/equipment",
  /** Объекты и помещения внутри них. */
  buildings: "/settings/buildings",
  /** Цеха и участки. */
  areas: "/settings/areas",
  /** Справочник продуктов. */
  products: "/settings/products",
} as const;

export type SectionJumpKind = keyof typeof SECTION_JUMPS;

export const SECTION_JUMP_KINDS = Object.keys(SECTION_JUMPS) as SectionJumpKind[];
