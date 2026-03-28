import { getCachedHasPfsConfig } from "@/lib/cached-data";
import ImportPageClient from "./ImportPageClient";

export default async function ImporterPage() {
  const hasPfsConfig = await getCachedHasPfsConfig();
  return <ImportPageClient hasPfsConfig={hasPfsConfig} />;
}
