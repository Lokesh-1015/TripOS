import { Controller, Get, Query, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { z } from "zod";
import { parse } from "../common/validation.js";
import { PlaceSearchService } from "./place-search.service.js";

const searchQuery = z.object({
  q: z.string().trim().min(2).max(200),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

@UseGuards(ThrottlerGuard)
@Throttle({ default: { ttl: 60_000, limit: 60 } })
@Controller("places")
export class PlaceSearchController {
  constructor(private readonly places: PlaceSearchService) {}

  @Get("search")
  async search(@Query() query: unknown) {
    const { q, lat, lng } = parse(searchQuery, query);
    const results = await this.places.search(q, lat !== undefined && lng !== undefined ? { lat, lng } : undefined);
    if (!results) throw new ServiceUnavailableException({ message: "Place search isn't available right now" });
    return results;
  }
}
