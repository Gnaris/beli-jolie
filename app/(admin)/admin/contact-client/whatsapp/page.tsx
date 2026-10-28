import { redirect } from "next/navigation";

export default function WhatsappRedirect() {
  redirect("/admin/contact-client?onglet=whatsapp");
}
