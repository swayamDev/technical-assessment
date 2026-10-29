// Runs the unit tests once per timezone the assessors use. TZ must be set before
// the Node process starts, so each run is a separate vitest process.
import { spawnSync } from "node:child_process";
import path from "node:path";

const vitestBin = path.join(
  process.cwd(),
  "node_modules",
  "vitest",
  "vitest.mjs",
);
const timezones = ["UTC", "Asia/Kuala_Lumpur", "America/New_York"];

for (const tz of timezones) {
  console.log(`\n=== TZ=${tz} ===`);
  const result = spawnSync(
    process.execPath,
    [vitestBin, "run", ...process.argv.slice(2)],
    {
      stdio: "inherit",
      env: { ...process.env, TZ: tz, EXPECTED_TZ: tz },
    },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
