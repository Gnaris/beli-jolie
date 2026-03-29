import { redirect } from "next/navigation";
import { getCachedPfsEnabled } from "@/lib/cached-data";
import PfsHistoryClient from "@/components/pfs/PfsHistoryClient";

export default async function PfsResumePage() {
  const pfsEnabled = await getCachedPfsEnabled();
  if (!pfsEnabled) redirect("/admin/pfs");
  return <PfsHistoryClient />;
}
