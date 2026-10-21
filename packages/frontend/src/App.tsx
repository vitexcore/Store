import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout.tsx';
import { ProtectedRoute } from './components/ProtectedRoute.tsx';
import { CartProvider } from './lib/cart.js';
import { LoginPage } from './pages/LoginPage.tsx';
import { RegisterPage } from './pages/RegisterPage.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { ProductsPage } from './pages/ProductsPage.tsx';
import { OrdersPage } from './pages/OrdersPage.tsx';
import { TransactionsPage } from './pages/TransactionsPage.tsx';
import { CheckoutPage } from './pages/CheckoutPage.tsx';
import { AssistantPage } from './pages/AssistantPage.tsx';
import { StoreSettingsPage } from './pages/StoreSettingsPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';
import { StorefrontPage } from './pages/StorefrontPage.tsx';
import { CheckoutFormPage } from './pages/CheckoutFormPage.tsx';
import { PaymentPage } from './pages/PaymentPage.tsx';

export default function App() {
  return (
    <CartProvider>
      <Routes>
        {/* Auth routes — public, no auth required */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Redirect root to dashboard */}
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        {/* -----------------------------------------------------------
            Public customer routes — no auth, no AppLayout
        ----------------------------------------------------------- */}

        {/** Customer storefront: browse products for a store */}
        <Route path="/store/:storeSlug" element={<StorefrontPage />} />

        {/** Customer checkout form: review cart + customer info */}
        <Route path="/store/:storeSlug/checkout" element={<CheckoutFormPage />} />

        {/** Payment status / QR code page */}
        <Route path="/payment/:token" element={<PaymentPage />} />

        {/** Paystack callback redirect — handled here too */}
        <Route path="/payment/callback" element={<PaymentPage />} />

        {/* -----------------------------------------------------------
            Merchant application shell — protected routes
        ----------------------------------------------------------- */}
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
          handle={{ title: 'Store' }}
        >
          <Route path="/dashboard" element={<DashboardPage />} handle={{ title: 'Dashboard' }} />
          <Route path="/products" element={<ProductsPage />} handle={{ title: 'Products' }} />
          <Route path="/orders" element={<OrdersPage />} handle={{ title: 'Orders' }} />
          <Route path="/transactions" element={<TransactionsPage />} handle={{ title: 'Transactions' }} />
          <Route path="/checkout" element={<CheckoutPage />} handle={{ title: 'QR Checkout' }} />
          <Route path="/assistant" element={<AssistantPage />} handle={{ title: 'AI Assistant' }} />
          <Route path="/settings" element={<StoreSettingsPage />} handle={{ title: 'Store Settings' }} />
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </CartProvider>
  );
}
