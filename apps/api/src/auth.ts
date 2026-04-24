import type { Context, MiddlewareHandler, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "./env.js";
import { type JwtPayload, verifyJwt } from "./jwt.js";

const COOKIE_DEFAULT = "vm_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type AppEnv = { Bindings: Env; Variables: { session?: JwtPayload } };

export function cookieName(env: Env): string {
  return env.COOKIE_NAME || COOKIE_DEFAULT;
}

export function setSessionCookie(c: Context<AppEnv>, token: string): void {
  setCookie(c, cookieName(c.env), token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    domain: c.env.COOKIE_DOMAIN || undefined,
  });
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, cookieName(c.env), {
    path: "/",
    domain: c.env.COOKIE_DOMAIN || undefined,
  });
}

export function sessionTtlSeconds(): number {
  return SESSION_TTL_SECONDS;
}

export const requireSession: MiddlewareHandler<AppEnv> = async (c, next: Next) => {
  const token = getCookie(c, cookieName(c.env));
  if (!token) return c.json({ error: "unauthorized" }, 401);
  const payload = await verifyJwt(token, c.env.JWT_SECRET);
  if (!payload) return c.json({ error: "unauthorized" }, 401);
  c.set("session", payload);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next: Next) => {
  const session = c.get("session");
  if (!session || session.role !== "admin") return c.json({ error: "forbidden" }, 403);
  await next();
};

export function sessionPayload(c: Context<AppEnv>): JwtPayload {
  const s = c.get("session");
  if (!s) throw new Error("session missing — requireSession middleware not applied");
  return s;
}
