import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { SessionGuard } from "./auth/session.guard.js";
import { TripAccessGuard } from "./authz/trip-access.guard.js";
import { PrismaExceptionFilter } from "./common/prisma-exception.filter.js";
import { FileStorage } from "./files/file-storage.service.js";
import { FilesController } from "./files/files.controller.js";
import { HealthController } from "./health/health.controller.js";
import { MailService } from "./mail/mail.service.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { RealtimeGateway } from "./realtime/realtime.gateway.js";
import { ExpensesController } from "./trips/expenses.controller.js";
import { ItineraryController } from "./trips/itinerary.controller.js";
import { PlanningController } from "./trips/planning.controller.js";
import { PollsController } from "./trips/polls.controller.js";
import { SharingController } from "./trips/sharing.controller.js";
import { StateController } from "./trips/state.controller.js";
import { TripWriter } from "./trips/trip-writer.service.js";
import { InvitesController, TripsController } from "./trips/trips.controller.js";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 300 }],
      // Test suites create dozens of accounts a minute. Production ignores this setting.
      skipIf: () => process.env.THROTTLE_DISABLED === "true" && process.env.NODE_ENV !== "production",
    })],
  controllers: [
    HealthController,
    AuthController,
    StateController,
    TripsController,
    InvitesController,
    PollsController,
    ItineraryController,
    ExpensesController,
    PlanningController,
    SharingController,
    FilesController,
  ],
  providers: [{ provide: APP_GUARD, useClass: SessionGuard }, { provide: APP_FILTER, useClass: PrismaExceptionFilter }, AuthService, MailService, TripAccessGuard, RealtimeGateway, TripWriter, FileStorage],
})
export class AppModule {}
