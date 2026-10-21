/**
 * CartContext — client-side cart state management.
 *
 * Security note: Cart state is display-only. Prices, totals, and product
 * availability are ALWAYS verified server-side on order creation. The cart
 * is never used as the source of truth for financial calculations.
 *
 * Cart is stored in sessionStorage (not localStorage) so it is cleared
 * when the browser session ends and never persists across tabs.
 */

import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import type { CartItem, StorefrontProduct } from '@store/shared';

// ---------------------------------------------------------------------------
// State and actions
// ---------------------------------------------------------------------------

export interface CartState {
  storeSlug: string | null;
  items: CartItem[];
}

type CartAction =
  | { type: 'ADD_ITEM'; product: StorefrontProduct }
  | { type: 'REMOVE_ITEM'; productId: string }
  | { type: 'INCREMENT'; productId: string }
  | { type: 'DECREMENT'; productId: string }
  | { type: 'SET_QUANTITY'; productId: string; quantity: number }
  | { type: 'CLEAR' }
  | { type: 'LOAD'; state: CartState };

const MAX_ITEM_QUANTITY = 100;

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'ADD_ITEM': {
      const existing = state.items.find((i) => i.productId === action.product.id);
      if (existing) {
        const newQty = Math.min(existing.quantity + 1, MAX_ITEM_QUANTITY, action.product.stockQuantity);
        return {
          ...state,
          items: state.items.map((i) =>
            i.productId === action.product.id ? { ...i, quantity: newQty } : i,
          ),
        };
      }
      return {
        ...state,
        items: [
          ...state.items,
          {
            productId: action.product.id,
            quantity: 1,
            name: action.product.name,
            priceCents: action.product.priceCents,
            currency: action.product.currency,
            imageUrl: action.product.imageUrl,
            maxStock: action.product.stockQuantity,
          },
        ],
      };
    }

    case 'REMOVE_ITEM':
      return { ...state, items: state.items.filter((i) => i.productId !== action.productId) };

    case 'INCREMENT': {
      return {
        ...state,
        items: state.items.map((i) =>
          i.productId === action.productId
            ? { ...i, quantity: Math.min(i.quantity + 1, MAX_ITEM_QUANTITY, i.maxStock) }
            : i,
        ),
      };
    }

    case 'DECREMENT': {
      const updated = state.items
        .map((i) =>
          i.productId === action.productId ? { ...i, quantity: i.quantity - 1 } : i,
        )
        .filter((i) => i.quantity > 0);
      return { ...state, items: updated };
    }

    case 'SET_QUANTITY': {
      const clamped = Math.max(0, Math.min(action.quantity, MAX_ITEM_QUANTITY));
      if (clamped === 0) {
        return { ...state, items: state.items.filter((i) => i.productId !== action.productId) };
      }
      return {
        ...state,
        items: state.items.map((i) =>
          i.productId === action.productId ? { ...i, quantity: clamped } : i,
        ),
      };
    }

    case 'CLEAR':
      return { storeSlug: null, items: [] };

    case 'LOAD':
      return action.state;

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface CartContextValue {
  state: CartState;
  addItem: (product: StorefrontProduct, storeSlug: string) => void;
  removeItem: (productId: string) => void;
  increment: (productId: string) => void;
  decrement: (productId: string) => void;
  setQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  itemCount: number;
  /** Display total in minor units — NOT authoritative for payment */
  displayTotalCents: number;
}

const CartContext = createContext<CartContextValue | null>(null);

const STORAGE_KEY = 'store_cart_v1';

function loadFromSession(): CartState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { storeSlug: null, items: [] };
    const parsed = JSON.parse(raw) as CartState;
    // Basic validation
    if (!Array.isArray(parsed.items)) return { storeSlug: null, items: [] };
    return parsed;
  } catch {
    return { storeSlug: null, items: [] };
  }
}

function saveToSession(state: CartState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage may be unavailable in some contexts — silently ignore
  }
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, { storeSlug: null, items: [] });

  // Load persisted cart on mount
  useEffect(() => {
    const saved = loadFromSession();
    if (saved.items.length > 0) {
      dispatch({ type: 'LOAD', state: saved });
    }
  }, []);

  // Persist cart on every change
  useEffect(() => {
    saveToSession(state);
  }, [state]);

  const addItem = useCallback((product: StorefrontProduct, storeSlug: string) => {
    if (state.storeSlug && state.storeSlug !== storeSlug) {
      dispatch({ type: 'CLEAR' });
    }
    const newState: CartState = {
      storeSlug,
      items: (() => {
        const existing = state.storeSlug === storeSlug ? state.items : [];
        const found = existing.find((i) => i.productId === product.id);
        if (found) {
          return existing.map((i) =>
            i.productId === product.id
              ? { ...i, quantity: Math.min(i.quantity + 1, MAX_ITEM_QUANTITY, product.stockQuantity) }
              : i,
          );
        }
        return [
          ...existing,
          {
            productId: product.id,
            quantity: 1,
            name: product.name,
            priceCents: product.priceCents,
            currency: product.currency,
            imageUrl: product.imageUrl,
            maxStock: product.stockQuantity,
          },
        ];
      })(),
    };
    dispatch({ type: 'LOAD', state: newState });
  }, [state]);

  const removeItem = useCallback((productId: string) => dispatch({ type: 'REMOVE_ITEM', productId }), []);
  const increment = useCallback((productId: string) => dispatch({ type: 'INCREMENT', productId }), []);
  const decrement = useCallback((productId: string) => dispatch({ type: 'DECREMENT', productId }), []);
  const setQuantity = useCallback((productId: string, quantity: number) => dispatch({ type: 'SET_QUANTITY', productId, quantity }), []);
  const clearCart = useCallback(() => dispatch({ type: 'CLEAR' }), []);

  const itemCount = state.items.reduce((sum, i) => sum + i.quantity, 0);
  const displayTotalCents = state.items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);

  return (
    <CartContext.Provider value={{
      state,
      addItem,
      removeItem,
      increment,
      decrement,
      setQuantity,
      clearCart,
      itemCount,
      displayTotalCents,
    }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
