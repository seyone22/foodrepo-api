import * as crypto from "crypto";

export interface McpAuthContext {
  authenticated: boolean;
  clientId?: string;
  userId?: string;
  scopes: string[];
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
        clientId: "gemini-spark-agent",
        scopes: [
          "read:ingredients",
          "write:ingredients",
          "read:products",
          "read:recipes",
          "admin:maintenance",
        ],
      };
    }
  }

  const jwtSecret = process.env.MCP_JWT_SECRET;
  if (jwtSecret) {
    return {
      authenticated: true,
      clientId: "oauth-client",
      scopes: ["read:ingredients", "write:ingredients", "read:products", "read:recipes"],
    };
  }

  return { authenticated: false, scopes: [] };
}

export function assertScope(context: McpAuthContext, requiredScope: string): void {
  if (!context.authenticated) {
    throw new Error("UNAUTHORIZED: Valid Bearer token required.");
  }

  const hasDirectScope = context.scopes.includes(requiredScope);
  const hasWildcardScope =
    context.scopes.includes("admin:*") ||
    (requiredScope.startsWith("read:") && context.scopes.includes("read:*")) ||
    (requiredScope.startsWith("write:") && context.scopes.includes("write:*"));

  if (!hasDirectScope && !hasWildcardScope) {
    throw new Error(`FORBIDDEN: Insufficient scope. Requires '${requiredScope}'.`);
  }
}
