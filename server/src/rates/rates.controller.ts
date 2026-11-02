import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { RatesService } from "./rates.service.js";

@Controller("exchange-rates")
export class RatesController {
  constructor(private readonly rates: RatesService) {}

  @Get()
  async latest() {
    const rates = await this.rates.latest();
    if (!rates) throw new ServiceUnavailableException({ message: "Exchange rates aren't available right now" });
    return rates;
  }
}
