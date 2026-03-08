import { Role, UserStatus } from "@prisma/client";
import "next-auth";
import "next-auth/jwt";

/**
 * Extension des types NextAuth pour inclure nos champs custom
 * (role, status, company, id)
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: Role;
      status: UserStatus;
      company: string;
    };
  }

  interface User {
    id: string;
    role: Role;
    status: UserStatus;
    company: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    status: UserStatus;
    company: string;
  }
}
