"use server";

import { z } from "zod";
import { revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/auth-helpers";
import { setSiteConfig } from "@/lib/site-config-write";

const InputSchema = z.object({
  type: z.enum(["percent", "fixed", "multiplier"]),
  value: z.number().finite(),
  rounding: z.enum(["none", "down", "up"]),
});

export type UpdatePfsImportPriceMarkupInput = z.infer<typeof InputSchema>;

export async function updatePfsImportPriceMarkup(
  input: UpdatePfsImportPriceMarkupInput
): Promise<{ success: boolean; error?: string }> {
  try {
    await requireAdmin();
    const parsed = InputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues.map((i) => i.message).join(", "),
      };
    }
    const { type, value, rounding } = parsed.data;
    await setSiteConfig("pfs_import_price_markup_type", type);
    await setSiteConfig("pfs_import_price_markup_value", String(value));
    await setSiteConfig("pfs_import_price_markup_rounding", rounding);
    revalidateTag("site-config", "default");
    return { success: true };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
