import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import type { Role, UserStatus } from "@prisma/client";

/**
 * Configuration NextAuth — Beli & Jolie
 *
 * Stratégie : JWT (pas de session en base de données)
 * Provider  : Credentials (email + mot de passe)
 *
 * Flux d'authentification :
 * 1. L'utilisateur soumet email + mot de passe
 * 2. On vérifie en base de données
 * 3. On vérifie que le statut est APPROVED
 * 4. On retourne l'utilisateur avec son rôle
 * 5. Le middleware redirige selon le rôle (ADMIN → /admin, CLIENT → /)
 */
export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 jours
  },

  pages: {
    signIn: "/connexion",
    error: "/connexion",
  },

  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Mot de passe", type: "password" },
      },

      async authorize(credentials) {
        // Vérification des champs obligatoires
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email et mot de passe requis.");
        }

        // Recherche de l'utilisateur en base
        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
        });

        // Generic message to prevent user enumeration
        const INVALID_CREDENTIALS = "Identifiants incorrects ou compte non activé.";

        if (!user) {
          throw new Error(INVALID_CREDENTIALS);
        }

        // Vérification du statut du compte
        if (user.status === "PENDING" || user.status === "REJECTED") {
          throw new Error(INVALID_CREDENTIALS);
        }

        // Vérification du mot de passe
        const passwordMatch = await bcrypt.compare(
          credentials.password,
          user.password
        );

        if (!passwordMatch) {
          throw new Error(INVALID_CREDENTIALS);
        }

        // Retour de l'utilisateur (sans le mot de passe)
        return {
          id: user.id,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          role: user.role,
          status: user.status,
          company: user.company,
        };
      },
    }),
  ],

  callbacks: {
    /**
     * jwt callback — enrichit le token avec les données custom
     * Appelé à chaque création/refresh de token
     */
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role: Role }).role;
        token.status = (user as { status: UserStatus }).status;
        token.company = (user as { company: string }).company;
      }
      return token;
    },

    /**
     * session callback — expose les données du token dans la session client
     * Appelé à chaque accès à useSession() ou getServerSession()
     */
    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.status = token.status as UserStatus;
        session.user.company = token.company as string;
      }
      return session;
    },
  },
};
