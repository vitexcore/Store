/**
 * Checkout routes — customer-facing order creation and payment management.
 *
 * Route map:
 *  POST /api/checkout/cart                — public buyer order creation (CSRF + IP rate limit)
 *  POST /api/checkout/paystack/initialize — public buyer payment init (opaque token + CSRF + rate limit)
 *  GET  /api/checkout/status/:token       — get payment status by token (public, no auth)
 *  GET  /api/checkout/paystack/callback   — redirect from Paystack (does NOT mark paid)
 *
 *  GET  /api/storefront/:storeSlug        — get store info (public)
 *  GET  /api/storefront/:storeSlug/products — browse active products (public)
 *
 *  POST /api/webhooks/paystack            — Paystack webhook (raw body required)
 *
 * Security:
 *  - Checkout endpoints are rate limited.
 *  - Payment status is read-only and keyed by opaque token.
 *  - Webhook signature is verified before any DB write.
 *  - Paystack secret key is never returned to frontend or logged.
 *  - Browser redirect from Paystack does NOT mark payment as successful.
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { ApiSuccess, ApiError, CheckoutResponse, PaymentStatusResponse } from '@store/shared';
import { query } from '../db/pool.js';
import { createOrderFromCart, getStoreBySlug, CheckoutError } from '../services/orderService.js';
import {
  initializePaystackPayment,
  verifyPaystackWebhookSignature,
  processPaystackWebhook,
  isPaystackConfigured,
  type PaystackWebhookEvent,
} from '../services/paystackService.js';
import { isValidAmountKobos } from '../utils/currency.js';
import { config } from '../config.js';

export const checkoutRouter: Router = Router();
export const storefrontRouter: Router = Router();
export const webhookRouter: Router = Router();

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

const checkoutRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  skip: () => config.env === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, code: 'RATE_LIMITED', message: 'Too many checkout requests. Please wait and try again.' },
});

const statusRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120,
  skip: () => config.env === 'test',
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, code: 'RATE_LIMITED', message: 'Too many status requests. Please wait and try again.' },
});

// ---------------------------------------------------------------------------
// Checkout: POST /api/checkout/cart
// Public buyer checkout; CSRF and per-IP rate limits are enforced globally/here.
// ---------------------------------------------------------------------------
checkoutRouter.post(
  '/cart',
  checkoutRateLimit,
  async (req: Request, res: Response) => {
    const { idempotencyKey, storeSlug, items, customerName, customerEmail } =
      (req.body ?? {}) as Record<string, unknown>;

    if (typeof storeSlug !== 'string' || storeSlug.trim().length < 1 || storeSlug.length > 120) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'A valid storeSlug is required.' };
      return res.status(400).json(body);
    }

    // Buyer checkout is public. Resolve the target tenant from the public slug,
    // then keep all product, price, and order reads scoped to that store.
    try {
      const store = await getStoreBySlug(storeSlug);
      if (!store) {
        const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Store not found.' };
        return res.status(404).json(body);
      }

      const result = await createOrderFromCart(store.id, storeSlug, {
        idempotencyKey: idempotencyKey as string,
        storeSlug,
        items: items as Array<{ productId: string; quantity: number }>,
        ...(customerName !== undefined ? { customerName: customerName as string } : {}),
        ...(customerEmail !== undefined ? { customerEmail: customerEmail as string } : {}),
      });

      const body: ApiSuccess<CheckoutResponse> = { ok: true, data: result };
      return res.status(201).json(body);
    } catch (err) {
      if (err instanceof CheckoutError) {
        const body: ApiError = { ok: false, code: err.code, message: err.message };
        return res.status(err.statusCode).json(body);
      }
      console.error('[checkout] cart error:', err instanceof Error ? err.message : String(err));
      const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to create order.' };
      return res.status(500).json(body);
    }
  },
);

// ---------------------------------------------------------------------------
// Checkout: POST /api/checkout/paystack/initialize
// Public buyer request, protected by CSRF, an opaque payment token, and rate limiting.
// ---------------------------------------------------------------------------
checkoutRouter.post(
  '/paystack/initialize',
  checkoutRateLimit,
  async (req: Request, res: Response) => {
    const { paymentToken } = (req.body ?? {}) as Record<string, unknown>;

    if (typeof paymentToken !== 'string' || !/^[0-9a-f]{96}$/i.test(paymentToken)) {
      const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'A valid paymentToken is required.' };
      return res.status(400).json(body);
    }

    try {
      // Look up the transaction — verify it belongs to this store
      const txnResult = await query<{
        id: string;
        order_id: string;
        order_status: string;
        status: string;
        amount_cents: number;
        currency: string;
        expires_at: string | null;
        paystack_reference: string | null;
        paystack_authorization_url: string | null;
      }>(
        `SELECT t.id, t.order_id, o.status AS order_status, t.status,
                t.amount_cents, t.currency, t.expires_at,
                t.paystack_reference, t.paystack_authorization_url
         FROM transactions t
         JOIN orders o ON o.id = t.order_id
         WHERE t.payment_token = $1`,
        [paymentToken],
      );

      if (txnResult.rows.length === 0) {
        const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Payment request not found.' };
        return res.status(404).json(body);
      }

      const txn = txnResult.rows[0]!;

      if (txn.status === 'paid') {
        const body: ApiError = { ok: false, code: 'ALREADY_PAID', message: 'This order has already been paid.' };
        return res.status(409).json(body);
      }

      if (txn.status === 'expired' || txn.status === 'cancelled') {
        const body: ApiError = { ok: false, code: 'PAYMENT_EXPIRED', message: 'This payment request has expired or been cancelled.' };
        return res.status(410).json(body);
      }

      if (txn.status !== 'awaiting_payment' || txn.order_status !== 'pending') {
        const body: ApiError = { ok: false, code: 'PAYMENT_NOT_PAYABLE', message: 'This order is not available for payment.' };
        return res.status(409).json(body);
      }

      // Check expiry
      if (txn.expires_at && new Date(txn.expires_at) < new Date()) {
        await query("UPDATE transactions SET status = 'expired', updated_at = NOW() WHERE id = $1", [txn.id]);
        const body: ApiError = { ok: false, code: 'PAYMENT_EXPIRED', message: 'This payment request has expired.' };
        return res.status(410).json(body);
      }

      // If already initialized, return existing auth URL
      if (txn.paystack_authorization_url && txn.paystack_reference) {
        const body: ApiSuccess<{ authorizationUrl: string; reference: string }> = {
          ok: true,
          data: { authorizationUrl: txn.paystack_authorization_url, reference: txn.paystack_reference },
        };
        return res.status(200).json(body);
      }

      if (!isPaystackConfigured()) {
        const body: ApiError = {
          ok: false,
          code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
          message: 'Paystack test credentials are not configured.',
        };
        return res.status(503).json(body);
      }

      if (!isValidAmountKobos(txn.amount_cents)) {
        const body: ApiError = { ok: false, code: 'INVALID_AMOUNT', message: 'Invalid payment amount.' };
        return res.status(422).json(body);
      }

      // Get customer email for Paystack (required)
      const orderResult = await query<{ customer_email: string | null }>(
        'SELECT customer_email FROM orders WHERE id = $1',
        [txn.order_id],
      );
      const customerEmail = orderResult.rows[0]?.customer_email ?? 'noreply@store-demo.example.com';

      const paystackResult = await initializePaystackPayment(
        paymentToken,
        txn.amount_cents,
        txn.currency,
        customerEmail,
        config.paystackCallbackUrl,
      );

      // Store Paystack reference and auth URL (no secrets stored)
      await query(
        `UPDATE transactions
         SET paystack_reference = $1, paystack_authorization_url = $2,
             status = 'awaiting_payment', updated_at = NOW()
         WHERE id = $3`,
        [paystackResult.reference, paystackResult.authorizationUrl, txn.id],
      );

      const body: ApiSuccess<{ authorizationUrl: string; reference: string }> = {
        ok: true,
        data: { authorizationUrl: paystackResult.authorizationUrl, reference: paystackResult.reference },
      };
      return res.status(200).json(body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[checkout] paystack initialize error:', msg);
      // Never include provider error details that might contain sensitive info
      const body: ApiError = { ok: false, code: 'PAYMENT_PROVIDER_ERROR', message: 'Could not initialize payment. Please try again.' };
      return res.status(502).json(body);
    }
  },
);

// ---------------------------------------------------------------------------
// Payment status: GET /api/checkout/status/:token
// Public — no authentication required; token is opaque
// ---------------------------------------------------------------------------
checkoutRouter.get('/status/:token', statusRateLimit, async (req: Request, res: Response) => {
  const { token } = req.params;

  if (typeof token !== 'string' || token.length < 16 || token.length > 200) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Invalid payment token.' };
    return res.status(400).json(body);
  }

  try {
    const result = await query<{
      payment_token: string;
      status: string;
      amount_cents: number;
      currency: string;
      expires_at: string | null;
      paid_at: string | null;
      paystack_authorization_url: string | null;
      order_reference: string;
      store_name: string;
    }>(
      `SELECT t.payment_token, t.status, t.amount_cents, t.currency,
              t.expires_at, t.paid_at, t.paystack_authorization_url,
              o.reference AS order_reference,
              s.name AS store_name
       FROM transactions t
       JOIN orders o ON o.id = t.order_id
       JOIN stores s ON s.id = t.store_id
       WHERE t.payment_token = $1`,
      [token],
    );

    if (result.rows.length === 0) {
      const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Payment request not found.' };
      return res.status(404).json(body);
    }

    const row = result.rows[0]!;

    // Auto-expire if past expiry date and not yet terminal
    if (
      row.status === 'awaiting_payment' &&
      row.expires_at &&
      new Date(row.expires_at) < new Date()
    ) {
      await query("UPDATE transactions SET status = 'expired', updated_at = NOW() WHERE payment_token = $1", [token]);
      row.status = 'expired';
    }

    const data: PaymentStatusResponse = {
      paymentToken: row.payment_token,
      status: row.status as PaymentStatusResponse['status'],
      amountCents: row.amount_cents,
      currency: row.currency,
      orderReference: row.order_reference,
      storeName: row.store_name,
      expiresAt: row.expires_at,
      paidAt: row.paid_at,
      paystackAuthorizationUrl: row.paystack_authorization_url,
    };

    const body: ApiSuccess<PaymentStatusResponse> = { ok: true, data };
    return res.status(200).json(body);
  } catch (err) {
    console.error('[checkout] status error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to retrieve payment status.' };
    return res.status(500).json(body);
  }
});

// ---------------------------------------------------------------------------
// Paystack callback redirect: GET /api/checkout/paystack/callback
// This is where Paystack redirects the browser after payment attempt.
// Does NOT mark payment as paid — only the webhook does that.
// ---------------------------------------------------------------------------
checkoutRouter.get('/paystack/callback', (req: Request, res: Response) => {
  const { reference, trxref } = req.query;
  const ref = reference ?? trxref;

  // Redirect to the payment status page in the frontend.
  // The frontend will poll the status endpoint to get authoritative status.
  // We do NOT trust this redirect as proof of payment.
  if (ref && typeof ref === 'string') {
    // Look up the payment token for this Paystack reference
    query<{ payment_token: string }>(
      'SELECT payment_token FROM transactions WHERE paystack_reference = $1',
      [ref],
    )
      .then((result) => {
        if (result.rows[0]) {
          const frontendUrl = config.corsOrigin.split(',')[0]!.trim();
          return res.redirect(302, `${frontendUrl}/payment/${result.rows[0].payment_token}`);
        }
        const frontendUrl = config.corsOrigin.split(',')[0]!.trim();
        return res.redirect(302, `${frontendUrl}/`);
      })
      .catch(() => {
        const frontendUrl = config.corsOrigin.split(',')[0]!.trim();
        return res.redirect(302, `${frontendUrl}/`);
      });
  } else {
    const frontendUrl = config.corsOrigin.split(',')[0]!.trim();
    return res.redirect(302, `${frontendUrl}/`);
  }
});

// ---------------------------------------------------------------------------
// Storefront: GET /api/storefront/:storeSlug
// Public — returns store info
// ---------------------------------------------------------------------------
storefrontRouter.get('/:storeSlug', async (req: Request, res: Response) => {
  const { storeSlug } = req.params;

  if (typeof storeSlug !== 'string' || storeSlug.length < 1 || storeSlug.length > 120) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Invalid store slug.' };
    return res.status(400).json(body);
  }

  try {
    const store = await getStoreBySlug(storeSlug);
    if (!store) {
      const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Store not found.' };
      return res.status(404).json(body);
    }

    // Return only public fields — do not expose internal DB ID
    const publicStore = {
      name: store.name,
      slug: store.slug,
      description: store.description,
      defaultCurrency: store.defaultCurrency,
    };

    const body: ApiSuccess<typeof publicStore> = { ok: true, data: publicStore };
    return res.status(200).json(body);
  } catch (err) {
    console.error('[storefront] get error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to load store.' };
    return res.status(500).json(body);
  }
});

// ---------------------------------------------------------------------------
// Storefront: GET /api/storefront/:storeSlug/products
// Public — lists active products only, paginated
// ---------------------------------------------------------------------------
storefrontRouter.get('/:storeSlug/products', async (req: Request, res: Response) => {
  const { storeSlug } = req.params;

  if (typeof storeSlug !== 'string' || storeSlug.length < 1 || storeSlug.length > 120) {
    const body: ApiError = { ok: false, code: 'VALIDATION_ERROR', message: 'Invalid store slug.' };
    return res.status(400).json(body);
  }

  const pageRaw = parseInt(String(req.query['page'] ?? '1'), 10);
  const pageSizeRaw = parseInt(String(req.query['pageSize'] ?? '20'), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw >= 1 ? Math.min(pageSizeRaw, 50) : 20;
  const offset = (page - 1) * pageSize;

  try {
    const store = await getStoreBySlug(storeSlug);
    if (!store) {
      const body: ApiError = { ok: false, code: 'NOT_FOUND', message: 'Store not found.' };
      return res.status(404).json(body);
    }

    const countResult = await query<{ total: string }>(
      "SELECT COUNT(*) AS total FROM products WHERE store_id = $1 AND status = 'active'",
      [store.id],
    );
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    const productsResult = await query<{
      id: string; name: string; description: string;
      price_cents: number; currency: string; image_url: string | null; stock_quantity: number;
    }>(
      `SELECT id, name, description, price_cents, currency, image_url, stock_quantity
       FROM products
       WHERE store_id = $1 AND status = 'active'
       ORDER BY name ASC
       LIMIT $2 OFFSET $3`,
      [store.id, pageSize, offset],
    );

    const products = productsResult.rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      priceCents: p.price_cents,
      currency: p.currency,
      imageUrl: p.image_url,
      stockQuantity: p.stock_quantity,
      available: p.stock_quantity > 0,
    }));

    const body: ApiSuccess<{
      store: typeof store;
      products: typeof products;
      meta: { page: number; pageSize: number; total: number; totalPages: number };
    }> = {
      ok: true,
      data: {
        store,
        products,
        meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      },
    };
    return res.status(200).json(body);
  } catch (err) {
    console.error('[storefront] products error:', err instanceof Error ? err.message : String(err));
    const body: ApiError = { ok: false, code: 'INTERNAL_ERROR', message: 'Failed to load products.' };
    return res.status(500).json(body);
  }
});

// ---------------------------------------------------------------------------
// Webhook: POST /api/webhooks/paystack
// Raw body must be available for HMAC verification.
// This endpoint does NOT use CSRF protection (external provider).
// ---------------------------------------------------------------------------
webhookRouter.post('/paystack', async (req: Request, res: Response) => {
  const signature = req.headers['x-paystack-signature'];

  if (typeof signature !== 'string' || signature.length === 0) {
    // Always return 200 to Paystack to prevent retry storms, but don't process
    console.warn('[webhook] missing Paystack signature header');
    return res.status(200).json({ ok: true });
  }

  // req.body should be the raw Buffer (app.ts must use express.raw for this route)
  const rawBody: Buffer = req.body;

  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    console.warn('[webhook] empty or non-buffer body');
    return res.status(200).json({ ok: true });
  }

  // Verify signature
  const isValid = verifyPaystackWebhookSignature(rawBody, signature);
  if (!isValid) {
    console.warn('[webhook] invalid Paystack signature — request rejected');
    return res.status(200).json({ ok: true }); // Return 200 to prevent Paystack retrying
  }

  let event: PaystackWebhookEvent;
  try {
    event = JSON.parse(rawBody.toString('utf8')) as PaystackWebhookEvent;
  } catch {
    console.warn('[webhook] could not parse webhook body');
    return res.status(200).json({ ok: true });
  }

  try {
    await processPaystackWebhook(event);
    // Processing is a short, bounded database transaction. Acknowledge only
    // after commit so transient database failures can be retried by Paystack.
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[webhook] processing error:', err instanceof Error ? err.message : String(err));
    return res.status(500).json({ ok: false });
  }
});
