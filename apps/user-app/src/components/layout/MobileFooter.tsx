import { Link } from "react-router-dom";

// Terms + Privacy are split into two independent links — matches the
// desktop sidebar footer so the two surfaces stay parallel.
const links = [
  {
    to: "https://studio.liverush.co",
    label: "Creator Studio",
    external: true,
  },
  { to: "/company", label: "Company", external: false },
  { to: "/terms", label: "Terms of Service", external: false },
  { to: "/privacy", label: "Privacy Policy", external: false },
] as const;

export function MobileFooter() {
  return (
    <footer className="snap-start border-t border-border/30 bg-background/60 px-4 py-4 backdrop-blur-sm lg:hidden">
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        {links.map((item) =>
          item.external ? (
            <a
              key={item.to}
              href={item.to}
              target="_blank"
              rel="noreferrer noopener"
              className="text-sm font-bold text-foreground/80 transition-colors hover:text-foreground"
            >
              {item.label}
            </a>
          ) : (
            <Link
              key={item.to}
              to={item.to}
              className="text-sm font-bold text-foreground/80 transition-colors hover:text-foreground"
            >
              {item.label}
            </Link>
          ),
        )}
      </div>
      <p className="mt-3 text-center text-[11px] leading-tight text-muted-foreground">
        © {new Date().getFullYear()} LiveRush · Human-only content
      </p>
    </footer>
  );
}
