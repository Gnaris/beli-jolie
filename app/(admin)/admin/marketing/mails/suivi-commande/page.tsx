import { redirect } from "next/navigation";

export default function SuiviCommandeRedirect() {
  redirect("/admin/marketing?onglet=suivi-commande");
}
