import { PpkItemSkeleton } from "@/components/production-control/structure/item-skeleton";

/** Пока читаются данные пункта — скелет внутри уже открытого окна. */
export default function ItemModalLoading() {
  return <PpkItemSkeleton />;
}
