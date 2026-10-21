import { redirect } from "next/navigation";

export default function WhatsappRedirect() {
  redirect("/admin/marketing?onglet=whatsapp");
}
