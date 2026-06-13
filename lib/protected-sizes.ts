export const PROTECTED_SIZE_NAME = "Taille unique";
export const PROTECTED_SIZE_PFS_REF = "TU";

/**
 * Virtual id used in the UI when « Taille unique » is not yet stored in the
 * database. It is replaced by the real cuid at save time (cf. resolveProtectedSizeId
 * in app/actions/admin/products.ts).
 */
export const PROTECTED_SIZE_VIRTUAL_ID = "__taille_unique__";

/** Returns true when the size name matches the protected « Taille unique » entry. */
export function isProtectedSizeName(name: string | null | undefined): boolean {
  if (!name) return false;
  return name.trim().toLowerCase() === PROTECTED_SIZE_NAME.toLowerCase();
}

/** Returns true when the given id is the virtual « Taille unique » placeholder. */
export function isProtectedSizeVirtualId(id: string | null | undefined): boolean {
  return id === PROTECTED_SIZE_VIRTUAL_ID;
}

/**
 * Ensures « Taille unique » is present at the top of a size list returned to the UI.
 * If a real row already exists in the input, the list is returned unchanged.
 * Otherwise a virtual entry (with PROTECTED_SIZE_VIRTUAL_ID) is prepended.
 */
export function withProtectedSize<T extends { id: string; name: string }>(
  sizes: T[],
): (T | { id: string; name: string })[] {
  if (sizes.some((s) => isProtectedSizeName(s.name))) return sizes;
  return [{ id: PROTECTED_SIZE_VIRTUAL_ID, name: PROTECTED_SIZE_NAME }, ...sizes];
}

export interface SizeManagerItem {
  id: string;
  name: string;
  position: number;
  variantCount: number;
  pfsSizeRef: string | null;
}

/** Same as withProtectedSize but for the admin SizesManager item shape. */
export function withProtectedSizeItem(items: SizeManagerItem[]): SizeManagerItem[] {
  if (items.some((s) => isProtectedSizeName(s.name))) return items;
  return [
    {
      id: PROTECTED_SIZE_VIRTUAL_ID,
      name: PROTECTED_SIZE_NAME,
      position: 0,
      variantCount: 0,
      pfsSizeRef: PROTECTED_SIZE_PFS_REF,
    },
    ...items,
  ];
}
