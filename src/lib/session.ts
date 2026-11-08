import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export type SessionUser = { id: string; name: string; email: string };

export async function currentUser(): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) return null;
  return { id: session.user.id, name: session.user.name, email: session.user.email };
}

export async function requireUser(next?: string): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect(`/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return user;
}

/**
 * Same-origin check for route handlers that change state (Server Actions
 * already enforce this). Rejects requests whose Origin is missing or foreign.
 */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) throw new HttpError(403, "Missing origin");
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    throw new HttpError(403, "Bad origin");
  }
  const allowed = new Set([host, new URL(process.env.APP_URL?.trim() || "http://localhost:3000").host]);
  if (!allowed.has(o.host)) throw new HttpError(403, "Cross-origin request rejected");
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
