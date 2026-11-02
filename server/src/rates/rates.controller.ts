import { Controller, Get, Query, ServiceUnavailableException } from "@nestjs/common";
import { z } from "zod";
import { isoDate, parse } from "../common/validation.js";
import { RatesService } from "./rates.service.js";

const ratesQuery = z.object({ date: isoDate.optional() });

@Controller("exchange-rates")
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  @Get()
  async latest(@Query() query: unknown) {
    const { date } = parse(ratesQuery, query);
    const rates = await (date ? this.rates.onDate(date) : this.rates.latest());
    if (!rates) throw new ServiceUnavailableException({ message: "Exchange rates aren't available right now" });
    return rates;
  }
}
