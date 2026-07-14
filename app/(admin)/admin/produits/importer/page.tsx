import { getCachedPfsEnabled } from "@/lib/cached-data";
import { loadPfsImportPriceMarkup } from "@/lib/pfs-import-price-markup";
import ImportPageClient from "./ImportPageClient";

export default async function ImporterPage() {
  const [pfsEnabled, initialImportMarkup] = await Promise.all([
    getCachedPfsEnabled(),
    loadPfsImportPriceMarkup(),
  ]);
  return (
    <ImportPageClient
      hasPfsConfig={pfsEnabled}
      initialImportMarkup={initialImportMarkup}
    />
  );
}
