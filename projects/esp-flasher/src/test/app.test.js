import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';


const appSource = readFileSync(fileURLToPath(new URL('../App.jsx', import.meta.url)), 'utf8');

describe('App bundle loading', () => {
  it('loads esptool-js only when connecting', () => {
    expect(appSource).not.toMatch(/import\s*\{[^}]*ESPLoader[^}]*\}\s*from\s*['"]esptool-js['"]/);
    expect(appSource).toMatch(/await\s+import\(['"]esptool-js['"]\)/);
  });
});
