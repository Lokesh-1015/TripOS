import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Every route lives under /api: the frontend calls relative /api/* paths, proxied by Vite in dev.
  app.setGlobalPrefix("api");
  app.use(cookieParser());
  app.enableShutdownHooks();

  const origins = config.get<string>("CORS_ORIGINS", "").split(",").map((o) => o.trim()).filter(Boolean);
  if (origins.length) app.enableCors({ origin: origins, credentials: true });

  await app.listen(config.get<number>("PORT", 4000));
}

void bootstrap();
