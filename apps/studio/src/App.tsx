import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "sonner";

import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { StudioLayout } from "@/components/StudioLayout";

import SignUp from "@/pages/auth/SignUp";
import SignIn from "@/pages/auth/SignIn";
import ForgotPassword from "@/pages/auth/ForgotPassword";
import ResetPassword from "@/pages/auth/ResetPassword";
import AuthCallback from "@/pages/auth/AuthCallback";

import CreatorOnboarding from "@/pages/onboarding/CreatorOnboarding";
import Dashboard from "@/pages/Dashboard";
import EventList from "@/pages/events/EventList";
import EventEditor from "@/pages/events/EventEditor";

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
            {/* Auth — own layout, no studio shell */}
            <Route path="/auth/sign-up" element={<SignUp />} />
            <Route path="/auth/sign-in" element={<SignIn />} />
            <Route path="/auth/forgot-password" element={<ForgotPassword />} />
            <Route path="/auth/reset-password" element={<ResetPassword />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            {/* Onboarding — gated on auth but not on having a creator row yet */}
            <Route
              path="/onboarding"
              element={
                <ProtectedRoute requireOnboarding={false}>
                  <CreatorOnboarding />
                </ProtectedRoute>
              }
            />

            {/* Authenticated studio shell */}
            <Route
              element={
                <ProtectedRoute>
                  <StudioLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/" element={<Dashboard />} />
              <Route path="/events" element={<EventList />} />
              <Route path="/events/new" element={<EventEditor />} />
              <Route path="/events/:id" element={<EventEditor />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
