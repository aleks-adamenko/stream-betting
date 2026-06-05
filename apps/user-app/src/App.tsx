import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster as Sonner } from "sonner";

import { AuthProvider } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProfileLayout } from "@/components/layout/ProfileLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Home from "@/pages/user/Home";
import Feed from "@/pages/user/Feed";
import Following from "@/pages/user/Following";
import EventDetails from "@/pages/user/EventDetails";
import MyBets from "@/pages/user/MyBets";
import Profile from "@/pages/user/Profile";
import Notifications from "@/pages/user/Notifications";
import Coins from "@/pages/user/Coins";
import Rewards from "@/pages/user/Rewards";
import Company from "@/pages/user/Company";
import Terms from "@/pages/user/Terms";
import Privacy from "@/pages/user/Privacy";
import SignUp from "@/pages/auth/SignUp";
import SignIn from "@/pages/auth/SignIn";
import ForgotPassword from "@/pages/auth/ForgotPassword";
import ResetPassword from "@/pages/auth/ResetPassword";
import AuthCallback from "@/pages/auth/AuthCallback";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <AuthProvider>
        <Sonner position="top-right" richColors closeButton />
        <Routes>
          {/* Auth routes — own layout, no sidebar/top-bar */}
          <Route path="/auth/sign-up" element={<SignUp />} />
          <Route path="/auth/sign-in" element={<SignIn />} />
          <Route path="/auth/forgot-password" element={<ForgotPassword />} />
          <Route path="/auth/reset-password" element={<ResetPassword />} />
          <Route path="/auth/callback" element={<AuthCallback />} />

          {/* Main app layout */}
          <Route element={<AppLayout />}>
            <Route path="/" element={<Home />} />
            <Route path="/live" element={<Home />} />
            <Route path="/following" element={<Following />} />
            <Route path="/discover" element={<Feed />} />
            <Route path="/event/:id" element={<EventDetails />} />
            <Route path="/company" element={<Company />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            {/* Profile-cluster pages share a 2-column ProfileLayout:
                avatar + nav in the left column, the chosen page
                rendered in the right column via <Outlet />. The
                ProtectedRoute gate wraps the whole layout so the
                left-column avatar / nav are never visible to
                signed-out users. */}
            <Route
              element={
                <ProtectedRoute>
                  <ProfileLayout />
                </ProtectedRoute>
              }
            >
              <Route path="/profile" element={<Profile />} />
              <Route path="/my-bets" element={<MyBets />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/rewards" element={<Rewards />} />
              <Route path="/coins" element={<Coins />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
