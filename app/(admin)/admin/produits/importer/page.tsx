import { getCachedPfsEnabled, getCachedEfashionEnabled, getCachedAnkorstoreEnabled } from "@/lib/cached-data";
import ImportPageClient from "./ImportPageClient";

export default async function ImporterPage() {
  const [pfsEnabled, efashionEnabled, ankorstoreEnabled] = await Promise.all([
    getCachedPfsEnabled(),
    getCachedEfashionEnabled(),
    getCachedAnkorstoreEnabled(),
  ]);
  return <ImportPageClient hasPfsConfig={pfsEnabled} efashionEnabled={efashionEnabled} ankorstoreEnabled={ankorstoreEnabled} />;
}
