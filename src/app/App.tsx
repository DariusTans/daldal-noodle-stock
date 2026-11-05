import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { Gate, LoginPage, NewShopPage } from './pages/Entry';
import { ShopLayout } from './pages/Layout';
import { BackendProvider, ToastProvider } from './state';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: 1 } },
});

const router = createBrowserRouter([
  { path: '/', element: <Gate /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/new-shop', element: <NewShopPage /> },
  { path: '/s/:shopId/:page?', element: <ShopLayout /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BackendProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </BackendProvider>
    </QueryClientProvider>
  );
}
