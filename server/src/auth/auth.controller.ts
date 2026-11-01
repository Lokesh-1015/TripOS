import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import type { Request, Response } from "express";
import { z } from "zod";
import { parse } from "../common/validation.js";
import { issueTicket } from "../realtime/ticket.js";
import type { User } from "../generated/prisma/client.js";
import { AuthService } from "./auth.service.js";
import { CurrentUser, Public, SESSION_COOKIE } from "./session.guard.js";

const signUpBody = z.object({ name: z.string().trim().min(2).max(100), email: z.email(), password: z.string().min(8).max(200) });
const logInBody = z.object({ email: z.email(), password: z.string().min(1).max(200) });
const forgotBody = z.object({ email: z.email() });
const resetBody = z.object({ token: z.string().min(10), password: z.string().min(8).max(200) });
const verifyBody = z.object({ token: z.string().min(10) });
const changeBody = z.object({ current: z.string().min(1), next: z.string().min(8).max(200) });

@UseGuards(ThrottlerGuard)
@Throttle({ default: { ttl: 60_000, limit: 30 } })
@Controller("auth")
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post("signup")
  async signUp(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { name, email, password } = parse(signUpBody, body);
    const { token } = await this.auth.signUp(name, email, password);
    this.setCookie(res, token);
    return { ok: true };
  }

  @Public()
  @HttpCode(200)
  @Post("login")
  async logIn(@Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { email, password } = parse(logInBody, body);
    const { token } = await this.auth.logIn(email, password);
    this.setCookie(res, token);
    return { ok: true };
  }

  @Public()
  @HttpCode(200)
  @Post("logout")
  async logOut(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logOut(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  }

  @Public()
  @HttpCode(200)
  @Post("forgot-password")
  async forgot(@Body() body: unknown) {
    await this.auth.requestPasswordReset(parse(forgotBody, body).email);
    return { ok: true, emailEnabled: this.auth.emailEnabled };
  }

  @Public()
  @HttpCode(200)
  @Post("reset-password")
  async reset(@Body() body: unknown) {
    const { token, password } = parse(resetBody, body);
    await this.auth.resetPassword(token, password);
    return { ok: true };
  }

  @Public()
  @HttpCode(200)
  @Post("verify-email")
  async verify(@Body() body: unknown) {
    await this.auth.verifyEmail(parse(verifyBody, body).token);
    return { ok: true };
  }

  @HttpCode(200)
  @Post("resend-verification")
  async resend(@CurrentUser() user: User) {
    if (!user.emailVerifiedAt) await this.auth.sendVerification(user);
    return { ok: true };
  }

  @Get("realtime-ticket")
  realtimeTicket(@CurrentUser() user: User) {
    return { ticket: issueTicket(user.id) };
  }

  @HttpCode(200)
  @Post("change-password")
  async change(@CurrentUser() user: User, @Req() req: Request, @Body() body: unknown) {
    const { current, next } = parse(changeBody, body);
    await this.auth.changePassword(user, current, next, req.cookies?.[SESSION_COOKIE]);
    return { ok: true };
  }

  private setCookie(res: Response, token: string) {
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: this.config.get("NODE_ENV") === "production", path: "/", maxAge: 30 * 24 * 60 * 60 * 1000 });
  }
}
