// Turning away addresses that can't be real, with DNS replaced so the tests don't depend on it.
import type { ConfigService } from "@nestjs/config";
import { describe, expect, it, vi } from "vitest";
import { EmailCheckService } from "../src/auth/email-check.service.js";

const dnsError = (code: string) => Object.assign(new Error(code), { code });
const config = (env: Record<string, string> = {}) => ({ get: (key: string, fallback?: string) => env[key] ?? fallback }) as unknown as ConfigService;

function service(lookup: Partial<EmailCheckService["lookup"]> = {}, env: Record<string, string> = {}) {
  const check = new EmailCheckService(config(env));
  check.lookup = { mx: async () => [{ exchange: "mail.example" }], address: async () => ({}), ...lookup };
  vi.spyOn((check as unknown as { logger: { warn: () => void } }).logger, "warn").mockImplementation(() => undefined);
  return check;
}

describe("EmailCheckService", () => {
  it("accepts an address at a domain that takes mail", async () => {
    await expect(service().assertReal("friend@gmail.com")).resolves.toBeUndefined();
  });

  it.each(["a@example.com", "a@example.org", "a@test.com", "a@thing.test", "a@thing.invalid", "a@localhost", "a@thing.local"])("turns away %s, which can never receive mail", async (email) => {
    await expect(service().assertReal(email)).rejects.toThrow();
  });

  it.each(["a@mailinator.com", "a@guerrillamail.com", "a@10minutemail.com", "a@sub.mailinator.com"])("turns away the throwaway address %s", async (email) => {
    await expect(service().assertReal(email)).rejects.toMatchObject({ response: { message: expect.stringContaining("Temporary") } });
  });

  it("turns away a domain that doesn't exist, pointing at a typo", async () => {
    const check = service({ mx: async () => Promise.reject(dnsError("ENOTFOUND")), address: async () => Promise.reject(dnsError("ENOTFOUND")) });
    await expect(check.assertReal("a@gmial-typo.com")).rejects.toMatchObject({ response: { message: expect.stringContaining("gmial-typo.com") } });
  });

  it("turns away a domain that says it takes no email", async () => {
    await expect(service({ mx: async () => [{ exchange: "" }] }).assertReal("a@no-mail.org")).rejects.toThrow();
  });

  it("accepts a domain with no mail records that has an address, as mail goes there", async () => {
    await expect(service({ mx: async () => Promise.reject(dnsError("ENODATA")) }).assertReal("a@small-company.in")).resolves.toBeUndefined();
  });

  it("lets the address through when DNS itself is having trouble, so an outage can't block signups", async () => {
    await expect(service({ mx: async () => Promise.reject(dnsError("ESERVFAIL")) }).assertReal("a@anything.in")).resolves.toBeUndefined();
    await expect(service({ mx: async () => Promise.reject(dnsError("ETIMEOUT")) }).assertReal("a@anything.in")).resolves.toBeUndefined();
  });

  it("looks a domain up once, and doesn't remember a failed lookup", async () => {
    const mx = vi.fn<EmailCheckService["lookup"]["mx"]>().mockRejectedValueOnce(dnsError("ETIMEOUT")).mockResolvedValue([{ exchange: "mail.example" }]);
    const check = service({ mx });
    await check.assertReal("a@cached.in");
    await check.assertReal("b@cached.in");
    await check.assertReal("c@cached.in");
    expect(mx).toHaveBeenCalledTimes(2);
  });

  it("asks real DNS by default: a made-up domain is turned away, and a real one isn't", async () => {
    const check = new EmailCheckService(config());
    vi.spyOn((check as unknown as { logger: { warn: () => void } }).logger, "warn").mockImplementation(() => undefined);
    await expect(check.assertReal("a@gmail.com")).resolves.toBeUndefined();
    await expect(check.assertReal(`a@no-such-domain-${Date.now()}-tripos.com`)).rejects.toThrow();
  });

  it("skips test domains only outside production", async () => {
    const development = service({}, { EMAIL_CHECK_SKIP_DOMAINS: "example.test" });
    expect(development.isExempt("a@example.test")).toBe(true);
    await expect(development.assertReal("a@example.test")).resolves.toBeUndefined();

    const production = service({}, { EMAIL_CHECK_SKIP_DOMAINS: "example.test", NODE_ENV: "production" });
    expect(production.isExempt("a@example.test")).toBe(false);
    await expect(production.assertReal("a@example.test")).rejects.toThrow();
  });
});
