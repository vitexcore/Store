/**
 * Paystack service — server-side integration with Paystack payment API.
 *
 * Security requirements enforced here:
 *  - Secret key is NEVER returned to frontend, never logged, never included in responses.
 *  - Payment initialization uses server-validated amounts and references.
 *  - Webhook signature is verified using HMAC-SHA512 before any processing.
 *  - Browser redirects are NOT treated as proof of payment.
 *  - Duplicate webhook events are handled idempotently.
 *
 * Merchant settlement model:
 *  - Single configured Paystack account (PAYSTACK_SECRET_KEY env var).
 *  - Subaccounts are NOT configured in this implementation.
 *  - All settlements go to the single configured account.
 *  - Multi-merchant settlement requires Paystack subaccounts (future work).
 *
 * Test mode:
 *  - Use PAYSTACK_SECRET_KEY=sk_test_... to use Paystack test mode.
 *  - Live transactions are NOT enabled in this implementation.
 *  - Test cards: https://paystack.com/docs/payments/test-payments/
 */

import crypto from 'node:crypto';
import { query, getClient } from '../db/pool.js';
import { config } from '../config.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PaystackInitializeResult {
  authorizationUrl: string;
  reference: string;
  accessCode: string;
}

export interface PaystackVerifyResult {
  status: 'success' | 'failed' | 'abandoned' | 'pending';
  reference: string;
  amountKobos: number;
  currency: string;
  paidAt: string | null;
  gatewayResponse: string;
}

