import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Every route lives under /api: the frontend calls relative /api/* paths, proxied by Vite in dev.
  app.setGlobalPrefix("api");
  app.use(cookieParser());
  // Requests arrive through proxies, and rate limits need the visitor's address rather than the proxy's.
  app.set("trust proxy", true);
  app.enableShutdownHooks();

  const origins = config.get<string>("CORS_ORIGINS", "").split(",").map((o) => o.trim()).filter(Boolean);
  if (origins.length) app.enableCors({ origin: origins, credentials: true });

  await app.listen(config.get<number>("PORT", 4000));
}

void bootstrap();
