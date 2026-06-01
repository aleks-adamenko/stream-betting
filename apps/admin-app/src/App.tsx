import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "sonner";

import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminLayout } from "@/components/AdminLayout";

import SignIn from "@/pages/auth/SignIn";
import ForgotPassword from "@/pages/auth/ForgotPassword";
import ResetPassword from "@/pages/auth/ResetPassword";
import AuthCallback from "@/pages/auth/AuthCallback";

import Users from "@/pages/Users";
import Events from "@/pages/Events";
import Ledger from "@/pages/Ledger";
import Stats from "@/pages/Stats";
import Wallet from "@/pages/Wallet";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Sonner position="top-right" richColors closeButton />
          <Routes>
            {/* Auth — own layout, no admin shell. No sign-up route by
                design: admins are provisioned via SQL, not self-serve. */}
            <Route path="/auth/sign-in" element={<SignIn />} />
            <Route path="/auth/forgot-password" element={<ForgotPassword />} />
            <Route path="/auth/reset-password" element={<ResetPassword />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* Authenticated admin shell. Default landing = /users. */}
            <Route
              element={
                <ProtectedRoute>
                  <AdminLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Navigate to="/users" replace />} />
              <Route path="/users" element={<Users />} />
              <Route path="/events" element={<Events />} />
              <Route path="/ledger" element={<Ledger />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/wallet" element={<Wallet />} />
            </Route>

            {/* Catch-all → /users (signed-out users will bounce through
                ProtectedRoute to /auth/sign-in first). */}
            <Route path="*" element={<Navigate to="/users" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
