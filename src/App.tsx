import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Toaster as Sonner } from "sonner";

import { AppLayout } from "@/components/layout/AppLayout";
import Home from "@/pages/user/Home";
import Feed from "@/pages/user/Feed";
import Following from "@/pages/user/Following";
import EventDetails from "@/pages/user/EventDetails";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <BrowserRouter>
      <Sonner position="top-right" richColors closeButton />
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/live" element={<Home />} />
          <Route path="/trending" element={<Home />} />
          <Route path="/following" element={<Following />} />
          <Route path="/discover" element={<Feed />} />
          <Route path="/event/:id" element={<EventDetails />} />
          {/* Auth routes (phase 5): /auth/sign-in, /auth/sign-up, ... */}
          {/* Studio routes (phase 6): /studio/* */}
          {/* Admin routes (phase 7): /admin/* */}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </QueryClientProvider>
);

export default App;
