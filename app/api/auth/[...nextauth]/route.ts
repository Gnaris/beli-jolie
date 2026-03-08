import NextAuth from "next-auth";
import { authOptions } from "@/lib/auth";

/**
 * Route handler NextAuth — gère toutes les requêtes /api/auth/*
 * GET  : session, signOut, callback...
 * POST : signIn, signOut
 */
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
