import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster as Sonner } from "sonner";

import { AuthProvider } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/layout/AppLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Home from "@/pages/user/Home";
import Feed from "@/pages/user/Feed";
import Following from "@/pages/user/Following";
import EventDetails from "@/pages/user/EventDetails";
import MyBets from "@/pages/user/MyBets";
import Profile from "@/pages/user/Profile";
import Notifications from "@/pages/user/Notifications";
import TopUp from "@/pages/user/TopUp";
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
            <Route path="/trending" element={<Home />} />
            <Route path="/following" element={<Following />} />
            <Route path="/discover" element={<Feed />} />
            <Route path="/event/:id" element={<EventDetails />} />
            <Route
              path="/my-bets"
              element={
                <ProtectedRoute>
                  <MyBets />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/notifications"
              element={
                <ProtectedRoute>
                  <Notifications />
                </ProtectedRoute>
              }
            />
            <Route
              path="/balance/top-up"
              element={
                <ProtectedRoute>
                  <TopUp />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
