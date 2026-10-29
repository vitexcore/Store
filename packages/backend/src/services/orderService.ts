/**
 * Order service — creates orders with server-calculated totals.
 *
 * Security guarantees:
 *  - Prices are ALWAYS read from the database; never from client input.
 *  - Products must belong to the target store and be active.
 *  - Totals are calculated on the server and stored at order creation time.
 *  - Order reference and payment token are generated server-side using crypto.randomBytes.
 *  - The entire order creation (order + items + transaction) runs in a single DB transaction.
 *  - Idempotency key prevents duplicate orders from retried requests.
 *  - Stock is NOT decremented on order creation — only on confirmed payment (webhook).
 *    This is documented as a known limitation; a stock-reservation system will be added later.
 *
 * Known limitations (Day 5):
 *  - No stock reservation: concurrent orders for the last item can both succeed.
 *    The webhook handler will check stock before decrementing.
 */

import crypto from 'node:crypto';
import { getClient } from '../db/pool.js';
import { PAYMENT_EXPIRY_MINUTES } from '@store/shared';
import type { CheckoutRequest, CheckoutResponse } from '@store/shared';

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

interface ProductRow {
  id: string;
  store_id: string;
  name: string;
  price_cents: number;
  currency: string;
  status: string;
  stock_quantity: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class CheckoutError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a URL-safe random token (48 hex bytes = 96 char hex string). */
function generateSecureToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

/** Generate a human-readable order reference: ORD- + 12 uppercase alphanumeric chars. */
function generateOrderReference(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.randomBytes(12);
  let ref = 'ORD-';
  for (const byte of bytes) {
    ref += chars[byte % chars.length];
  }
  return ref;
}

// ---------------------------------------------------------------------------
// Validate cart items input
// ---------------------------------------------------------------------------
function validateCartInput(items: unknown): Array<{ productId: string; quantity: number }> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new CheckoutError('Cart must contain at least one item.', 'EMPTY_CART');
  }
  if (items.length > 50) {
    throw new CheckoutError('Cart cannot contain more than 50 distinct items.', 'CART_TOO_LARGE');
  }

  return items.map((item, i) => {
    if (typeof item !== 'object' || item === null) {
      throw new CheckoutError(`Item ${i}: must be an object.`, 'VALIDATION_ERROR');
    }
    const { productId, quantity } = item as Record<string, unknown>;
    if (typeof productId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) {
      throw new CheckoutError(`Item ${i}: productId must be a valid UUID.`, 'VALIDATION_ERROR');
    }
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw new CheckoutError(`Item ${i}: quantity must be an integer between 1 and 100.`, 'VALIDATION_ERROR');
    }
    return { productId, quantity };
  });
}

