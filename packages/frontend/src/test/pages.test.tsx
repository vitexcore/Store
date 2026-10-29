/**
 * Frontend component smoke tests.
 *
 * These verify that key components render without crashing and contain
 * the expected accessible text and ARIA elements.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CartProvider } from '../lib/cart.js';
import { api } from '../lib/api.js';
import { DashboardPage } from '../pages/DashboardPage.tsx';
import { CheckoutPage } from '../pages/CheckoutPage.tsx';
import { AssistantPage } from '../pages/AssistantPage.tsx';
import { InventoryAlertsSection } from '../components/inventory/InventoryAlertsSection.tsx';
import { RestockRecommendationsSection } from '../components/inventory/RestockRecommendationsSection.tsx';
import { PaymentPage } from '../pages/PaymentPage.tsx';
import { CheckoutFormPage } from '../pages/CheckoutFormPage.tsx';
import { NotFoundPage } from '../pages/NotFoundPage.tsx';
import type { SalesAnalytics, InventoryAlerts, RestockRecommendations, PaymentStatusResponse } from '@store/shared';

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
    checkout: {
      createOrder: vi.fn().mockResolvedValue({ ok: false, code: 'NETWORK_ERROR', message: 'Could not reach the server. Please check your connection.' }),
      getPaymentStatus: vi.fn().mockResolvedValue({ ok: false, code: 'NETWORK_ERROR', message: 'No server in test' }),
      initializePaystack: vi.fn().mockResolvedValue({ ok: false, code: 'PAYMENT_PROVIDER_NOT_CONFIGURED', message: 'Paystack test credentials are not configured.' }),
    },
    inventory: {
      alerts: vi.fn().mockResolvedValue({ ok: true, data: { alerts: [], counts: { outOfStock: 0, lowStock: 0, inactive: 0, total: 0, critical: 0 } } as InventoryAlerts }),
      restockRecommendations: vi.fn().mockResolvedValue({ ok: true, data: { recommendations: [], dataCoverageNote: '' } as RestockRecommendations }),
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

describe('CheckoutFormPage order retry', () => {
  const cart = {
    storeSlug: 'test-store',
    items: [{
      productId: '123e4567-e89b-42d3-a456-426614174000',
      quantity: 1,
      name: 'Test Widget',
      priceCents: 250000,
      currency: 'NGN',
      imageUrl: null,
      maxStock: 10,
    }],
  };

  const renderCheckout = () => {
    sessionStorage.setItem('store_cart_v1', JSON.stringify(cart));
    return render(
      <CartProvider>
        <MemoryRouter initialEntries={['/store/test-store/checkout']}>
          <Routes>
            <Route path="/store/:storeSlug/checkout" element={<CheckoutFormPage />} />
          </Routes>
        </MemoryRouter>
      </CartProvider>,
    );
  };

  it('reuses the same idempotency key after an ambiguous checkout failure', async () => {
    const user = userEvent.setup();
    vi.mocked(api.checkout.createOrder).mockReset().mockResolvedValue({
      ok: false,
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server. Please check your connection.',
    });

    renderCheckout();
    const submit = await screen.findByRole('button', { name: /place order/i });
    await user.click(submit);
    await screen.findByRole('alert');
    await user.click(submit);

    expect(api.checkout.createOrder).toHaveBeenCalledTimes(2);
    const firstRequest = vi.mocked(api.checkout.createOrder).mock.calls[0]![0];
    const retryRequest = vi.mocked(api.checkout.createOrder).mock.calls[1]![0];
    expect(retryRequest.idempotencyKey).toBe(firstRequest.idempotencyKey);
  });
});

describe('PaymentPage', () => {
  const paymentStatus: PaymentStatusResponse = {
    paymentToken: 'a'.repeat(96),
    status: 'awaiting_payment',
    amountCents: 300000,
    currency: 'NGN',
    orderReference: 'ORD-TEST01',
    storeName: 'Test Store',
    expiresAt: null,
    paidAt: null,
    paystackAuthorizationUrl: null,
  };

  const renderPaymentPage = () => render(
    <MemoryRouter initialEntries={[`/payment/${paymentStatus.paymentToken}`]}>
      <Routes>
        <Route path="/payment/:token" element={<PaymentPage />} />
      </Routes>
    </MemoryRouter>,
  );

  it('initializes Paystack only after buyer action and then shows the provider link', async () => {
    const user = userEvent.setup();
    vi.mocked(api.checkout.getPaymentStatus).mockResolvedValueOnce({ ok: true, data: paymentStatus });
    vi.mocked(api.checkout.initializePaystack).mockResolvedValueOnce({
      ok: true,
      data: { authorizationUrl: 'https://checkout.paystack.com/test', reference: 'store-test-reference' },
    });

    renderPaymentPage();
    const prepareButton = await screen.findByRole('button', { name: /prepare paystack test checkout/i });
    expect(api.checkout.initializePaystack).not.toHaveBeenCalled();

    await user.click(prepareButton);

    expect(api.checkout.initializePaystack).toHaveBeenCalledWith(paymentStatus.paymentToken);
    expect(await screen.findByRole('link', { name: /pay with paystack/i })).toHaveAttribute(
      'href',
      'https://checkout.paystack.com/test',
    );
  });

  it('shows a recoverable message when Paystack is not configured', async () => {
    const user = userEvent.setup();
    vi.mocked(api.checkout.getPaymentStatus).mockResolvedValueOnce({ ok: true, data: paymentStatus });
    vi.mocked(api.checkout.initializePaystack).mockResolvedValueOnce({
      ok: false,
      code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
      message: 'Paystack test credentials are not configured.',
    });

    renderPaymentPage();
    await user.click(await screen.findByRole('button', { name: /prepare paystack test checkout/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/paystack test credentials are not configured/i);
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

describe('InventoryAlertsSection', () => {
  it('renders empty state when no alerts exist', async () => {
    render(<InventoryAlertsSection />, { wrapper: Wrapper });
    expect(screen.getByRole('heading', { name: /inventory alerts/i })).toBeInTheDocument();
    await expect(screen.findByText('No inventory alerts')).resolves.toBeInTheDocument();
  });

  it('renders alert table and severity badges when alerts exist', async () => {
    vi.mocked(api.inventory.alerts).mockResolvedValueOnce({
      ok: true,
      data: {
        alerts: [
          {
            id: 'p1:out_of_stock',
            productId: 'p1',
            name: 'Widget',
            stockQuantity: 0,
            lowStockThreshold: 5,
            status: 'active',
            type: 'out_of_stock',
            reason: 'No units left in stock — product cannot be purchased.',
            severity: 'critical',
            lastUpdated: '2026-01-01T00:00:00Z',
            unavailable: true,
          },
          {
            id: 'p2:low_stock',
            productId: 'p2',
            name: 'Gadget',
            stockQuantity: 2,
            lowStockThreshold: 5,
            status: 'active',
            type: 'low_stock',
            reason: '2 unit(s) left — at or below the low-stock threshold of 5.',
            severity: 'warning',
            lastUpdated: '2026-01-02T00:00:00Z',
            unavailable: false,
          },
        ],
        counts: { outOfStock: 1, lowStock: 1, inactive: 0, total: 2, critical: 1 },
      } as InventoryAlerts,
    });

    render(<InventoryAlertsSection />, { wrapper: Wrapper });
    await expect(screen.findByText('Widget')).resolves.toBeInTheDocument();
    await expect(screen.findByText('Gadget')).resolves.toBeInTheDocument();
    // Summary chip + severity badge both render the type label, so count all matches.
    expect(await screen.findAllByText('Out of stock')).toHaveLength(2);
    expect(await screen.findAllByText('Low stock')).toHaveLength(2);
    expect(await screen.findAllByText('Critical')).toHaveLength(2);
    expect(await screen.findAllByText('Warning')).toHaveLength(1);
  });
});

describe('RestockRecommendationsSection', () => {
  it('renders empty state when no recommendations exist', async () => {
    render(<RestockRecommendationsSection />, { wrapper: Wrapper });
    expect(screen.getByRole('heading', { name: /restock recommendations/i })).toBeInTheDocument();
    await expect(screen.findByText('No restocking needed')).resolves.toBeInTheDocument();
  });

  it('renders recommendation table with estimated quantities', async () => {
    vi.mocked(api.inventory.restockRecommendations).mockResolvedValueOnce({
      ok: true,
      data: {
        recommendations: [
          {
            productId: 'p1',
            name: 'Widget',
            currentStock: 0,
            lowStockThreshold: 5,
            unitsSoldRecent: 10,
            dailyVelocity: 0.3333,
            daysOfStock: 0,
            reason: 'out_of_stock',
            suggestedQuantity: 7,
            dataReliable: true,
          },
        ],
        dataCoverageNote: 'Based on 10 unit(s) sold in the last 30 days.',
      } as RestockRecommendations,
    });

    render(<RestockRecommendationsSection />, { wrapper: Wrapper });
    await expect(screen.findByText('Widget')).resolves.toBeInTheDocument();
    await expect(screen.findByText('Out of stock')).resolves.toBeInTheDocument();
    await expect(screen.findByText('7')).resolves.toBeInTheDocument();
    await expect(screen.findByText('est.')).resolves.toBeInTheDocument();
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
