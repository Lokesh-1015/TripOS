import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    super({ adapter: new PrismaPg({ connectionString: config.getOrThrow<string>("DATABASE_URL") }) });
  }

  // A database outage must not stop the API booting: /api/health reports it and the pool reconnects.
  async onModuleInit() {
    try {
      // $connect() alone doesn't authenticate with a driver adapter, so run a real query.
      await this.$queryRaw`SELECT 1`;
      this.logger.log("Connected to PostgreSQL");
    } catch (err) {
      this.logger.error("Could not connect to PostgreSQL", err instanceof Error ? err.stack : String(err));
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