async function getExistingOrderResponse(
  client: Awaited<ReturnType<typeof getClient>>,
  storeId: string,
  idempotencyKey: string,
  expected: {
    items: Array<{ productId: string; quantity: number }>;
    customerName: string | null;
    customerEmail: string | null;
  },
): Promise<CheckoutResponse | null> {
  const orderResult = await client.query<{
    id: string;
    reference: string;
    total_cents: number;
    currency: string;
    customer_name: string | null;
    customer_email: string | null;
  }>(
    'SELECT id, reference, total_cents, currency, customer_name, customer_email FROM orders WHERE store_id = $1 AND idempotency_key = $2',
    [storeId, idempotencyKey],
  );
  const order = orderResult.rows[0];
  if (!order) return null;

  const existingItems = await client.query<{ product_id: string | null; quantity: number }>(
    'SELECT product_id, quantity FROM order_items WHERE order_id = $1',
    [order.id],
  );
  const existingIdentity = existingItems.rows
    .map((item) => item.product_id === null ? null : `${item.product_id.toLowerCase()}:${item.quantity}`)
    .sort();
  const expectedIdentity = expected.items
    .map((item) => `${item.productId.toLowerCase()}:${item.quantity}`)
    .sort();
  if (
    order.customer_name !== expected.customerName
    || order.customer_email !== expected.customerEmail
    || existingIdentity.length !== expectedIdentity.length
    || existingIdentity.some((item, index) => item === null || item !== expectedIdentity[index])
  ) {
    throw new CheckoutError(
      'This idempotency key was already used for a different checkout. Start a new checkout.',
      'IDEMPOTENCY_KEY_REUSED',
      409,
    );
  }

  const txnResult = await client.query<{ payment_token: string; expires_at: string | null }>(
    'SELECT payment_token, expires_at FROM transactions WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1',
    [order.id],
  );
  const txn = txnResult.rows[0];
  return {
    orderId: order.id,
    orderReference: order.reference,
    paymentToken: txn?.payment_token ?? '',
    amountCents: order.total_cents,
    currency: order.currency,
    expiresAt: txn?.expires_at ?? new Date(Date.now() + PAYMENT_EXPIRY_MINUTES * 60_000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Main: create order from cart
// ---------------------------------------------------------------------------

/**
 * Creates an order from a validated cart request.
 *
 * Steps:
 *  1. Validate input structure.
 *  2. Fetch products from DB (authoritative price/currency).
 *  3. Verify each product belongs to storeId and is active.
 *  4. Check stock availability (no reservation — documented limitation).
 *  5. Calculate totals server-side.
 *  6. Check idempotency key — return existing order if already created.
 *  7. Wrap order + order_items + transaction in a single DB transaction.
 *  8. Return checkout response (no secrets).
 */
export async function createOrderFromCart(
  storeId: string,
  storeSlug: string,
  input: CheckoutRequest,
): Promise<CheckoutResponse> {
  // Collapse repeated product IDs before checking stock. A client can submit
  // duplicate lines even though the storefront UI normally emits one line per
  // product; checking each line separately could otherwise oversell a single
  // order and create duplicate inventory movements later.
  const requestedItems = validateCartInput(input.items);
  const quantities = new Map<string, number>();
  for (const item of requestedItems) {
    const quantity = (quantities.get(item.productId) ?? 0) + item.quantity;
    if (quantity > 100) {
      throw new CheckoutError('Combined quantity for a product cannot exceed 100.', 'VALIDATION_ERROR');
    }
    quantities.set(item.productId, quantity);
  }
  const items = [...quantities].map(([productId, quantity]) => ({ productId, quantity }));

  // Validate customer fields
  if (input.customerName !== undefined) {
    if (typeof input.customerName !== 'string' || input.customerName.trim().length > 200) {
      throw new CheckoutError('customerName must be at most 200 characters.', 'VALIDATION_ERROR');
    }
  }
  if (input.customerEmail !== undefined) {
    if (typeof input.customerEmail !== 'string' || input.customerEmail.length > 254) {
      throw new CheckoutError('customerEmail must be at most 254 characters.', 'VALIDATION_ERROR');
    }
    if (!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(input.customerEmail)) {
      throw new CheckoutError('customerEmail is not a valid email address.', 'VALIDATION_ERROR');
    }
  }

  // Validate idempotency key
  const idempotencyKey = input.idempotencyKey;
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 16 || idempotencyKey.length > 128) {
    throw new CheckoutError('idempotencyKey must be a string of 16–128 characters.', 'VALIDATION_ERROR');
  }

  const customerName = input.customerName?.trim() ?? null;
  const customerEmail = input.customerEmail?.trim().toLowerCase() ?? null;
  const requestIdentity = { items, customerName, customerEmail };

  const client = await getClient();
  try {
    await client.query('BEGIN');

    // -----------------------------------------------------------------
    // Idempotency check — return existing order if already created
    // -----------------------------------------------------------------
    const existingOrder = await getExistingOrderResponse(client, storeId, idempotencyKey, requestIdentity);
    if (existingOrder) {
      await client.query('ROLLBACK');
      return existingOrder;
    }

    // -----------------------------------------------------------------
    // Fetch authoritative product data — lock rows for duration of transaction
    // -----------------------------------------------------------------
    const productIds = [...new Set(items.map((i) => i.productId))];

    const productResult = await client.query<ProductRow>(
      `SELECT id, store_id, name, price_cents, currency, status, stock_quantity
       FROM products
       WHERE id = ANY($1::uuid[])
       FOR SHARE`,
      [productIds],
    );

    const productMap = new Map<string, ProductRow>();
    for (const row of productResult.rows) {
      productMap.set(row.id, row);
    }

    // -----------------------------------------------------------------
    // Validate each item
    // -----------------------------------------------------------------
    let totalCents = 0;
    let currency: string | null = null;

    for (const item of items) {
      const product = productMap.get(item.productId);

      if (!product) {
        throw new CheckoutError(`Product ${item.productId} not found.`, 'PRODUCT_NOT_FOUND', 404);
      }
      if (product.store_id !== storeId) {
        throw new CheckoutError(`Product ${item.productId} does not belong to this store.`, 'PRODUCT_NOT_IN_STORE', 403);
      }
      if (product.status !== 'active') {
        throw new CheckoutError(`Product "${product.name}" is not available for purchase.`, 'PRODUCT_NOT_ACTIVE', 422);
      }
      if (product.stock_quantity < item.quantity) {
        throw new CheckoutError(
          `Insufficient stock for "${product.name}". Available: ${product.stock_quantity}, requested: ${item.quantity}.`,
          'INSUFFICIENT_STOCK',
          422,
        );
      }

      // Enforce single currency per order
      if (currency === null) {
        currency = product.currency;
      } else if (product.currency !== currency) {
        throw new CheckoutError(
          'All products in an order must use the same currency.',
          'MIXED_CURRENCIES',
          422,
        );
      }

      totalCents += product.price_cents * item.quantity;
      // The schema stores all order and line totals as PostgreSQL INTEGER.
      // Reject unrepresentable totals before attempting an insert so clients
      // receive a validation response rather than a database error.
      if (!Number.isSafeInteger(totalCents) || totalCents > 2_147_483_647) {
        throw new CheckoutError('Order total exceeds the supported amount.', 'INVALID_AMOUNT', 422);
      }
    }

    if (totalCents <= 0) {
      throw new CheckoutError('Order total must be greater than zero.', 'ZERO_TOTAL', 422);
    }

    // -----------------------------------------------------------------
    // Create order
    // -----------------------------------------------------------------
    const reference = generateOrderReference();
    const orderResult = await client.query<{ id: string }>(
      `INSERT INTO orders
         (store_id, reference, status, total_cents, currency,
          customer_name, customer_email, idempotency_key)
       VALUES ($1, $2, 'pending', $3, $4, $5, $6, $7)
       ON CONFLICT (store_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        storeId,
        reference,
        totalCents,
        currency,
        customerName,
        customerEmail,
        idempotencyKey,
      ],
    );
    const orderId = orderResult.rows[0]?.id;
    if (!orderId) {
      // Another request with this store/key committed while this transaction
      // was preparing the same order. Return the durable original response.
      const concurrentOrder = await getExistingOrderResponse(client, storeId, idempotencyKey, requestIdentity);
      await client.query('ROLLBACK');
      if (concurrentOrder) return concurrentOrder;
      throw new Error('Idempotent order conflict could not be resolved.');
    }

    // -----------------------------------------------------------------
    // Create order items (price snapshot at time of order)
    // -----------------------------------------------------------------
    for (const item of items) {
      const product = productMap.get(item.productId)!;
      const itemTotal = product.price_cents * item.quantity;
      await client.query(
        `INSERT INTO order_items
           (order_id, product_id, product_name, quantity, unit_price_cents, total_cents)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orderId, item.productId, product.name, item.quantity, product.price_cents, itemTotal],
      );
    }

    // -----------------------------------------------------------------
    // Create payment transaction record
    // -----------------------------------------------------------------
    const paymentToken = generateSecureToken();
    const expiresAt = new Date(Date.now() + PAYMENT_EXPIRY_MINUTES * 60_000);

    await client.query(
      `INSERT INTO transactions
         (store_id, order_id, payment_token, status, amount_cents, currency, expires_at)
       VALUES ($1, $2, $3, 'awaiting_payment', $4, $5, $6)`,
      [storeId, orderId, paymentToken, totalCents, currency, expiresAt.toISOString()],
    );

    await client.query('COMMIT');

    return {
      orderId,
      orderReference: reference,
      paymentToken,
      amountCents: totalCents,
      currency: currency!,
      expiresAt: expiresAt.toISOString(),
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Resolve store ID from slug
// ---------------------------------------------------------------------------

export async function getStoreBySlug(
  slug: string,
): Promise<{ id: string; name: string; slug: string; description: string | null; defaultCurrency: string } | null> {
  const { query } = await import('../db/pool.js');
  const result = await query<{
    id: string; name: string; slug: string; description: string | null; default_currency: string;
  }>(
    'SELECT id, name, slug, description, default_currency FROM stores WHERE slug = $1',
    [slug],
  );
  if (!result.rows[0]) return null;
  const row = result.rows[0];
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    defaultCurrency: row.default_currency,
  };
}
