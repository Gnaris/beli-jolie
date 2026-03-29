import { getCachedPfsEnabled } from "@/lib/cached-data";
import ImportPageClient from "./ImportPageClient";

export default async function ImporterPage() {
  const pfsEnabled = await getCachedPfsEnabled();
  return <ImportPageClient hasPfsConfig={pfsEnabled} />;
}
