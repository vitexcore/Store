/**
 * Frontend component smoke tests.
 *
 * These verify that key components render without crashing and contain
 * the expected accessible text and ARIA elements.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from '../pages/DashboardPage.tsx';
import { CheckoutPage } from '../pages/CheckoutPage.tsx';
import { AssistantPage } from '../pages/AssistantPage.tsx';
import { NotFoundPage } from '../pages/NotFoundPage.tsx';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('DashboardPage', () => {
  it('renders the page heading', () => {
    render(<DashboardPage />, { wrapper: Wrapper });
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
  });

  it('renders metric card labels', () => {
    render(<DashboardPage />, { wrapper: Wrapper });
    expect(screen.getByText(/total revenue/i)).toBeInTheDocument();
    expect(screen.getByText(/orders today/i)).toBeInTheDocument();
  });
});

describe('CheckoutPage', () => {
  it('renders the page heading', () => {
    render(<CheckoutPage />, { wrapper: Wrapper });
    expect(screen.getByRole('heading', { name: /qr checkout/i })).toBeInTheDocument();
  });

  it('shows the simulated payment disclaimer', () => {
    render(<CheckoutPage />, { wrapper: Wrapper });
    expect(screen.getByText(/simulated payments only/i)).toBeInTheDocument();
  });
});

describe('AssistantPage', () => {
  it('renders the page heading', () => {
    render(<AssistantPage />, { wrapper: Wrapper });
    expect(screen.getByRole('heading', { name: /ai assistant/i })).toBeInTheDocument();
  });

  it('shows read-only disclaimer', () => {
    render(<AssistantPage />, { wrapper: Wrapper });
    expect(screen.getByText(/read-only analytics/i)).toBeInTheDocument();
  });
});

describe('NotFoundPage', () => {
  it('renders a link back to dashboard', () => {
    render(<NotFoundPage />, { wrapper: Wrapper });
    const link = screen.getByRole('link', { name: /go to dashboard/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/dashboard');
  });
});
