import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { db, getDb } from "@/db";
import { accounts, sessions, users, verificationTokens } from "@/db/schema";
import { ensurePersonalOrg } from "./orgs";

/**
 * Email-only sign-in for local development and automated tests. It never
 * activates on a Vercel production deployment, whatever the env says.
 */
export function devLoginEnabled(): boolean {
  return process.env.AUTH_DEV_LOGIN === "true" && process.env.VERCEL_ENV !== "production";
}

const providers: NextAuthConfig["providers"] = [
  // Use the GitHub App's own client ID/secret here so the user token can call
  // GET /user/installations, which proves which installations a user may link.
  GitHub({
    clientId: process.env.AUTH_GITHUB_ID,
    clientSecret: process.env.AUTH_GITHUB_SECRET,
    profile(profile) {
      return {
        id: String(profile.id),
        name: profile.name ?? profile.login,
        email: profile.email,
        image: profile.avatar_url,
        githubLogin: profile.login,
      };
    },
  }),
];

if (devLoginEnabled()) {
  providers.push(
    Credentials({
      id: "dev",
      name: "Dev login",
      credentials: { email: { label: "Email", type: "email" } },
      async authorize(credentials) {
        const email = String(credentials?.email ?? "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
        const existing = await db.query.users.findFirst({ where: eq(users.email, email) });
        if (existing) return existing;
        const [created] = await db
          .insert(users)
          .values({ email, name: email.split("@")[0] })
          .returning();
        return created;
      },
    }),
  );
}

const authConfig = (): NextAuthConfig => ({
  adapter: DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 7 },
  providers,
  pages: { signIn: "/login" },
  trustHost: true,
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.uid = user.id;
        await ensurePersonalOrg(user.id, user.name ?? user.email ?? "My workspace");
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid && session.user) session.user.id = token.uid as string;
      return session;
    },
  },
  events: {
    async linkAccount({ user, profile }) {
      const login = (profile as { githubLogin?: string } | undefined)?.githubLogin;
      if (login && user.id) {
        await db.update(users).set({ githubLogin: login }).where(eq(users.id, user.id));
      }
    },
  },
});

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
