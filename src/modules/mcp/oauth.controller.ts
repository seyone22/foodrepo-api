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

@ApiTags("OAuth")
@Controller("oauth")
export class OAuthController {
  @Get("authorize")
  @ApiOperation({ summary: "OAuth 2.1 Consent Form" })
  async getAuthorize(
    @Query() query: any,
    @Res() res: Response,
  ) {
    const clientId = query.client_id || "gemini-spark";
    const redirectUri = query.redirect_uri;
    const state = query.state || "";
    const scopeStr =
      query.scope || "read:ingredients write:ingredients read:products";
    const codeChallenge = query.code_challenge || undefined;
    const codeChallengeMethod = query.code_challenge_method || undefined;
    const autoApprove = query.auto_approve === "true";

    if (!redirectUri) {
      return res
        .status(HttpStatus.BAD_REQUEST)
        .send("Missing required parameter: redirect_uri");
    }

    const scopes = scopeStr.split(/[\s,]+/).filter(Boolean);

    if (autoApprove) {
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

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FoodRepo • Connect Gemini Spark</title>
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
    <p><strong>\${clientId}</strong> is requesting access to your FoodRepo database via Model Context Protocol (MCP).</p>
    <div class="scopes">
      <div style="color: var(--text-muted); margin-bottom: 0.5rem; font-weight: 600;">Requested Scopes:</div>
      \${scopes.map(s => \`<div class="scope-item">✓ \${s}</div>\`).join("")}
    </div>
    <form method="POST">
      <input type="hidden" name="client_id" value="\${clientId}">
      <input type="hidden" name="redirect_uri" value="\${redirectUri}">
      <input type="hidden" name="state" value="\${state}">
      <input type="hidden" name="scope" value="\${scopeStr}">
      \${codeChallenge ? \`<input type="hidden" name="code_challenge" value="\${codeChallenge}">\` : ""}
      \${codeChallengeMethod ? \`<input type="hidden" name="code_challenge_method" value="\${codeChallengeMethod}">\` : ""}
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
    const clientId = body.client_id || "gemini-spark";
    const redirectUri = body.redirect_uri;
    const state = body.state || "";
    const scopeStr =
      body.scope || "read:ingredients write:ingredients read:products";
    const codeChallenge = body.code_challenge || undefined;
    const codeChallengeMethod = body.code_challenge_method || undefined;

    if (!redirectUri) {
      return res.status(HttpStatus.BAD_REQUEST).send("Missing redirect_uri");
    }

    const scopes = scopeStr.split(/[\s,]+/).filter(Boolean);

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
    let grantType = body?.grant_type || "";
    let code = body?.code || "";
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
    if (serverClientSecret && clientSecret) {
      const enteredBuf = Buffer.from(clientSecret);
      const expectedBuf = Buffer.from(serverClientSecret);
      const matchesSecret =
        enteredBuf.length === expectedBuf.length &&
        crypto.timingSafeEqual(enteredBuf, expectedBuf);

      const apiKeyBuf = Buffer.from(process.env.MCP_API_KEY || "");
      const matchesApiKey =
        enteredBuf.length === apiKeyBuf.length &&
        crypto.timingSafeEqual(enteredBuf, apiKeyBuf);

      if (!matchesSecret && !matchesApiKey) {
        return res.status(HttpStatus.UNAUTHORIZED).json({
          error: "invalid_client",
          error_description: "Invalid client_secret",
        });
      }
    }

    const token =
      process.env.MCP_API_KEY ||
      "mcp_live_6d3aa896ae8b901c56f32232d6444166f377fcc4b2e44564";

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

      return res
        .header("Cache-Control", "no-store")
        .header("Pragma", "no-cache")
        .json({
          access_token: token,
          token_type: "Bearer",
          expires_in: 315360000,
          refresh_token: `ref_${crypto.randomBytes(24).toString("hex")}`,
          scope: entry.scopes.join(" "),
        });
    }

    if (grantType === "client_credentials" || grantType === "refresh_token") {
      return res
        .header("Cache-Control", "no-store")
        .header("Pragma", "no-cache")
        .json({
          access_token: token,
          token_type: "Bearer",
          expires_in: 315360000,
          scope: "read:ingredients write:ingredients read:products read:recipes admin:maintenance",
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
