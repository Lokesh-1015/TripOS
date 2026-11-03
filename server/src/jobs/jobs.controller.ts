import { timingSafeEqual } from "node:crypto";
import { Body, Controller, Headers, HttpCode, NotFoundException, Post } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { z } from "zod";
import { Public } from "../auth/session.guard.js";
import { FileStorage } from "../files/file-storage.service.js";
import { isoDate, parse } from "../common/validation.js";
import { RemindersService } from "./reminders.service.js";

const dailyBody = z.object({ today: isoDate.optional() });

/** Called by a scheduled workflow, which proves itself with a shared secret rather than a login. */
@Public()
@Controller("jobs")
export class JobsController {
  constructor(
    private readonly config: ConfigService,
    private readonly reminders: RemindersService,
    private readonly storage: FileStorage,
  ) {}

  private assertSecret(given: string | undefined) {
    const secret = this.config.get<string>("JOBS_SECRET");
    const expected = Buffer.from(secret ?? "");
    const actual = Buffer.from(given ?? "");
    // The same answer whether it's unset or wrong, so this route gives nothing away.
    if (!secret || expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new NotFoundException();
  }

  @HttpCode(200)
  @Post("daily")
  daily(@Headers("x-jobs-secret") given: string | undefined, @Body() body: unknown) {
    this.assertSecret(given);
    // Tests choose the date. Production always uses the real one.
    const today = process.env.NODE_ENV === "production" ? undefined : parse(dailyBody, body ?? {}).today;
    return this.reminders.runDaily(today);
  }

  /** Runs the same file upkeep as the server's own timer, for when someone wants it done now. */
  @HttpCode(200)
  @Post("storage")
  storageUpkeep(@Headers("x-jobs-secret") given: string | undefined) {
    this.assertSecret(given);
    return this.storage.maintain(50);
  }
}
