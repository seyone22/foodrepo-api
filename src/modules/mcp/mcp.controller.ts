import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { McpService } from "./mcp.service";
import { verifyMcpAuthHeader } from "./mcp-auth.util";

@ApiTags("MCP")
@Controller("mcp")
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  private getPublicOrigin(req: Request): string {
    const host = req.headers["x-forwarded-host"] || req.headers["host"];
    const proto = req.headers["x-forwarded-proto"] || "https";
    return host && !String(host).includes("localhost")
      ? `${proto}://${host}`
      : process.env.NEXT_PUBLIC_APP_URL || "https://food.seyone.dev";
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "MCP Server Status & Discovery" })
  getStatus(@Req() req: Request) {
    const origin = this.getPublicOrigin(req);
    return {
      status: "online",
      server: "foodrepo-mcp-server",
      transport: "Streamable HTTP (POST /api/v1/mcp)",
      spec: "Model Context Protocol",
      documentation: `${origin}/documentation`,
    };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "MCP JSON-RPC 2.0 Dispatcher" })
  async handleRpc(
    @Body() body: any,
    @Headers("authorization") authHeader: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const origin = this.getPublicOrigin(req);

    // 1. Authenticate Request
    const auth = verifyMcpAuthHeader(authHeader);

    if (!auth.authenticated) {
      return res
        .status(HttpStatus.UNAUTHORIZED)
        .header(
          "WWW-Authenticate",
          `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
        )
        .json({
          jsonrpc: "2.0",
          error: {
            code: -32001,
            message: "Unauthorized: Valid Bearer token required.",
          },
          id: null,
        });
    }

    const { method, params, id = null } = body || {};

    switch (method) {
      case "initialize":
        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: {
              name: "foodrepo-mcp-server",
              version: "2.0.0",
            },
            capabilities: {
              tools: { listChanged: false },
              resources: { subscribe: false, listChanged: false },
            },
            instructions:
              "FoodRepo MCP Server provides comprehensive culinary intelligence, faceted search, live supermarket pricing, and canonical ingredient curation for Gemini Spark.",
          },
        });

      case "notifications/initialized":
        return res.status(HttpStatus.NO_CONTENT).send();

      case "tools/list": {
        const tools = this.mcpService.getToolsList();
        return res.json({
          jsonrpc: "2.0",
          id,
          result: { tools },
        });
      }

      case "tools/call": {
        const { name, arguments: toolArgs } = params || {};
        try {
          const data = await this.mcpService.executeTool(name, toolArgs || {}, auth);
          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: typeof data === "string" ? data : JSON.stringify(data, null, 2),
                },
              ],
              isError: false,
            },
          });
        } catch (err: any) {
          return res.json({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: `Error executing tool '${name}': ${err?.message || err}`,
                },
              ],
              isError: true,
            },
          });
        }
      }

      case "resources/list":
        return res.json({
          jsonrpc: "2.0",
          id,
          result: { resources: this.mcpService.getResourcesList() },
        });

      case "resources/read": {
        const { uri } = params || {};
        const content = this.mcpService.readResource(uri);
        if (!content) {
          return res.json({
            jsonrpc: "2.0",
            id,
            error: { code: -32602, message: `Resource '${uri}' not found` },
          });
        }

        return res.json({
          jsonrpc: "2.0",
          id,
          result: {
            contents: [
              {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(content),
              },
            ],
          },
        });
      }

      case "ping":
        return res.json({ jsonrpc: "2.0", id, result: {} });

      default:
        return res.json({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Method '${method}' is not implemented by this server`,
          },
        });
    }
  }
}
