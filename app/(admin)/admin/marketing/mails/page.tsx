import { redirect } from "next/navigation";

export default function MailsRedirect() {
  redirect("/admin/marketing?onglet=modeles");
}
