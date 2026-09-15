import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import type { Response, Request } from "express";

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = "Internal Server Error";
    let detail: string | undefined;
    let errors: unknown | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === "string") {
        detail = res;
      } else if (typeof res === "object" && res !== null) {
        const obj = res as Record<string, unknown>;
        title = (obj.error as string) || (obj.message as string) || title;
        detail = (obj.message as string) || detail;
        errors = obj.errors;
      }
    } else if (exception instanceof Error) {
      detail = exception.message;
    }

    const problem = {
      type: `https://foodrepo.seyone.dev/errors/${status}`,
      title,
      status,
      detail,
      instance: request.url,
      ...(errors ? { errors } : {}),
    };

    response
      .status(status)
      .contentType("application/problem+json")
      .json(problem);
  }
}
