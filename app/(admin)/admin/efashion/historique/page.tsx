import { redirect } from "next/navigation";
import { getCachedEfashionEnabled } from "@/lib/cached-data";
import EfashionHistoryClient from "@/components/efashion/EfashionHistoryClient";

export default async function EfashionHistoriquePage() {
  const efashionEnabled = await getCachedEfashionEnabled();
  if (!efashionEnabled) redirect("/admin/efashion");
  return <EfashionHistoryClient />;
}
