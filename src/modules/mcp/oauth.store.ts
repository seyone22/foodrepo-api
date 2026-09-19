import * as crypto from "crypto";

export interface AuthCodeEntry {
  code: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge?: string;
  codeChallengeMethod?: string;
  expiresAt: number;
}

declare global {
  var __mcpOAuthCodes: Map<string, AuthCodeEntry> | undefined;
}

const codeStore = global.__mcpOAuthCodes || new Map<string, AuthCodeEntry>();
if (process.env.NODE_ENV !== "production") {
  global.__mcpOAuthCodes = codeStore;
}

export function createAuthorizationCode(params: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  codeChallenge?: string;
  codeChallengeMethod?: string;
}): string {
  const code = `auth_${crypto.randomBytes(24).toString("hex")}`;
  const ttlMs = 5 * 60 * 1000; // 5 minutes

  codeStore.set(code, {
    code,
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    scopes: params.scopes,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: params.codeChallengeMethod,
    expiresAt: Date.now() + ttlMs,
  });

  return code;
}

export function consumeAuthorizationCode(
  code: string,
  clientId?: string,
): AuthCodeEntry | null {
  const entry = codeStore.get(code);
  if (!entry) return null;

  codeStore.delete(code);

  if (Date.now() > entry.expiresAt) {
    return null;
  }

  if (clientId && entry.clientId && entry.clientId !== clientId) {
    return null;
  }

  return entry;
}
