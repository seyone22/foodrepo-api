import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import * as crypto from "crypto";
import {
  consumeAuthorizationCode,
  createAuthorizationCode,
} from "./oauth.store";
import {
  filterReadOnlyScopes,
  READ_ONLY_MCP_SCOPES,
  signMcpToken,
} from "./mcp-auth.util";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isSafeRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

@ApiTags("OAuth")
@Controller("oauth")
export class OAuthController {
  @Get("authorize")
  @ApiOperation({ summary: "OAuth 2.1 Consent Form" })
  async getAuthorize(
    @Query() query: any,
    @Res() res: Response,
  ) {
    const clientId = String(query.client_id || "gemini-spark");
    const redirectUri = String(query.redirect_uri || "");
    const state = String(query.state || "");
    const requestedScopes = String(query.scope || "read:ingredients read:products")
      .split(/[\s,]+/)
      .filter(Boolean);
    const scopes = filterReadOnlyScopes(requestedScopes);
    const scopeStr = scopes.join(" ");
    const codeChallenge = query.code_challenge ? String(query.code_challenge) : undefined;
    const codeChallengeMethod = query.code_challenge_method
      ? String(query.code_challenge_method)
      : undefined;

    if (!redirectUri || !isSafeRedirectUri(redirectUri)) {
      return res
        .status(HttpStatus.BAD_REQUEST)
        .send("Missing or invalid redirect_uri");
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FoodRepo • Connect MCP Client</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card: #151b28;
      --border: #232d3f;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --primary: #818cf8;
      --primary-hover: #6366f1;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background-color: var(--bg);
      color: var(--text-main);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 1.5rem;
    }
    .auth-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 1.25rem;
      padding: 2.25rem;
      max-width: 480px;
      width: 100%;
    }
    h1 { font-size: 1.4rem; margin-top: 0; text-align: center; }
    p { color: var(--text-muted); font-size: 0.9rem; text-align: center; line-height: 1.5; }
    .scopes { background: rgba(15,23,42,0.6); border: 1px solid var(--border); border-radius: 0.8rem; padding: 1rem; margin: 1.5rem 0; font-size: 0.85rem; }
    .scope-item { padding: 0.4rem 0; color: #38bdf8; font-family: monospace; }
    .actions { display: flex; gap: 0.75rem; margin-top: 1.5rem; }
    button { flex: 1; padding: 0.85rem; border-radius: 0.75rem; font-weight: 600; cursor: pointer; border: none; font-size: 0.9rem; }
    .btn-approve { background: var(--primary); color: white; }
    .btn-approve:hover { background: var(--primary-hover); }
    .btn-cancel { background: transparent; color: var(--text-muted); border: 1px solid var(--border); }
  </style>
</head>
<body>
  <div class="auth-card">
    <h1>Connect to FoodRepo</h1>
    <p><strong>${escapeHtml(clientId)}</strong> is requesting read-only access to FoodRepo via Model Context Protocol (MCP).</p>
    <div class="scopes">
      <div style="color: var(--text-muted); margin-bottom: 0.5rem; font-weight: 600;">Granted Read-Only Scopes:</div>
      ${scopes.map((s) => `<div class="scope-item">✓ ${escapeHtml(s)}</div>`).join("")}
    </div>
    <form method="POST">
      <input type="hidden" name="client_id" value="${escapeHtml(clientId)}">
      <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}">
      <input type="hidden" name="state" value="${escapeHtml(state)}">
      <input type="hidden" name="scope" value="${escapeHtml(scopeStr)}">
      ${codeChallenge ? `<input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}">` : ""}
      ${codeChallengeMethod ? `<input type="hidden" name="code_challenge_method" value="${escapeHtml(codeChallengeMethod)}">` : ""}
      <div class="actions">
        <button type="button" class="btn-cancel" onclick="window.close()">Cancel</button>
        <button type="submit" class="btn-approve">Authorize</button>
      </div>
    </form>
  </div>
</body>
</html>`;

    return res.type("text/html; charset=utf-8").send(html);
  }

  @Post("authorize")
  @ApiOperation({ summary: "Approve OAuth Authorization Request" })
  async postAuthorize(
    @Body() body: any,
    @Res() res: Response,
  ) {
    const clientId = String(body.client_id || "gemini-spark");
    const redirectUri = String(body.redirect_uri || "");
    const state = String(body.state || "");
    const requestedScopes = String(body.scope || "read:ingredients read:products")
      .split(/[\s,]+/)
      .filter(Boolean);
    const scopes = filterReadOnlyScopes(requestedScopes);
    const codeChallenge = body.code_challenge ? String(body.code_challenge) : undefined;
    const codeChallengeMethod = body.code_challenge_method
      ? String(body.code_challenge_method)
      : undefined;

    if (!redirectUri || !isSafeRedirectUri(redirectUri)) {
      return res.status(HttpStatus.BAD_REQUEST).send("Missing or invalid redirect_uri");
    }

    const code = createAuthorizationCode({
      clientId,
      redirectUri,
      scopes,
      codeChallenge,
      codeChallengeMethod,
    });

    const targetUrl = new URL(redirectUri);
    targetUrl.searchParams.set("code", code);
    if (state) targetUrl.searchParams.set("state", state);

    return res.redirect(HttpStatus.FOUND, targetUrl.toString());
  }

  @Post("token")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "OAuth 2.1 Token Exchange" })
  async postToken(
    @Body() body: any,
    @Headers("authorization") authHeader: string,
    @Res() res: Response,
  ) {
    const grantType = body?.grant_type || "";
    const code = body?.code || "";
    let clientId = body?.client_id || "";
    let clientSecret = body?.client_secret || "";

    if (authHeader && authHeader.toLowerCase().startsWith("basic ")) {
      try {
        const creds = Buffer.from(authHeader.substring(6), "base64").toString("utf-8");
        const [u, p] = creds.split(":");
        clientId = u;
        clientSecret = p;
      } catch {}
    }

    const serverClientSecret = process.env.MCP_CLIENT_SECRET;
    if (serverClientSecret && grantType === "client_credentials") {
      if (!clientSecret) {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          error: "invalid_client",
          error_description: "Missing client_secret",
        });
      }
      const enteredBuf = Buffer.from(clientSecret);
      const expectedBuf = Buffer.from(serverClientSecret);
      const matchesSecret =
        enteredBuf.length === expectedBuf.length &&
        crypto.timingSafeEqual(enteredBuf, expectedBuf);

      if (!matchesSecret) {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          error: "invalid_client",
          error_description: "Invalid client_secret",
        });
      }
    }

    if (grantType === "authorization_code") {
      if (!code) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          error: "invalid_request",
          error_description: "Missing code parameter",
        });
      }

      const entry = consumeAuthorizationCode(code, clientId || undefined);
      if (!entry) {
        return res.status(HttpStatus.BAD_REQUEST).json({
          error: "invalid_grant",
          error_description: "Authorization code invalid or expired",
        });
      }

      const scopes = filterReadOnlyScopes(entry.scopes);
      const token = signMcpToken(entry.clientId, scopes);
      if (!token) {
        return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          error: "server_error",
          error_description: "MCP token signing secret is not configured",
        });
      }

      return res
        .header("Cache-Control", "no-store")
        .header("Pragma", "no-cache")
        .json({
          access_token: token,
          token_type: "Bearer",
          expires_in: 86400 * 30,
          refresh_token: `ref_${crypto.randomBytes(24).toString("hex")}`,
          scope: scopes.join(" "),
        });
    }

    if (grantType === "client_credentials" || grantType === "refresh_token") {
      const scopes = [...READ_ONLY_MCP_SCOPES];
      const token = signMcpToken(clientId || "oauth-client", scopes);
      if (!token) {
        return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          error: "server_error",
          error_description: "MCP token signing secret is not configured",
        });
      }

      return res
        .header("Cache-Control", "no-store")
        .header("Pragma", "no-cache")
        .json({
          access_token: token,
          token_type: "Bearer",
          expires_in: 86400 * 30,
          scope: scopes.join(" "),
        });
    }

    return res.status(HttpStatus.BAD_REQUEST).json({
      error: "unsupported_grant_type",
      error_description: `Unsupported grant_type: '${grantType}'`,
    });
  }

  @Post("register")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: "RFC 7591 Dynamic Client Registration" })
  async postRegister(@Body() body: any) {
    const clientId = `gemini_${crypto.randomBytes(8).toString("hex")}`;
    const clientSecret = `secret_${crypto.randomBytes(16).toString("hex")}`;

    return {
      client_id: clientId,
      client_secret: clientSecret,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: body?.client_name || "Gemini Spark Client",
      redirect_uris: body?.redirect_uris || [],
      grant_types: ["authorization_code", "client_credentials", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "client_secret_post",
    };
  }
}
