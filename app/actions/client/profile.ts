"use server";

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";

export async function updateProfile(data: {
  firstName: string;
  lastName: string;
  company: string;
  phone: string;
  address: string;
  vatNumber: string;
}) {
  const session = await getServerSession(authOptions);
  if (!session) throw new Error("Non autorise");

  await prisma.user.update({
    where: { id: session.user.id },
    data: {
      firstName: data.firstName.trim(),
      lastName:  data.lastName.trim(),
      company:   data.company.trim(),
      phone:     data.phone.trim(),
      address:   data.address.trim() || null,
      vatNumber: data.vatNumber.trim() || null,
    },
  });

  revalidatePath("/espace-pro");
  return { success: true };
}
