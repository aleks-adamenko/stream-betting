import { Link } from "react-router-dom";

const links = [
  { to: "/studio", label: "Creator Studio" },
  { to: "/company", label: "Company" },
  { to: "/terms", label: "Terms & Policies" },
];

export function MobileFooter() {
  return (
    <footer className="snap-start border-t border-border/30 bg-background/60 px-4 py-4 backdrop-blur-sm lg:hidden">
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
        {links.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="text-sm font-bold text-foreground/80 transition-colors hover:text-foreground"
          >
            {item.label}
          </Link>
        ))}
      </div>
      <p className="mt-3 text-center text-[11px] leading-tight text-muted-foreground">
        © {new Date().getFullYear()} LiveRush · Human-only content
      </p>
    </footer>
  );
}
