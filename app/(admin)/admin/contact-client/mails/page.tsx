import { redirect } from "next/navigation";

export default function MailsRedirect() {
  redirect("/admin/contact-client?onglet=modeles");
}
