import { cn } from "@/lib/utils";

interface PageContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function PageContainer({ className, children, ...props }: PageContainerProps) {
  return (
    <div
      // Full-width container — the desktop top nav replaced the
      // sidebar, so we don't need to cap content width to make room
      // for it. Reading-width pages (Profile, Coins, etc.) wrap their
      // own content in `mx-auto max-w-2xl`/`max-w-3xl` so they look
      // identical; grid pages (Home/Discover/Following) get the room
      // to render 5-up cards on wide displays.
      //
      // Desktop horizontal padding is `lg:px-6` so content lines up
      // flush with the DesktopTopNav's `lg:px-6` — the logo on the
      // left and grid cards / event hero on the page share the same
      // gutter. The profile-cluster pages are unaffected visually
      // because their inner `mx-auto max-w-2xl` wrap centres content
      // far inside the outer gutter on lg+ viewports.
      className={cn(
        "w-full px-4 py-6 sm:px-6 lg:px-6 lg:py-10",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
