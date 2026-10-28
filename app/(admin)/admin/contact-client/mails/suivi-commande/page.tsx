import { redirect } from "next/navigation";

export default function SuiviCommandeRedirect() {
  redirect("/admin/contact-client?onglet=suivi-commande");
}
