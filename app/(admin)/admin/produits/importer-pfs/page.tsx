import ImportPfsClient from "./ImportPfsClient";
import { loadPfsImportPriceMarkup } from "@/lib/pfs-import-price-markup";

export default async function ImporterPfsPage() {
  const initialImportMarkup = await loadPfsImportPriceMarkup();
  return <ImportPfsClient initialImportMarkup={initialImportMarkup} />;
}
