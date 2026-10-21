/**
 * Day 6 frontend component tests.
 *
 * Covers:
 *  PasswordInput:
 *   - Renders as password type by default (value hidden)
 *   - Toggle button reveals password (changes type to text)
 *   - Toggle button conceals password again (changes type back to password)
 *   - Typed value is preserved when toggling visibility
 *   - Toggle button has accessible aria-label
 *   - Toggle is a button of type="button" (does not submit the form)
 *   - id prop is forwarded to the input element
 *   - Additional HTML input props (disabled, required, etc.) are forwarded
 *
 *  ThemeToggle:
 *   - Renders a button with an accessible aria-label
 *   - Calls toggleTheme when clicked (aria-label changes to reflect new state)
 *   - aria-label reflects current theme state
 *
 *  ThemeProvider + persistence:
 *   - Reads stored theme from localStorage on mount
 *   - Writes selected theme to localStorage when changed
 *   - applyTheme adds/removes "dark" class from document.documentElement
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasswordInput } from '../components/ui/PasswordInput.tsx';
import { ThemeToggle } from '../components/ui/ThemeToggle.tsx';
import { ThemeProvider, useTheme } from '../lib/theme.tsx';

// ---------------------------------------------------------------------------
// PasswordInput tests
// ---------------------------------------------------------------------------

describe('PasswordInput', () => {
  it('renders as password type by default', () => {
    render(<PasswordInput id="pw" value="" onChange={() => {}} />);
    const input = document.getElementById('pw') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.type).toBe('password');
  });

  it('has an accessible toggle button labelled "Show password"', () => {
    render(<PasswordInput id="pw" value="" onChange={() => {}} />);
    const btn = screen.getByRole('button', { name: /show password/i });
    expect(btn).toBeInTheDocument();
  });

  it('clicking toggle reveals the password (type becomes text)', async () => {
    const user = userEvent.setup();
    render(<PasswordInput id="pw" value="secret" onChange={() => {}} />);
    const input = document.getElementById('pw') as HTMLInputElement;
    expect(input.type).toBe('password');

    await user.click(screen.getByRole('button', { name: /show password/i }));
    expect(input.type).toBe('text');
  });

  it('clicking toggle a second time conceals the password again', async () => {
    const user = userEvent.setup();
    render(<PasswordInput id="pw" value="secret" onChange={() => {}} />);
    const input = document.getElementById('pw') as HTMLInputElement;

    await user.click(screen.getByRole('button', { name: /show password/i }));
    expect(input.type).toBe('text');

    await user.click(screen.getByRole('button', { name: /hide password/i }));
    expect(input.type).toBe('password');
  });

  it('aria-label on the toggle button reflects the current visibility state', async () => {
    const user = userEvent.setup();
    render(<PasswordInput id="pw" value="" onChange={() => {}} />);

    expect(screen.getByRole('button', { name: /show password/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /show password/i }));
    expect(screen.getByRole('button', { name: /hide password/i })).toBeInTheDocument();
  });

  it('toggling visibility does not alter the controlled value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PasswordInput id="pw" value="my-password" onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: /show password/i }));

    const input = document.getElementById('pw') as HTMLInputElement;
    expect(input.value).toBe('my-password');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('toggle button has type="button" so it does not submit a parent form', () => {
    render(
      <form onSubmit={(e) => e.preventDefault()}>
        <PasswordInput id="pw" value="" onChange={() => {}} />
      </form>,
    );
    const btn = screen.getByRole('button', { name: /show password/i });
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('forwards the id prop to the underlying input element', () => {
    render(<PasswordInput id="my-password-field" value="" onChange={() => {}} />);
    expect(document.getElementById('my-password-field')).toBeInTheDocument();
  });

  it('forwards the disabled prop to the input', () => {
    render(<PasswordInput id="pw" value="" onChange={() => {}} disabled />);
    expect(document.getElementById('pw')).toBeDisabled();
  });

  it('forwards the required prop to the input', () => {
    render(<PasswordInput id="pw" value="" onChange={() => {}} required />);
    expect(document.getElementById('pw')).toBeRequired();
  });

  it('forwards the autoComplete prop to the input', () => {
    render(<PasswordInput id="pw" value="" onChange={() => {}} autoComplete="current-password" />);
    const input = document.getElementById('pw') as HTMLInputElement;
    expect(input.getAttribute('autocomplete')).toBe('current-password');
  });
});

// ---------------------------------------------------------------------------
// ThemeToggle tests
// ---------------------------------------------------------------------------

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('renders a button with a non-empty aria-label', () => {
    localStorage.setItem('store_theme', 'light');
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-label');
    const label = btn.getAttribute('aria-label') ?? '';
    expect(label.length).toBeGreaterThan(0);
  });

  it('aria-label reads "Switch to dark mode" when in light mode', () => {
    localStorage.setItem('store_theme', 'light');
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Switch to dark mode');
  });

  it('aria-label reads "Switch to light mode" when in dark mode', () => {
    localStorage.setItem('store_theme', 'dark');
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Switch to light mode');
  });

  it('clicking the toggle changes the aria-label to the opposite theme', async () => {
    const user = userEvent.setup();
    localStorage.setItem('store_theme', 'light');
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    const btn = screen.getByRole('button', { name: /switch to dark mode/i });
    await user.click(btn);
    expect(screen.getByRole('button')).toHaveAttribute('aria-label', 'Switch to light mode');
  });
});

// ---------------------------------------------------------------------------
// ThemeProvider — localStorage persistence and DOM class tests
// ---------------------------------------------------------------------------

describe('ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  it('adds the "dark" class to documentElement when dark theme is active', () => {
    localStorage.setItem('store_theme', 'dark');
    render(
      <ThemeProvider>
        <span>child</span>
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes the "dark" class from documentElement when light theme is active', () => {
    document.documentElement.classList.add('dark');
    localStorage.setItem('store_theme', 'light');
    render(
      <ThemeProvider>
        <span>child</span>
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('persists the toggled theme to localStorage', async () => {
    const user = userEvent.setup();
    localStorage.setItem('store_theme', 'light');
    render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('button', { name: /switch to dark mode/i }));
    expect(localStorage.getItem('store_theme')).toBe('dark');
  });

  it('reads the stored theme from localStorage on mount', () => {
    localStorage.setItem('store_theme', 'dark');

    function ReadTheme() {
      const { theme } = useTheme();
      return <span data-testid="theme">{theme}</span>;
    }

    render(
      <ThemeProvider>
        <ReadTheme />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });

  it('defaults to light when localStorage is empty and OS does not prefer dark', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (_query: string) => ({ matches: false }),
    });

    function ReadTheme() {
      const { theme } = useTheme();
      return <span data-testid="theme">{theme}</span>;
    }

    render(
      <ThemeProvider>
        <ReadTheme />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });
});
