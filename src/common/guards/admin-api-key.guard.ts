import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import * as crypto from "crypto";
import type { Request } from "express";

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expectedKey = process.env.ADMIN_API_KEY;
    if (!expectedKey) {
      throw new UnauthorizedException(
        "Admin API key is not configured on the server.",
      );
    }

    const req = context.switchToHttp().getRequest<Request>();
    const headerKey = req.headers["x-admin-api-key"];
    const authHeader = req.headers["authorization"];

    let providedKey = "";
    if (typeof headerKey === "string" && headerKey.trim()) {
      providedKey = headerKey.trim();
    } else if (
      typeof authHeader === "string" &&
      authHeader.toLowerCase().startsWith("bearer ")
    ) {
      providedKey = authHeader.substring(7).trim();
    }

    if (!providedKey) {
      throw new UnauthorizedException("Missing admin credentials.");
    }

    const providedBuf = Buffer.from(providedKey);
    const expectedBuf = Buffer.from(expectedKey);
    if (
      providedBuf.length !== expectedBuf.length ||
      !crypto.timingSafeEqual(providedBuf, expectedBuf)
    ) {
      throw new UnauthorizedException("Invalid admin credentials.");
    }

    return true;
  }
}
