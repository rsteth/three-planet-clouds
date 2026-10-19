import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const directory = new URL('../tests/', import.meta.url);
for (const name of readdirSync(directory)
  .filter((name) => name.endsWith('.mjs'))
  .sort()) {
  const result = spawnSync(process.execPath, [new URL(name, directory).pathname], {
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
