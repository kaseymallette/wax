import { Link, useLocation } from "wouter";
import { Logo } from "./Logo";
import { useTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { theme, toggle } = useTheme();
  const profileId = location.split("/")[2];
  const suffix = profileId ? `/${profileId}` : "";
  const steps = [
    { href: "/", label: "Collections", active: location === "/" },
    { href: `/organize${suffix}`, label: "Organize", active: location.startsWith("/organize") || location === "/playlists" },
    { href: `/publish${suffix}`, label: "Save & publish", active: location.startsWith("/publish") },
  ];
  return <div className="min-h-screen bg-background text-foreground">
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 text-primary" data-testid="link-home"><Logo className="h-8 w-8" /><span className="font-display text-xl font-extrabold text-foreground">Wax</span></Link>
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">{theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}</Button>
      </div>
    </header>
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <nav aria-label="Playlist workflow" className="mb-8 flex flex-wrap gap-x-5 gap-y-3 border-b border-border pb-5 sm:gap-x-8">
        {steps.map((step, index) => <Link key={step.label} href={step.href} aria-current={step.active ? "step" : undefined} className={`flex items-center gap-2 text-xs sm:text-sm ${step.active ? "font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}><span className={`flex h-6 w-6 items-center justify-center rounded-full border ${step.active ? "border-primary bg-primary/10" : "border-border"}`}>{index + 1}</span>{step.label}</Link>)}
      </nav>
      {children}
    </main>
  </div>;
}
