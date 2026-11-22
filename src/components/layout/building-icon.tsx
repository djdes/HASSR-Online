import {
  Baby,
  Building2,
  CakeSlice,
  ChefHat,
  Coffee,
  Croissant,
  Dumbbell,
  Factory,
  Fuel,
  GraduationCap,
  Hospital,
  Hotel,
  Pizza,
  School,
  ShoppingCart,
  Store,
  Tent,
  Truck,
  UtensilsCrossed,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { parseBuildingIcon, type BuildingIconKey } from "@/lib/building-icons";
import { cn } from "@/lib/utils";

/** Картинки библиотеки (`lib/building-icons.ts`): тот же порядок и те же ключи. */
export const BUILDING_ICON_COMPONENTS: Record<BuildingIconKey, LucideIcon> = {
  store: Store,
  cart: ShoppingCart,
  coffee: Coffee,
  chef: ChefHat,
  canteen: UtensilsCrossed,
  bakery: Croissant,
  pizza: Pizza,
  confectionery: CakeSlice,
  school: School,
  kindergarten: Baby,
  college: GraduationCap,
  hospital: Hospital,
  hotel: Hotel,
  camp: Tent,
  fitness: Dumbbell,
  factory: Factory,
  warehouse: Warehouse,
  delivery: Truck,
  fuel: Fuel,
  office: Building2,
};

/**
 * Значок объекта везде, где объект показан одной строкой: лист «Объекты»,
 * меню объектов в шапке, полоса текущего объекта, страница объекта.
 * Типовой значок — линией в цвет текста (`className` задаёт размер и цвет);
 * свой — картинкой того же размера со скруглением. Пусто — по виду объекта.
 */
export function BuildingIcon({
  icon,
  office = false,
  className,
  uploadClassName,
}: {
  icon?: string | null;
  office?: boolean;
  className?: string;
  /** Размер своей картинки, если он больше линейного значка (плашка 36px — картинка 28px). */
  uploadClassName?: string;
}) {
  const value = parseBuildingIcon(icon);
  if (value?.kind === "upload") {
    return (
      // Свой файл раздаёт наш же адрес с версией — next/image тут не нужен.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={value.url}
        alt=""
        aria-hidden
        draggable={false}
        data-building-icon="upload"
        className={cn("shrink-0 rounded-[6px] object-contain", uploadClassName ?? className)}
      />
    );
  }
  const Icon = value ? BUILDING_ICON_COMPONENTS[value.key] : office ? Building2 : Store;
  return <Icon aria-hidden data-building-icon={value?.key ?? (office ? "office-default" : "default")} className={cn("shrink-0", className)} />;
}
