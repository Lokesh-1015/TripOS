import { Controller, Get, Logger, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../auth/session.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Public()
@Controller("health")
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      // Details stay in the server log; this endpoint is public.
      this.logger.error("Database check failed", err instanceof Error ? err.stack : String(err));
      throw new ServiceUnavailableException({ status: "error", database: "down" });
    }
    return { status: "ok", database: "up" };
  }
}
