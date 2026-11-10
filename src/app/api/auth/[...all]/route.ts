import { NextResponse } from "next/server";
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

const handler = toNextJsHandler(auth);

/**
 * PromiseTrace signs users in and out through server actions; the browser
 * never needs Better Auth's other HTTP endpoints. Only these paths are served.
 * Everything else (change password, update user, change email, delete user,
 * session revocation, password reset…) returns 404, so nobody can take over
 * or lock the shared demo accounts through the API.
 */
const ALLOWED: Record<"GET" | "POST", Set<string>> = {
  GET: new Set(["get-session", "ok"]),
  POST: new Set(["sign-in/email", "sign-up/email", "sign-out"]),
};

function allowed(method: "GET" | "POST", req: Request) {
  const path = new URL(req.url).pathname.replace(/^\/api\/auth\/?/, "").replace(/\/+$/, "");
  return ALLOWED[method].has(path);
}

export async function GET(req: Request) {
  if (!allowed("GET", req)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return handler.GET(req);
}

export async function POST(req: Request) {
  if (!allowed("POST", req)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return handler.POST(req);
}
