import { describe, expect, it, vi } from "vitest";
import { HealthController } from "../src/health/health.controller.js";

describe("health", () => {
  it("answers the liveness check without touching the database", () => {
    const queryRaw = vi.fn();
    const health = new HealthController({ $queryRaw: queryRaw } as never);
    const res = health.live();
    expect(res.status).toBe("ok");
    expect(res.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("reports the database on the full check", async () => {
    const health = new HealthController({ $queryRaw: vi.fn().mockResolvedValue([{ "?column?": 1 }]) } as never);
    await expect(health.check()).resolves.toEqual({ status: "ok", database: "up" });
    const down = new HealthController({ $queryRaw: vi.fn().mockRejectedValue(new Error("no db")) } as never);
    await expect(down.check()).rejects.toMatchObject({ status: 503 });
  });
});
