import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { AccountService } from "./auth/account.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthService } from "./auth/auth.service.js";
import { EmailCheckService } from "./auth/email-check.service.js";
import { GoogleAuthService } from "./auth/google-auth.service.js";
import { SessionGuard } from "./auth/session.guard.js";
import { TripAccessGuard } from "./authz/trip-access.guard.js";
import { PrismaExceptionFilter } from "./common/prisma-exception.filter.js";
import { FileStorage } from "./files/file-storage.service.js";
import { FilesController } from "./files/files.controller.js";
import { HealthController } from "./health/health.controller.js";
import { JobsController } from "./jobs/jobs.controller.js";
import { RemindersService } from "./jobs/reminders.service.js";
import { MailService } from "./mail/mail.service.js";
import { PrismaModule } from "./prisma/prisma.module.js";
import { RatesController } from "./rates/rates.controller.js";
import { RatesService } from "./rates/rates.service.js";
import { RealtimeGateway } from "./realtime/realtime.gateway.js";
import { SocialController } from "./social/social.controller.js";
import { SocialService } from "./social/social.service.js";
import { ContactController } from "./support/contact.controller.js";
import { PostsController } from "./posts/posts.controller.js";
import { LeaveController } from "./trips/leave.controller.js";
import { PostsService } from "./posts/posts.service.js";
import { ExpensesController } from "./trips/expenses.controller.js";
import { PublicTripsController } from "./trips/public-trips.controller.js";
import { ItineraryController } from "./trips/itinerary.controller.js";
import { LiveLocationController } from "./trips/live-location.controller.js";
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
    RatesController,
    LiveLocationController,
    JobsController,
    ContactController,
    SocialController,
    PublicTripsController,
    PostsController,
    LeaveController,
  ],
  providers: [{ provide: APP_GUARD, useClass: SessionGuard }, { provide: APP_FILTER, useClass: PrismaExceptionFilter }, AccountService, AuthService, EmailCheckService, FileStorage, GoogleAuthService, MailService, PostsService, RatesService, RemindersService, SocialService, TripAccessGuard, RealtimeGateway, TripWriter],
})
export class AppModule {}
