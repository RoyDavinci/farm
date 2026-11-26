import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

// The worker enters the modules in a different order from the API. A circular import can work
// in one and crash the other at startup, so load the worker's jobs alone in a fresh process.
it('loads the worker’s jobs on their own', () => {
  const out = execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '-e',
      "await import('./src/jobs/scheduler.ts'); console.log('loaded'); process.exit(0)",
    ],
    { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8' },
  );
  expect(out).toContain('loaded');
});
