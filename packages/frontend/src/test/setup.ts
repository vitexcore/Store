import '@testing-library/jest-dom';

// Suppress React Router v6 → v7 future flag warnings in test output.
// These are informational deprecation notices, not test failures.
const originalWarn = console.warn.bind(console);
beforeAll(() => {
  console.warn = (msg: unknown, ...args: unknown[]) => {
    if (typeof msg === 'string' && msg.includes('React Router Future Flag Warning')) return;
    originalWarn(msg, ...args);
  };
});
afterAll(() => {
  console.warn = originalWarn;
});
