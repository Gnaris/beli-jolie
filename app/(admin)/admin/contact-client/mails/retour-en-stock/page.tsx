import { redirect } from "next/navigation";

export default function RetourStockRedirect() {
  redirect("/admin/contact-client?onglet=retour-en-stock");
}
