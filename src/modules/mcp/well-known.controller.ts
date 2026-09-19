import { Controller, Get, HttpCode, HttpStatus, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";

@ApiTags("Discovery")
@Controller(".well-known")
export class WellKnownController {
  private getPublicOrigin(req: Request): string {
    const host = req.headers["x-forwarded-host"] || req.headers["host"];
    const proto = req.headers["x-forwarded-proto"] || "https";
    return host && !String(host).includes("localhost")
      ? `${proto}://${host}`
      : process.env.NEXT_PUBLIC_APP_URL || "https://food.seyone.dev";
  }

  @Get("oauth-authorization-server")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "RFC 8414 OAuth Authorization Server Metadata" })
  getOAuthMetadata(@Req() req: Request) {
    const origin = this.getPublicOrigin(req);
    return {
      issuer: origin,
      authorization_endpoint: `${origin}/api/v1/oauth/authorize`,
      token_endpoint: `${origin}/api/v1/oauth/token`,
      registration_endpoint: `${origin}/api/v1/oauth/register`,
      jwks_uri: `${origin}/api/v1/oauth/jwks`,
      scopes_supported: [
        "read:ingredients",
        "write:ingredients",
        "read:products",
        "read:recipes",
        "admin:maintenance",
      ],
      response_types_supported: ["code"],
      response_modes_supported: ["query"],
      grant_types_supported: [
        "authorization_code",
        "client_credentials",
        "refresh_token",
      ],
      token_endpoint_auth_methods_supported: [
        "client_secret_post",
        "client_secret_basic",
        "none",
      ],
      code_challenge_methods_supported: ["S256", "plain"],
      service_documentation: `${origin}/documentation`,
    };
  }

  @Get("oauth-protected-resource")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "RFC 9207 / MCP OAuth Protected Resource Metadata" })
  getProtectedResourceMetadata(@Req() req: Request) {
    const origin = this.getPublicOrigin(req);
    return {
      resource: `${origin}/api/v1/mcp`,
      authorization_servers: [origin],
      scopes_supported: [
        "read:ingredients",
        "write:ingredients",
        "read:products",
        "read:recipes",
        "admin:maintenance",
      ],
      bearer_methods_supported: ["header"],
      resource_documentation: `${origin}/documentation`,
    };
  }

  @Get("openid-configuration")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "OpenID Discovery Metadata" })
  getOpenIdConfiguration(@Req() req: Request) {
    return this.getOAuthMetadata(req);
  }
}
