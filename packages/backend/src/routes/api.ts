/**
 * API router — mounts all versioned sub-routers.
 *
 * Day 1: Only stub routes are present. Each returns a placeholder JSON response
 * so the frontend can verify connectivity. Full implementations added in later days.
 *
 * Every route here will require authentication (Day 2+).
 * Authorization middleware is stubbed below and will be wired up properly then.
 */

import { Router, Request, Response, IRouter } from 'express';
import type { ApiSuccess } from '@store/shared';

export const apiRouter: IRouter = Router();

// ---------------------------------------------------------------------------
// Placeholder stub helper
// ---------------------------------------------------------------------------
function stub(label: string) {
  return (_req: Request, res: Response) => {
    const body: ApiSuccess<{ message: string }> = {
      ok: true,
      data: { message: `${label} endpoint — implementation coming in a later day.` },
    };
    res.status(200).json(body);
  };
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
apiRouter.get('/dashboard', stub('Dashboard'));

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------
apiRouter.get('/products',      stub('List products'));
apiRouter.get('/products/:id',  stub('Get product'));
apiRouter.post('/products',     stub('Create product'));
apiRouter.put('/products/:id',  stub('Update product'));
apiRouter.delete('/products/:id', stub('Delete product'));

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------
apiRouter.get('/orders',        stub('List orders'));
apiRouter.get('/orders/:id',    stub('Get order'));
apiRouter.post('/orders',       stub('Create order'));
apiRouter.patch('/orders/:id/status', stub('Update order status'));

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------
apiRouter.get('/transactions',      stub('List transactions'));
apiRouter.get('/transactions/:id',  stub('Get transaction'));

// ---------------------------------------------------------------------------
// QR Checkout
// ---------------------------------------------------------------------------
apiRouter.post('/checkout/qr',       stub('Generate QR payment request'));
apiRouter.get('/checkout/:token',    stub('Get payment request status'));
// Payment confirmation is backend-only and will be triggered via signed webhook — not client POST
// (No client-facing "confirm payment" endpoint to prevent client-side payment status manipulation)

// ---------------------------------------------------------------------------
// AI Assistant (read-only, strictly scoped)
// ---------------------------------------------------------------------------
apiRouter.post('/assistant/query', stub('AI assistant query'));
