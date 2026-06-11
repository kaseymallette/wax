import { Link, useLocation } from "wouter";
import { Logo } from "./Logo";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Shuffle, Library, Clock, BarChart3, Upload, Moon, Sun, Sparkles } from "lucide-react";

const NAV = [
  { href: "/", label: "Shuffle", icon: Shuffle },
  { href: "/library", label: "Library", icon: Library },
  { href: "/recents", label: "Recents", icon: Clock },
  { href: "/stats", label: "Stats", icon: BarChart3 },
  { href: "/import", label: "Import", icon: Upload },
  { href: "/playlist-builder", label: "Builder", icon: Sparkles },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/" data-testid="link-home">
            <a className="flex items-center gap-2.5 text-primary">
              <Logo className="h-8 w-8" />
              <span className="font-display text-xl font-extrabold tracking-tight text-foreground">
                Wax
              </span>
            </a>
          </Link>

          <nav className="flex items-center gap-1">
            {NAV.map((item) => {
              const active =
                item.href === "/"
                  ? location === "/"
                  : location.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href} data-testid={`link-nav-${item.label.toLowerCase()}`}>
                  <a
                    className={`flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors hover-elevate ${
                      active
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="hidden sm:inline">{item.label}</span>
                  </a>
                </Link>
              );
            })}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              data-testid="button-theme-toggle"
              aria-label="Toggle theme"
              className="ml-1"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">{children}</main>
    </div>
  );
}
