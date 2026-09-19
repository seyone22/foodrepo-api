import {
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ZodValidationPipe } from "nestjs-zod";
import { GetAuditLogsQueryDto, getAuditLogsQuerySchema } from "./dto/admin.dto";
import { AdminService } from "./admin.service";

@ApiTags("Admin")
@Controller("admin")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("analytics")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Get database distribution analytics" })
  async getAnalytics() {
    return this.adminService.getAnalytics();
  }

  @Get("quality")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Get ingredient metadata quality report" })
  async getQuality() {
    return this.adminService.getQuality();
  }

  @Get("logs")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Fetch audit logs" })
  async getAuditLogs(
    @Query(new ZodValidationPipe(getAuditLogsQuerySchema))
    queryDto: GetAuditLogsQueryDto,
  ) {
    return this.adminService.getAuditLogs({
      type: queryDto.type,
      tag: queryDto.tag,
      status: queryDto.status,
      page: queryDto.page,
      limit: queryDto.limit,
    });
  }

  @Get("stats")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Get high-level food repository statistics" })
  async getStats() {
    return this.adminService.getDatabaseStats();
  }

  @Post("scraper/run")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Trigger manual GitHub scraper workflow" })
  async triggerScraper() {
    return this.adminService.triggerGithubScraper();
  }

}
