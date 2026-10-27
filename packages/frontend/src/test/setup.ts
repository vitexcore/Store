import '@testing-library/jest-dom';
import { vi } from 'vitest';

// jsdom has no layout engine and does not implement this browser scrolling API.
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
});

// jsdom does not implement window.matchMedia. Provide a minimal stub so that
// ThemeProvider (which calls matchMedia for OS dark-mode preference detection)
// does not throw in tests. Individual tests can override this stub.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Suppress React Router v6 → v7 future flag warnings in test output.
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
