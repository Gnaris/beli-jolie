"use client";

import { useState, useMemo, type ReactNode } from "react";
import CustomSelect, { type SelectOption } from "@/components/ui/CustomSelect";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type SortMode =
  | "default"
  | "name-asc"
  | "name-desc"
  | "ref-asc"
  | "ref-desc"
  | "category"
  | "price-asc"
  | "price-desc"
  | "qty-asc"
  | "qty-desc";

export interface SortableOrderItem {
  id: string;
  productName: string;
  productRef: string;
  unitPrice: number | { toNumber?: () => number };
  lineTotal: number | { toNumber?: () => number };
  quantity: number;
  variantSnapshot?: string | null;
}

interface Props<T extends SortableOrderItem> {
  items: T[];
  renderItem: (item: T) => ReactNode;
  labels: {
    sortBy: string;
    default: string;
    nameAsc: string;
    nameDesc: string;
    refAsc: string;
    refDesc: string;
    category: string;
    priceAsc: string;
    priceDesc: string;
    qtyAsc: string;
    qtyDesc: string;
    uncategorized: string;
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function extractCategory(item: SortableOrderItem): string | null {
  if (!item.variantSnapshot) return null;
  try {
    const snap = JSON.parse(item.variantSnapshot);
    return snap.categoryName ?? null;
  } catch {
    return null;
  }
}

const toNum = (v: number | { toNumber?: () => number }) =>
  typeof v === "number" ? v : Number(v);

/* ------------------------------------------------------------------ */
/*  Sort options                                                       */
/* ------------------------------------------------------------------ */

/* SVG icon paths (Heroicons outline, 24×24 viewBox) */
const ICONS = {
  // bars-3 (default order)
  default:   "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5",
  // bars-arrow-down (A→Z)
  nameAsc:   "M3 4.5h14.25M3 9h9.75M3 13.5h5.25m8.25 4.5v-6m0 0l3 3m-3-3l-3 3",
  // bars-arrow-up (Z→A)
  nameDesc:  "M3 4.5h14.25M3 9h9.75M3 13.5h9.75m4.5-4.5v6m0 0l-3-3m3 3l3-3",
  // hashtag (ref asc)
  refAsc:    "M5.25 8.25h15m-16.5 7.5h15m-1.8-13.5l-3.9 19.5m-2.1-19.5l-3.9 19.5",
  // hashtag (ref desc)
  refDesc:   "M5.25 8.25h15m-16.5 7.5h15m-1.8-13.5l-3.9 19.5m-2.1-19.5l-3.9 19.5",
  // tag (category)
  category:  "M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z M6 6h.008v.008H6V6z",
  // currency-euro (price asc)
  priceAsc:  "M14.25 7.756a4.5 4.5 0 100 8.488M7.5 10.5h5.25m-5.25 3h5.25M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  // currency-euro (price desc)
  priceDesc: "M14.25 7.756a4.5 4.5 0 100 8.488M7.5 10.5h5.25m-5.25 3h5.25M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  // cube (qty asc)
  qtyAsc:    "M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9",
  // cube (qty desc)
  qtyDesc:   "M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9",
};

const SORT_ENTRIES: { value: SortMode; labelKey: keyof Props<SortableOrderItem>["labels"]; icon: string }[] = [
  { value: "default",    labelKey: "default",   icon: ICONS.default },
  { value: "name-asc",   labelKey: "nameAsc",   icon: ICONS.nameAsc },
  { value: "name-desc",  labelKey: "nameDesc",  icon: ICONS.nameDesc },
  { value: "ref-asc",    labelKey: "refAsc",    icon: ICONS.refAsc },
  { value: "ref-desc",   labelKey: "refDesc",   icon: ICONS.refDesc },
  { value: "category",   labelKey: "category",  icon: ICONS.category },
  { value: "price-asc",  labelKey: "priceAsc",  icon: ICONS.priceAsc },
  { value: "price-desc", labelKey: "priceDesc", icon: ICONS.priceDesc },
  { value: "qty-asc",    labelKey: "qtyAsc",    icon: ICONS.qtyAsc },
  { value: "qty-desc",   labelKey: "qtyDesc",   icon: ICONS.qtyDesc },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function OrderItemsSortable<T extends SortableOrderItem>({
  items,
  renderItem,
  labels,
}: Props<T>) {
  const [sort, setSort] = useState<SortMode>("default");

  const sorted = useMemo(() => {
    const arr = [...items];
    switch (sort) {
      case "name-asc":
        return arr.sort((a, b) => a.productName.localeCompare(b.productName, "fr"));
      case "name-desc":
        return arr.sort((a, b) => b.productName.localeCompare(a.productName, "fr"));
      case "ref-asc":
        return arr.sort((a, b) => a.productRef.localeCompare(b.productRef, "fr"));
      case "ref-desc":
        return arr.sort((a, b) => b.productRef.localeCompare(a.productRef, "fr"));
      case "price-asc":
        return arr.sort((a, b) => toNum(a.unitPrice) - toNum(b.unitPrice));
      case "price-desc":
        return arr.sort((a, b) => toNum(b.unitPrice) - toNum(a.unitPrice));
      case "qty-asc":
        return arr.sort((a, b) => a.quantity - b.quantity);
      case "qty-desc":
        return arr.sort((a, b) => b.quantity - a.quantity);
      case "category":
        return arr; // handled separately with grouping
      default:
        return arr;
    }
  }, [items, sort]);

  /* Category grouping */
  const grouped = useMemo(() => {
    if (sort !== "category") return null;
    const map = new Map<string, T[]>();
    for (const item of items) {
      const cat = extractCategory(item) ?? labels.uncategorized;
      const list = map.get(cat);
      if (list) list.push(item);
      else map.set(cat, [item]);
    }
    // Sort categories alphabetically, "uncategorized" at end
    return [...map.entries()].sort((a, b) => {
      if (a[0] === labels.uncategorized) return 1;
      if (b[0] === labels.uncategorized) return -1;
      return a[0].localeCompare(b[0], "fr");
    });
  }, [items, sort, labels.uncategorized]);

  const selectOptions: SelectOption[] = useMemo(
    () => SORT_ENTRIES.map((e) => ({ value: e.value, label: labels[e.labelKey], icon: e.icon })),
    [labels],
  );

  return (
    <>
      {/* Sort control */}
      <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <span className="text-xs font-body text-text-muted">{labels.sortBy}</span>
        <CustomSelect
          value={sort}
          onChange={(v) => setSort(v as SortMode)}
          options={selectOptions}
          size="sm"
          aria-label={labels.sortBy}
          className="w-52"
        />
      </div>

      {/* Items */}
      <div className="divide-y divide-border-light">
        {sort === "category" && grouped
          ? grouped.map(([catName, catItems]) => (
              <div key={catName}>
                {/* Category header */}
                <div className="px-5 py-2.5 bg-bg-secondary">
                  <p className="text-xs font-heading font-semibold text-text-secondary uppercase tracking-wide">
                    {catName}
                    <span className="ml-2 text-text-muted font-normal">({catItems.length})</span>
                  </p>
                </div>
                <div className="divide-y divide-border-light">
                  {catItems.map((item) => renderItem(item))}
                </div>
              </div>
            ))
          : sorted.map((item) => renderItem(item))}
      </div>
    </>
  );
}
