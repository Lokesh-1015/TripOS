import { Controller, Get, Logger, ServiceUnavailableException } from "@nestjs/common";
import { Public } from "../auth/session.guard.js";
import { PrismaService } from "../prisma/prisma.service.js";

@Public()
@Controller("health")
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Whether the API process is up, without touching the database. Uptime pings use this, so keeping
   * the server awake doesn't also keep the database awake and use up its free compute hours.
   */
  @Get("live")
  live() {
    return { status: "ok", uptimeSeconds: Math.round(process.uptime()) };
  }

  /** Whether the API can also reach its database. */
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
