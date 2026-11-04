import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface AuthUser {
  id: string;
  email?: string;
  isAnonymous: boolean;
}

interface JwtPayload {
  sub: string;        // user_id
  email?: string;
  exp: number;        // expiry timestamp
  iat: number;        // issued at
  role: string;       // "authenticated" or "anon"
  is_anonymous?: boolean;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

interface Jwk extends JsonWebKey {
  kid?: string;
}

// Keys from the project's JWKS, cached per worker. A token signed with an
// unknown kid refetches, so rotating the signing keys needs no deploy.
const cachedKeys = new Map<string, CryptoKey>();

async function fetchSigningKeys(): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
  if (!res.ok) {
    throw new Error(`JWKS fetch failed: ${res.status}`);
  }
  const { keys } = (await res.json()) as { keys: Jwk[] };
  for (const jwk of keys) {
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.kid) continue;
    cachedKeys.set(
      jwk.kid,
      await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "ECDSA", namedCurve: "P-256" },
        true,
        ["verify"]
      )
    );
  }
}

/**
 * Base64url decode
 */
function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Get the signing key for a token's kid (fetches JWKS when it isn't cached)
 */
async function getSigningKey(kid: string): Promise<CryptoKey> {
  if (!cachedKeys.has(kid)) {
    await fetchSigningKeys();
  }

  const key = cachedKeys.get(kid);
  if (!key) {
    throw new Error(`Unknown signing key: ${kid}`);
  }
  return key;
}

/**
 * Verify JWT locally using asymmetric keys (ES256)
 * Uses Web Crypto API directly to avoid jose library issues
 */
export async function verifyJwt(req: Request): Promise<AuthUser | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);

  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error("Invalid JWT format");
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    // Decode header to check algorithm
    const header = JSON.parse(new TextDecoder().decode(base64urlDecode(headerB64)));
    if (header.alg !== "ES256") {
      throw new Error(`Unsupported algorithm: ${header.alg}`);
    }

    // Get the signing key
    const key = await getSigningKey(header.kid);

    // Verify signature (ES256 uses SHA-256)
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signature = base64urlDecode(signatureB64);

    // ES256 signature is r||s (64 bytes), need to convert from JWT format
    const isValid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      signature,
      data
    );

    if (!isValid) {
      throw new Error("Invalid signature");
    }

    // Decode payload
    const payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64))) as JwtPayload;

    // Check expiry
    if (payload.exp && payload.exp < Date.now() / 1000) {
      throw new Error("Token expired");
    }

    // Check issuer
    const expectedIssuer = `${SUPABASE_URL}/auth/v1`;
    if (payload.iss && payload.iss !== expectedIssuer) {
      throw new Error(`Invalid issuer: ${payload.iss}`);
    }

    return {
      id: payload.sub,
      email: payload.email,
      isAnonymous: payload.is_anonymous ?? payload.role === "anon",
    };
  } catch (error) {
    console.error("[AUTH] JWT verification failed:", error);
    return null;
  }
}

/**
 * Get admin client (bypasses RLS)
 */
export function getAdminClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

/**
 * Get client with user's JWT (respects RLS)
 */
export function getUserClient(authHeader: string): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: {
        headers: { Authorization: authHeader },
      },
    }
  );
}

/**
 * Extract and validate user from request
 * Works with both anonymous and authenticated users
 */
export async function getAuthUser(req: Request): Promise<AuthUser | null> {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) {
    return null;
  }

  const client = getUserClient(authHeader);

  const {
    data: { user },
    error,
  } = await client.auth.getUser();

  if (error || !user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email,
    isAnonymous: user.is_anonymous ?? false,
  };
}

/**
 * Get user's subscription tier
 */
export async function getUserTier(
  userId: string
): Promise<"free" | "supporter"> {
  const admin = getAdminClient();

  const { data } = await admin
    .from("subscriptions")
    .select("tier, expires_at")
    .eq("user_id", userId)
    .single();

  if (!data) {
    return "free";
  }

  // Check if subscription is expired
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return "free";
  }

  return data.tier as "free" | "supporter";
}
