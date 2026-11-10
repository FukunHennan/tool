import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const vitestCli = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));
const result = spawnSync(process.execPath, [vitestCli, "run", "src/esp/exportEspWorkbook.test.ts"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
