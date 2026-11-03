import { type ArgumentsHost, Catch, ConflictException, type ExceptionFilter, HttpException, Logger, NotFoundException } from "@nestjs/common";
import type { Response } from "express";
import { Prisma } from "../generated/prisma/client.js";

/** Database races become answers the UI can act on, rather than a raw 500. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(err: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const mapped: HttpException | null =
      err.code === "P2002" || err.code === "P2034"
        ? new ConflictException({ code: "VERSION_CONFLICT", message: "Someone else just changed this. Your screen has been refreshed - please try again." })
        : err.code === "P2025"
          ? new NotFoundException({ message: "That no longer exists" })
          : null;
    if (mapped) return void res.status(mapped.getStatus()).json(mapped.getResponse());
    this.logger.error(`Unhandled database error ${err.code}`, err.stack);
    res.status(500).json({ message: "Something went wrong. Please try again." });
  }
}
