import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { HttpError, assertSameOrigin } from "@/lib/session";

/**
 * Wrapper for route handlers: authenticates via the session cookie, enforces
 * same-origin for state-changing methods, and maps errors to JSON without
 * leaking internals.
 */
export function route<C>(handler: (req: Request, ctx: C, userId: string) => Promise<Response>, opts: { mutating: boolean } = { mutating: true }) {
  return async (req: Request, ctx: C) => {
    try {
      if (opts.mutating) assertSameOrigin(req);
      const session = await auth.api.getSession({ headers: req.headers });
      if (!session?.user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
      return await handler(req, ctx, session.user.id);
    } catch (e) {
      if (e instanceof AppError) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      console.error("[route] unexpected error:", e instanceof Error ? e.message : "unknown");
      return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
    }
  };
}
