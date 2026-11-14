import * as crypto from "crypto";

export const READ_ONLY_MCP_SCOPES = [
  "read:ingredients",
  "read:products",
  "read:recipes",
] as const;

export interface McpAuthContext {
  authenticated: boolean;
  clientId?: string;
  userId?: string;
  scopes: string[];
}

interface SignedMcpTokenPayload {
  sub: string;
  scopes: string[];
  iat: number;
  exp: number;
}

function getSigningSecret(): string | null {
  if (process.env.MCP_JWT_SECRET) {
    return process.env.MCP_JWT_SECRET;
  }
  if (process.env.MCP_API_KEY) {
    return crypto
      .createHash("sha256")
      .update(`foodrepo-mcp-token:${process.env.MCP_API_KEY}`)
      .digest("hex");
  }
  return null;
}

export function filterReadOnlyScopes(requested: string[]): string[] {
  const allowed = new Set<string>(READ_ONLY_MCP_SCOPES);
  const filtered = requested.filter((s) => allowed.has(s));
  return filtered.length > 0 ? filtered : ["read:ingredients", "read:products"];
}

export function signMcpToken(
  clientId: string,
  scopes: string[],
  ttlSeconds = 86400 * 30,
): string | null {
  const secret = getSigningSecret();
  if (!secret) return null;

  const now = Math.floor(Date.now() / 1000);
  const payload: SignedMcpTokenPayload = {
    sub: clientId,
    scopes: filterReadOnlyScopes(scopes),
    iat: now,
    exp: now + ttlSeconds,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `fr_mcp_${payloadB64}.${sig}`;
}

function verifySignedMcpToken(token: string): McpAuthContext | null {
  if (!token.startsWith("fr_mcp_")) return null;
  const secret = getSigningSecret();
  if (!secret) return null;

  const raw = token.slice("fr_mcp_".length);
  const parts = raw.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, sigB64] = parts;
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  const sigBuf = Buffer.from(sigB64);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf-8"),
    ) as SignedMcpTokenPayload;
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp < now) {
      return null;
    }

    return {
      authenticated: true,
      clientId: payload.sub || "oauth-client",
      scopes: filterReadOnlyScopes(Array.isArray(payload.scopes) ? payload.scopes : []),
    };
  } catch {
    return null;
  }
}

export function verifyMcpAuthHeader(authHeader?: string): McpAuthContext {
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return { authenticated: false, scopes: [] };
  }

  const token = authHeader.substring(7).trim();
  if (!token) {
    return { authenticated: false, scopes: [] };
  }

  const configuredKey = process.env.MCP_API_KEY;
  if (configuredKey) {
    const tokenBuf = Buffer.from(token);
    const keyBuf = Buffer.from(configuredKey);

    if (tokenBuf.length === keyBuf.length && crypto.timingSafeEqual(tokenBuf, keyBuf)) {
      return {
        authenticated: true,
        clientId: "mcp-api-key-client",
        scopes: [...READ_ONLY_MCP_SCOPES],
      };
    }
  }

  const signedContext = verifySignedMcpToken(token);
  if (signedContext) {
    return signedContext;
  }

  return { authenticated: false, scopes: [] };
}

export function assertScope(context: McpAuthContext, requiredScope: string): void {
  if (!context.authenticated) {
    throw new Error("UNAUTHORIZED: Valid Bearer token required.");
  }

  const hasDirectScope = context.scopes.includes(requiredScope);
  const hasWildcardScope =
    requiredScope.startsWith("read:") && context.scopes.includes("read:*");

  if (!hasDirectScope && !hasWildcardScope) {
    throw new Error(`FORBIDDEN: Insufficient scope. Requires '${requiredScope}'.`);
  }
}
