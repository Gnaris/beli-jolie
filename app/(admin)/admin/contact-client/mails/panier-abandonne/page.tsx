import { redirect } from "next/navigation";

export default function PanierAbandonneRedirect() {
  redirect("/admin/contact-client?onglet=panier-abandonne");
}
