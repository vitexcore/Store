/**
 * Frontend component smoke tests.
 *
 * These verify that key components render without crashing and contain
 * the expected accessible text and ARIA elements.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { api } from '../lib/api.js';
import type { SalesAnalytics } from '@store/shared';
import { DashboardPage } from '../pages/DashboardPage.tsx';
import { CheckoutPage } from '../pages/CheckoutPage.tsx';
import { AssistantPage } from '../pages/AssistantPage.tsx';
import { NotFoundPage } from '../pages/NotFoundPage.tsx';

// Mock the api module so DashboardPage doesn't make real HTTP calls in tests
vi.mock('../lib/api.js', () => ({
  api: {
    dashboard: {
      get: vi.fn().mockResolvedValue({ ok: false, code: 'NETWORK_ERROR', message: 'No server in test' }),
    },
    analytics: {
      sales: vi.fn().mockResolvedValue({ ok: false, code: 'NETWORK_ERROR', message: 'No server in test' }),
    },
    store: {
      get: vi.fn().mockResolvedValue({ ok: false, code: 'NETWORK_ERROR', message: 'No server in test' }),
    },
    assistant: {
      query: vi.fn().mockResolvedValue({ ok: false, code: 'NETWORK_ERROR', message: 'No server in test' }),
    },
  },
}));
// Mock useAuth so DashboardPage and CheckoutPage can render without an AuthProvider
vi.mock('../lib/auth.js', () => ({
  useAuth: () => ({ user: { storeName: 'Test Store', storeSlug: 'test-store' } }),
}));

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe('DashboardPage', () => {
  it('renders the page heading', () => {
    render(<DashboardPage />, { wrapper: Wrapper });
    expect(screen.getByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
  });

  it('renders loading state initially', () => {
    render(<DashboardPage />, { wrapper: Wrapper });
    // DashboardPage and SalesAnalyticsPanel each render a LoadingSpinner (role=status)
    // while their respective API requests are pending, so there may be multiple.
    const spinners = screen.getAllByRole('status');
    expect(spinners.length).toBeGreaterThanOrEqual(1);
  });
});

describe('CheckoutPage', () => {
  it('renders the page heading', () => {
    render(<CheckoutPage />, { wrapper: Wrapper });
    expect(screen.getByRole('heading', { name: 'QR Checkout' })).toBeInTheDocument();
  });

  it('shows the payment security disclaimer', () => {
    render(<CheckoutPage />, { wrapper: Wrapper });
    expect(screen.getByText(/payment status is determined exclusively/i)).toBeInTheDocument();
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

  it('shows a loading state while a question is being answered', async () => {
    const user = userEvent.setup();
    let finishRequest!: (value: Awaited<ReturnType<typeof api.assistant.query>>) => void;
    const pending = new Promise<Awaited<ReturnType<typeof api.assistant.query>>>((resolve) => {
      finishRequest = resolve;
    });
    vi.mocked(api.assistant.query).mockReturnValueOnce(pending);

    render(<AssistantPage />, { wrapper: Wrapper });
    await user.type(screen.getByRole('textbox', { name: /ask about your store/i }), 'Revenue today?');
    await user.click(screen.getByRole('button', { name: /send message/i }));

    expect(screen.getByText('Sending…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send message/i })).toBeDisabled();

    finishRequest({ ok: false, code: 'NETWORK_ERROR', message: 'Network unavailable.' });
    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable.');
  });

  it('shows the server error and keeps the interaction recoverable', async () => {
    const user = userEvent.setup();
    vi.mocked(api.assistant.query).mockResolvedValueOnce({
      ok: false,
      code: 'AI_UNAVAILABLE',
      message: 'Please try again shortly.',
    });

    render(<AssistantPage />, { wrapper: Wrapper });
    await user.type(screen.getByRole('textbox', { name: /ask about your store/i }), 'Revenue today?');
    await user.click(screen.getByRole('button', { name: /send message/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Please try again shortly.');
    const input = screen.getByRole('textbox', { name: /ask about your store/i });
    await user.type(input, 'Try again');
    expect(screen.getByRole('button', { name: /send message/i })).toBeEnabled();
  });

  it('displays bold Markdown emphasis without visible asterisk markers', async () => {
    const user = userEvent.setup();
    const analytics = {
      currency: 'NGN',
      range: { start: '2026-03-01', end: '2026-03-01', preset: 'today', timezone: 'Africa/Lagos', days: 1 },
      comparison: {
        start: '2026-02-28', end: '2026-02-28', revenueCents: 0, completedOrderCount: 0,
        averageOrderValueCents: 0, revenueChangeCents: 0, revenueChangePercent: null,
        orderCountChange: 0, orderCountChangePercent: null,
      },
      revenueCents: 50000,
      completedOrderCount: 1,
      averageOrderValueCents: 50000,
      daily: [],
      topProducts: [],
      slowestProducts: [],
      limitations: [],
    } satisfies SalesAnalytics;
    vi.mocked(api.assistant.query).mockResolvedValueOnce({
      ok: true,
      data: {
        reply: '**Today\'s revenue** is **₦500.00**.',
        model: 'mock-model',
        analytics,
        aiGenerated: true,
      },
    });

    render(<AssistantPage />, { wrapper: Wrapper });
    await user.type(screen.getByRole('textbox', { name: /ask about your store/i }), 'Revenue today?');
    await user.click(screen.getByRole('button', { name: /send message/i }));

    const reply = await screen.findByRole('article', { name: 'Assistant reply' });
    expect(reply).toHaveTextContent("Today's revenue is ₦500.00.");
    expect(reply).not.toHaveTextContent('**');
  });

  it('clears the conversation and returns to the empty state', async () => {
    const user = userEvent.setup();
    vi.mocked(api.assistant.query).mockResolvedValueOnce({
      ok: false,
      code: 'AI_UNAVAILABLE',
      message: 'Assistant unavailable.',
    });

    render(<AssistantPage />, { wrapper: Wrapper });
    await user.type(screen.getByRole('textbox', { name: /ask about your store/i }), 'Revenue today?');
    await user.click(screen.getByRole('button', { name: /send message/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Assistant unavailable.');

    await user.click(screen.getByRole('button', { name: 'Clear conversation' }));

    expect(screen.queryByRole('log', { name: 'Conversation history' })).not.toBeInTheDocument();
    expect(screen.getByText(/ask me anything about your sales/i)).toBeInTheDocument();
  });

  it('renders suggested product and inventory questions in empty state', () => {
    render(<AssistantPage />, { wrapper: Wrapper });
    expect(screen.getByText('How many products are in stock?')).toBeInTheDocument();
    expect(screen.getByText('Show my low-stock products.')).toBeInTheDocument();
    expect(screen.getByText('Which products are out of stock?')).toBeInTheDocument();
    expect(screen.getByText('Summarize my inventory.')).toBeInTheDocument();
  });

  it('renders inventory metrics summary card when inventory data is returned', async () => {
    const user = userEvent.setup();
    const analytics = {
      currency: 'NGN',
      range: { start: '2026-03-01', end: '2026-03-01', preset: 'today', timezone: 'Africa/Lagos', days: 1 },
      comparison: {
        start: '2026-02-28', end: '2026-02-28', revenueCents: 0, completedOrderCount: 0,
        averageOrderValueCents: 0, revenueChangeCents: 0, revenueChangePercent: null,
        orderCountChange: 0, orderCountChangePercent: null,
      },
      revenueCents: 0,
      completedOrderCount: 0,
      averageOrderValueCents: 0,
      daily: [],
      topProducts: [],
      slowestProducts: [],
      limitations: [],
    } satisfies SalesAnalytics;

    const inventory = {
      totalProducts: 10,
      availableProductsCount: 7,
      lowStockProductsCount: 2,
      outOfStockProductsCount: 1,
      unavailableProductsCount: 3,
      inactiveProductsCount: 2,
      totalStockUnits: 85,
      statusBreakdown: { active: 8, draft: 1, archived: 1 },
      lowStockProducts: [],
      outOfStockProducts: [],
      unavailableProducts: [],
      inactiveProducts: [],
      lowestStockProducts: [],
      attentionNeededProducts: [],
    };

    vi.mocked(api.assistant.query).mockResolvedValueOnce({
      ok: true,
      data: {
        reply: 'You have 10 products in total, with 7 currently available.',
        model: 'mock-model',
        analytics,
        inventory,
        aiGenerated: true,
      },
    });

    render(<AssistantPage />, { wrapper: Wrapper });
    await user.type(screen.getByRole('textbox', { name: /ask about your store/i }), 'How many products?');
    await user.click(screen.getByRole('button', { name: /send message/i }));

    const reply = await screen.findByRole('article', { name: 'Assistant reply' });
    expect(reply).toHaveTextContent('You have 10 products in total');
    expect(screen.getByLabelText('Inventory metrics summary')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
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
