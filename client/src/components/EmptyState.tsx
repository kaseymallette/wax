import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { Logo } from "./Logo";

export function ImportEmptyState({ headline }: { headline: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-card px-6 py-16 text-center">
      <div className="text-primary">
        <Logo className="h-14 w-14" />
      </div>
      <h2 className="mt-5 font-display text-xl font-bold" data-testid="text-empty-headline">
        {headline}
      </h2>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
        Wax is your listening journal. Upload your music library as a{" "}
        <span className="text-foreground">.db</span>,{" "}
        <span className="text-foreground">.sqlite</span>, or Exportify{" "}
        <span className="text-foreground">.csv</span> file, then start logging what you
        actually listen to — what you played, how it felt, and whether you'd play it
        again.
      </p>
      <Link href="/import">
        <a>
          <Button className="mt-6" size="lg" data-testid="button-import-cta">
            <Upload className="mr-2 h-4 w-4" />
            Upload your library
          </Button>
        </a>
      </Link>
    </div>
  );
}
