import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";

export interface SessionPayload {
  userId: string;
  email: string;
}

const secret = () => new TextEncoder().encode(env.authSecret);

const TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

export async function signSession(p: SessionPayload): Promise<string> {
  return await new SignJWT({ userId: p.userId, email: p.email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (typeof payload.userId !== "string" || typeof payload.email !== "string") return null;
    return { userId: payload.userId, email: payload.email };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = "ganprev_session";
export const SESSION_COOKIE_TTL = TTL_SECONDS;
