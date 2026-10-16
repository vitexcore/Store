import { Routes, Route, Navigate } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout.tsx';
import { DashboardPage } from './pages/DashboardPage.tsx';
import { ProductsPage } from './pages/ProductsPage.tsx';
import { OrdersPage } from './pages/OrdersPage.tsx';
import { TransactionsPage } from './pages/TransactionsPage.tsx';
import { CheckoutPage } from './pages/CheckoutPage.tsx';
import { AssistantPage } from './pages/AssistantPage.tsx';
import { NotFoundPage } from './pages/NotFoundPage.tsx';

export default function App() {
  return (
    <Routes>
      {/* Redirect root to dashboard */}
      <Route path="/" element={<Navigate to="/dashboard" replace />} />

      {/* Main application shell */}
      <Route
        element={<AppLayout />}
        handle={{ title: 'Store' }}
      >
        <Route
          path="/dashboard"
          element={<DashboardPage />}
          handle={{ title: 'Dashboard' }}
        />
        <Route
          path="/products"
          element={<ProductsPage />}
          handle={{ title: 'Products' }}
        />
        <Route
          path="/orders"
          element={<OrdersPage />}
          handle={{ title: 'Orders' }}
        />
        <Route
          path="/transactions"
          element={<TransactionsPage />}
          handle={{ title: 'Transactions' }}
        />
        <Route
          path="/checkout"
          element={<CheckoutPage />}
          handle={{ title: 'QR Checkout' }}
        />
        <Route
          path="/assistant"
          element={<AssistantPage />}
          handle={{ title: 'AI Assistant' }}
        />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
