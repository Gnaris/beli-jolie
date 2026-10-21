import { redirect } from "next/navigation";

export default function RetourStockRedirect() {
  redirect("/admin/marketing?onglet=retour-en-stock");
}
