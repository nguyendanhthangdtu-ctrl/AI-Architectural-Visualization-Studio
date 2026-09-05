import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// vitest.config.ts does not set test.globals — @testing-library/react's
// automatic cleanup depends on detecting a global `afterEach`, which isn't
// present, so it must be wired explicitly here instead of per test file.
afterEach(() => {
  cleanup();
});
