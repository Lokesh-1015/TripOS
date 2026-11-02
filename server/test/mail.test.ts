// Sending through Resend, with its API replaced: real sends need a verified domain.
import type { ConfigService } from "@nestjs/config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MailService } from "../src/mail/mail.service.js";

const service = (env: Record<string, string>) => new MailService({ get: (key: string, fallback?: string) => env[key] ?? fallback } as unknown as ConfigService);
const resend = () => service({ RESEND_API_KEY: "re_test", MAIL_FROM: "TripOS <hello@example.org>", APP_URL: "https://app.example.org" });
const answer = (status: number, body = "{}") => new Response(body, { status });

describe("MailService with Resend", () => {
  const fetchMock = vi.fn<typeof fetch>();
  const logged = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    logged.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const sendReset = async (mail: MailService) => {
    vi.spyOn((mail as unknown as { logger: { error: typeof logged } }).logger, "error").mockImplementation(logged);
    const sent = mail.sendPasswordReset("friend@example.org", "secret-token");
    await vi.runAllTimersAsync();
    await sent;
  };
  const keys = () => fetchMock.mock.calls.map(([, init]) => (init?.headers as Record<string, string>)["Idempotency-Key"]);

  it("posts the email to Resend with the key, sender and link", async () => {
    fetchMock.mockResolvedValue(answer(200));
    await sendReset(resend());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer re_test");
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({ from: "TripOS <hello@example.org>", to: "friend@example.org", subject: "Reset your TripOS password" });
    expect(body.text).toContain("https://app.example.org/reset-password/secret-token");
    expect(logged).not.toHaveBeenCalled();
  });

  it("retries a rate limit with the same key, so it can't send twice", async () => {
    fetchMock.mockResolvedValueOnce(answer(429)).mockResolvedValueOnce(answer(200));
    await sendReset(resend());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Set(keys()).size).toBe(1);
    expect(logged).not.toHaveBeenCalled();
  });

  it("retries a network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("socket hang up")).mockResolvedValueOnce(answer(200));
    await sendReset(resend());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logged).not.toHaveBeenCalled();
  });

  it("gives up after three attempts and logs without throwing", async () => {
    fetchMock.mockImplementation(async () => answer(503));
    await sendReset(resend());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it("doesn't retry a rejected email, and logs why without the sign-in token", async () => {
    fetchMock.mockResolvedValue(answer(403, '{"message":"The example.org domain is not verified"}'));
    await sendReset(resend());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const log = JSON.stringify(logged.mock.calls);
    expect(log).toContain("domain is not verified");
    expect(log).not.toContain("secret-token");
  });
});

describe("MailService configuration", () => {
  it("is on with either setting and off with neither", () => {
    expect(service({ RESEND_API_KEY: "re_test" }).enabled).toBe(true);
    expect(service({ SMTP_URL: "smtp://localhost:1025" }).enabled).toBe(true);
    expect(service({}).enabled).toBe(false);
  });

  it("prefers Resend when both are set", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(answer(200));
    vi.stubGlobal("fetch", fetchMock);
    await service({ RESEND_API_KEY: "re_test", SMTP_URL: "smtp://localhost:1" }).sendPasswordReset("friend@example.org", "token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});
