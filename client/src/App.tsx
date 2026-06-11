import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import Shuffle from "@/pages/Shuffle";
import LibraryPage from "@/pages/LibraryPage";
import RecentsPage from "@/pages/RecentsPage";
import StatsPage from "@/pages/StatsPage";
import ImportPage from "@/pages/ImportPage";
import PlaylistBuilderPage from "@/pages/PlaylistBuilderPage";
import NotFound from "@/pages/not-found";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Shuffle} />
      <Route path="/library" component={LibraryPage} />
      <Route path="/recents" component={RecentsPage} />
      <Route path="/stats" component={StatsPage} />
      <Route path="/import" component={ImportPage} />
      <Route path="/playlist-builder" component={PlaylistBuilderPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
