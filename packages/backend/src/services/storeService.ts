/**
 * Store service — getStore, updateStore.
 * All queries are parameterized. Ownership is enforced at the route level.
 */

import { query } from '../db/pool.js';
import type { Store } from '@store/shared';

// ---------------------------------------------------------------------------
// Row shape from DB (snake_case)
// ---------------------------------------------------------------------------
interface StoreRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  contact_email: string | null;
  address: string | null;
  default_currency: string;
  created_at: Date;
  updated_at: Date;
}

function rowToStore(row: StoreRow): Store {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    contactEmail: row.contact_email,
    address: row.address,
    defaultCurrency: row.default_currency,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const STORE_COLUMNS = `id, name, slug, description, contact_email, address, default_currency, created_at, updated_at`;

export async function getStore(storeId: string): Promise<Store | null> {
  const result = await query<StoreRow>(
    `SELECT ${STORE_COLUMNS} FROM stores WHERE id = $1`,
    [storeId],
  );
  return result.rows[0] ? rowToStore(result.rows[0]) : null;
}

export interface UpdateStoreInput {
  name?: string;
  description?: string | null;
  contactEmail?: string | null;
  address?: string | null;
  defaultCurrency?: string;
}

export async function updateStore(storeId: string, input: UpdateStoreInput): Promise<Store | null> {
  const updates: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    updates.push(`name = $${idx++}`);
    params.push(input.name.trim());
  }
  if (input.description !== undefined) {
    updates.push(`description = $${idx++}`);
    params.push(input.description ? input.description.trim().slice(0, 1000) : null);
  }
  if (input.contactEmail !== undefined) {
    updates.push(`contact_email = $${idx++}`);
    params.push(input.contactEmail ? input.contactEmail.trim().toLowerCase() : null);
  }
  if (input.address !== undefined) {
    updates.push(`address = $${idx++}`);
    params.push(input.address ? input.address.trim().slice(0, 500) : null);
  }
  if (input.defaultCurrency !== undefined) {
    updates.push(`default_currency = $${idx++}`);
    params.push(input.defaultCurrency);
  }

  if (updates.length === 0) return getStore(storeId);

  updates.push(`updated_at = NOW()`);
  params.push(storeId);

  const result = await query<StoreRow>(
    `UPDATE stores SET ${updates.join(', ')} WHERE id = $${idx} RETURNING ${STORE_COLUMNS}`,
    params,
  );
  return result.rows[0] ? rowToStore(result.rows[0]) : null;
}
