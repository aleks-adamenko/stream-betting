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

import Viewers from "@/pages/Viewers";
import Creators from "@/pages/Creators";
import Events from "@/pages/Events";
import Ledger from "@/pages/Ledger";
import Settings from "@/pages/Settings";
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

            {/* Authenticated admin shell. Default landing = /viewers. */}
            <Route
              element={
                <ProtectedRoute>
                  <AdminLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Navigate to="/viewers" replace />} />
              <Route path="/viewers" element={<Viewers />} />
              {/* Back-compat: old /users bookmarks → /viewers. */}
              <Route
                path="/users"
                element={<Navigate to="/viewers" replace />}
              />
              <Route path="/creators" element={<Creators />} />
              <Route path="/events" element={<Events />} />
              <Route path="/ledger" element={<Ledger />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/wallet" element={<Wallet />} />
              <Route path="/settings" element={<Settings />} />
            </Route>

            {/* Catch-all → /viewers (signed-out users will bounce through
                ProtectedRoute to /auth/sign-in first). */}
            <Route path="*" element={<Navigate to="/viewers" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
