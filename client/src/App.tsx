import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme";
import PlaylistsPage from "@/pages/PlaylistsPage";
import { ProfilePreflight } from "@/components/ProfilePreflight";
import NotFound from "@/pages/not-found";

function AppRouter() {
  return (
    <Switch>
      <Route path="/organize"><PlaylistsPage /></Route>
      <Route path="/organize/:id"><PlaylistsPage /></Route>
      <Route path="/publish"><PlaylistsPage stage="publish" /></Route>
      <Route path="/publish/:id"><PlaylistsPage stage="publish" /></Route>
      <Route path="/playlists"><PlaylistsPage /></Route>
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
            <ProfilePreflight><AppRouter /></ProfilePreflight>
          </Router>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
