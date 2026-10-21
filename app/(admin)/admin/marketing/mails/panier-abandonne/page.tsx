import { redirect } from "next/navigation";

export default function PanierAbandonneRedirect() {
  redirect("/admin/marketing?onglet=panier-abandonne");
}