export interface PaystackWebhookEvent {
  event: string;
  data: {
    reference: string;
    status: string;
    amount: number;
    currency: string;
    paid_at: string | null;
    id: number;
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PAYSTACK_BASE_URL = 'https://api.paystack.co';
const REQUEST_TIMEOUT_MS = 15_000;

function getSecretKey(): string | null {
  return config.paystackSecretKey ?? null;
}

export function isPaystackTestKey(key: string | null): boolean {
  if (typeof key !== 'string' || !key.startsWith('sk_test_') || key.length <= 10) return false;
  return !/(?:change[_-]?me|placeholder|your[_-]?key)/i.test(key.slice('sk_test_'.length));
}

function isConfigured(): boolean {
  return isPaystackTestKey(getSecretKey());
}

// ---------------------------------------------------------------------------
// HTTP helper — never exposes secret key in errors or logs
// ---------------------------------------------------------------------------

async function paystackRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: Record<string, unknown>,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const secretKey = getSecretKey();
  if (!isPaystackTestKey(secretKey)) {
    return { ok: false, error: 'Paystack test credentials are not configured.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`, // secret key used here only, never forwarded
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const json = (await response.json()) as { status: boolean; message: string; data: T };

    if (!response.ok || !json.status) {
      // Paystack error messages are safe to log internally (no secrets)
      console.error('[paystack] request failed:', path, json.message);
      return { ok: false, error: json.message ?? `HTTP ${response.status}` };
    }

    return { ok: true, data: json.data };
  } catch (err) {
    clearTimeout(timeout);
    const msg = err instanceof Error ? err.message : 'Unknown error';
    if (msg.includes('abort') || msg.includes('AbortError')) {
      console.error('[paystack] request timed out:', path);
      return { ok: false, error: 'Payment provider request timed out. Please try again.' };
    }
    console.error('[paystack] request error:', path, msg);
    return { ok: false, error: 'Could not reach payment provider. Please try again.' };
  }
}

// ---------------------------------------------------------------------------
// Initialize a Paystack transaction
// ---------------------------------------------------------------------------

/**
 * Initialize a Paystack payment session.
 *
 * @param paymentToken - our internal opaque token (used to retrieve state)
 * @param amountKobos  - server-validated amount in minor units (kobo)
 * @param currency     - must match the payment request currency
 * @param customerEmail - required by Paystack; must be present
 * @param callbackUrl  - validated redirect URL from environment config
 */
export async function initializePaystackPayment(
  paymentToken: string,
  amountKobos: number,
  currency: string,
  customerEmail: string,
  callbackUrl: string,
): Promise<PaystackInitializeResult> {
  if (!isConfigured()) {
    throw new Error('Paystack is not configured. Set PAYSTACK_SECRET_KEY in environment.');
  }

  // Use our internal payment token as the Paystack reference.
  // This allows us to look up the transaction when the webhook arrives.
  // The reference must be unique per initialization attempt.
  const paystackReference = `store_${paymentToken.substring(0, 32)}`;

  const result = await paystackRequest<{
    authorization_url: string;
    reference: string;
    access_code: string;
  }>('POST', '/transaction/initialize', {
    amount: amountKobos,
    currency: currency.toUpperCase(),
    email: customerEmail,
    reference: paystackReference,
    callback_url: callbackUrl,
    metadata: {
      // Safe metadata — no secrets
      payment_token: paymentToken,
      custom_fields: [
        { display_name: 'Payment Token', variable_name: 'payment_token', value: paymentToken },
      ],
    },
  });

  if (!result.ok) {
    throw new Error(result.error);
  }

  return {
    authorizationUrl: result.data.authorization_url,
    reference: result.data.reference,
    accessCode: result.data.access_code,
  };
}

// ---------------------------------------------------------------------------
// Verify a Paystack transaction (server-side only)
// ---------------------------------------------------------------------------

export async function verifyPaystackPayment(
  paystackReference: string,
): Promise<PaystackVerifyResult> {
  const result = await paystackRequest<{
    status: string;
    reference: string;
    amount: number;
    currency: string;
    paid_at: string | null;
    gateway_response: string;
  }>('GET', `/transaction/verify/${encodeURIComponent(paystackReference)}`);

  if (!result.ok) {
    throw new Error(result.error);
  }

  const status = result.data.status;
  let mappedStatus: PaystackVerifyResult['status'];

  if (status === 'success') mappedStatus = 'success';
  else if (status === 'failed') mappedStatus = 'failed';
  else if (status === 'abandoned') mappedStatus = 'abandoned';
  else mappedStatus = 'pending';

  return {
    status: mappedStatus,
    reference: result.data.reference,
    amountKobos: result.data.amount,
    currency: result.data.currency,
    paidAt: result.data.paid_at,
    gatewayResponse: result.data.gateway_response,
  };
}

// ---------------------------------------------------------------------------
// Webhook signature verification
// ---------------------------------------------------------------------------

/**
 * Verify a Paystack webhook signature using HMAC-SHA512.
 *
 * Paystack signs the raw request body with the secret key.
 * We must use the RAW body bytes (not parsed JSON) to compute the HMAC.
 *
 * @param rawBody     - raw request body as Buffer
 * @param signature   - value of x-paystack-signature header
 * @returns true if valid, false otherwise
 */
export function verifyPaystackWebhookSignature(rawBody: Buffer, signature: string): boolean {
  const secretKey = getSecretKey();
  if (typeof secretKey !== 'string' || !isPaystackTestKey(secretKey)) return false;

  try {
    const expected = crypto
      .createHmac('sha512', secretKey)
      .update(rawBody)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Process a verified webhook event (idempotent)
// ---------------------------------------------------------------------------

/**
 * Process a verified Paystack webhook charge.success event.
 *
 * Idempotency: if the transaction is already paid, this is a no-op.
 * All database changes run in a single transaction.
 *
 * Stock decrement policy:
 *  - Stock is decremented HERE (on confirmed payment), not on order creation.
 *  - If stock has dropped below the ordered quantity, we record payment success
 *    but log a stock inconsistency warning. The order is still marked paid.
 *    This is the trade-off of not using stock reservation (Day 5 limitation).
 */
export async function processPaystackWebhook(event: PaystackWebhookEvent): Promise<void> {
  if (event.event !== 'charge.success') {
    // Only process charge.success; ignore other events
    return;
  }

  const { reference: paystackReference, amount, currency } = event.data;

  if (!paystackReference || !amount || !currency) {
    console.error('[webhook] charge.success missing required fields', { paystackReference, amount, currency });
    return;
  }

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // Find the transaction using the Paystack reference
    const txnResult = await client.query<{
      id: string;
      order_id: string;
      store_id: string;
      status: string;
      amount_cents: number;
      currency: string;
      payment_token: string;
      expires_at: string | null;
    }>(
      `SELECT id, order_id, store_id, status, amount_cents, currency, payment_token, expires_at
       FROM transactions
       WHERE paystack_reference = $1
       FOR UPDATE`,
      [paystackReference],
    );

    if (txnResult.rows.length === 0) {
      console.error('[webhook] no transaction found for Paystack reference:', paystackReference);
      await client.query('ROLLBACK');
      return;
    }

    const txn = txnResult.rows[0]!;

    // Idempotency: already processed
    if (txn.status === 'paid') {
      console.info('[webhook] duplicate event for already-paid transaction:', txn.id);
      await client.query('ROLLBACK');
      return;
    }

    // Validate amount matches exactly (prevent amount-tampering attacks)
    if (txn.amount_cents !== amount) {
      console.error('[webhook] amount mismatch for transaction:', txn.id, {
        expected: txn.amount_cents,
        received: amount,
      });
      await client.query('UPDATE transactions SET status = $1, updated_at = NOW() WHERE id = $2', ['failed', txn.id]);
      await client.query('COMMIT');
      return;
    }

    // Validate currency matches
    if (txn.currency.toUpperCase() !== currency.toUpperCase()) {
      console.error('[webhook] currency mismatch for transaction:', txn.id, {
        expected: txn.currency,
        received: currency,
      });
      await client.query('UPDATE transactions SET status = $1, updated_at = NOW() WHERE id = $2', ['failed', txn.id]);
      await client.query('COMMIT');
      return;
    }

    const paidAt = event.data.paid_at ?? new Date().toISOString();

    // Mark transaction as paid
    await client.query(
      `UPDATE transactions
       SET status = 'paid', paid_at = $1, updated_at = NOW()
       WHERE id = $2`,
      [paidAt, txn.id],
    );

    // Mark order as confirmed
    await client.query(
      `UPDATE orders
       SET status = 'confirmed', updated_at = NOW()
       WHERE id = $1`,
      [txn.order_id],
    );

    // Decrement stock for each order item
    const orderItems = await client.query<{
      product_id: string; quantity: number;
    }>(
      'SELECT product_id, quantity FROM order_items WHERE order_id = $1',
      [txn.order_id],
    );

    for (const item of orderItems.rows) {
      if (!item.product_id) continue; // product was deleted; skip stock decrement

      const stockResult = await client.query<{ stock_quantity: number }>(
        'SELECT stock_quantity FROM products WHERE id = $1 FOR UPDATE',
        [item.product_id],
      );

      if (stockResult.rows.length === 0) continue;

      const currentStock = stockResult.rows[0]!.stock_quantity;
      const newStock = currentStock - item.quantity;

      if (newStock < 0) {
        // Stock inconsistency — payment confirmed but stock insufficient.
        // This can happen due to the no-reservation policy (Day 5 limitation).
        // Log for manual reconciliation; set stock to 0 rather than going negative.
        console.warn('[webhook] stock inconsistency for product:', item.product_id, {
          currentStock,
          orderedQuantity: item.quantity,
        });
        await client.query(
          'UPDATE products SET stock_quantity = 0, updated_at = NOW() WHERE id = $1',
          [item.product_id],
        );
      } else {
        await client.query(
          'UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2',
          [newStock, item.product_id],
        );
      }
    }

    await client.query('COMMIT');

    console.info('[webhook] payment confirmed for transaction:', txn.id, 'order:', txn.order_id);
  } catch (err) {
    await client.query('ROLLBACK');
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[webhook] processing error:', msg);
    throw err;
  } finally {
    client.release();
  }
}

export { isConfigured as isPaystackConfigured };
