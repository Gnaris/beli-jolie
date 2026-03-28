import { redirect } from "next/navigation";
import { getCachedHasPfsConfig } from "@/lib/cached-data";
import PfsHistoryClient from "@/components/pfs/PfsHistoryClient";

export default async function PfsResumePage() {
  const hasPfsConfig = await getCachedHasPfsConfig();
  if (!hasPfsConfig) redirect("/admin/pfs");
  return <PfsHistoryClient />;
}
