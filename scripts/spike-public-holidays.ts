import { createSouthAfricaPublicHolidayService } from "../src/integrations/public-holidays.js";

const yearArgument = process.argv[2];
const year = yearArgument === undefined ? new Date().getUTCFullYear() : Number(yearArgument);
const service = createSouthAfricaPublicHolidayService();
const result = await service.execute(year);

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

if (result.source === "fallback") {
  process.exitCode = 1;
}
