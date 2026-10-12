import { useQuery } from "@tanstack/react-query";
import type { PreflightReport } from "../../../server/profileConfig";
import { Layout } from "./Layout";
import { Button } from "./ui/button";
import { type ReactNode } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Check, RefreshCw, Disc3 } from "lucide-react";

function artworkFor(name: string): number {
  const genre = name.toLowerCase();
  if (genre.includes("classic")) return 1;
  if (genre.includes("country") || genre.includes("blues")) return 3;
  if (genre.includes("electro")) return 4;
  if (genre.includes("folk")) return 0;
  if (genre.includes("alt")) return 5;
  if (genre.includes("pop") || genre.includes("hip")) return 2;
  return 0;
}

export function ProfilePreflight({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const query = useQuery<PreflightReport>({
    queryKey: ["/api/profiles/preflight"],
    queryFn: async () => {
      const response = await fetch("/api/profiles/preflight");
      if (!response.ok) throw new Error("Could not load profile validation.");
      return response.json();
    },
    refetchOnWindowFocus: true,
  });
  if (query.data?.valid && location !== "/") return <>{children}</>;
  const profiles = query.data?.profiles ?? [];
  const total = profiles.reduce((sum, profile) => sum + (profile.trackCount ?? 0), 0);
  return <Layout>
    <div className="collection-intro">
      <p className="collection-eyebrow"><Disc3 size={15} /> YOUR WAX COLLECTION <span> / {query.data?.username ?? "WELCOME"}</span></p>
      <h1 className="font-display">Good music.<br /><span>A whole week ahead.</span></h1>
      <p className="collection-description">A little of everything you love. Gather your favorites here,<br className="hidden sm:block" /> then give each day its own soundtrack.</p>
      {query.data && <div className="collection-totals"><span><strong>{profiles.length}</strong> genre collections</span><span><strong>{total.toLocaleString()}</strong> songs in the mix</span></div>}
    </div>
    {query.isLoading && <p role="status" className="py-8 text-muted-foreground">Getting your collection ready…</p>}
    {query.error && <p role="alert" className="my-6 text-destructive">We couldn’t load your collection. Try refreshing below.</p>}
    {query.data && <>
      {query.data.errors.length > 0 && <div role="alert" className="my-6 rounded-xl border border-destructive/40 p-4"><p>We need a quick fix before your collection is ready.</p><details className="mt-2"><summary className="cursor-pointer">Setup details</summary>{query.data.errors.map((error, i) => <p className="mt-2 break-words text-sm" key={i}>{error}</p>)}</details></div>}
      <div className="collection-shelf">
        {profiles.map((profile, index) => { const artwork = artworkFor(profile.name); return <section key={profile.id} className="collection-card">
          <div className={`collection-art collection-art-${artwork}`} aria-hidden="true">
            <span className="sleeve-caption">WAX / SELECTS</span>
            <svg viewBox="0 0 320 250" fill="none" className="sleeve-graphic">
              {artwork === 0 ? <>
                <circle cx="236" cy="64" r="38" fill="#eddba6" />
                <path d="M-20 240L100 47L236 250" fill="#244b42" />
                <path d="M90 250L231 91L360 250" fill="#527362" />
                <path d="M-30 250Q80 129 195 230T350 184V280H-30Z" fill="#b9c28e" />
              </> : artwork === 1 ? <>
                {[108, 86, 64, 42].map((r, i) => <circle key={r} cx="160" cy="139" r={r} stroke={i % 2 ? '#edbd87' : '#602e2b'} strokeWidth="14" />)}
                <path d="M185 30L118 146H160L135 238L218 116H169Z" fill="#ffe4ad" />
              </> : artwork === 2 ? <>
                {[0, 1, 2, 3, 4].map(i => <path key={i} d={`M-40 ${74+i*30}C60 ${-25+i*30} 128 ${215+i*30} 360 ${45+i*30}`} stroke={['#f4cea7','#db9195','#704f72','#f4cea7','#db9195'][i]} strokeWidth="19" />)}
              </> : artwork === 3 ? <>
                <circle cx="160" cy="99" r="59" fill="#f0bc72" />
                {[0, 1, 2, 3, 4].map(i => <path key={i} d={`M0 ${155 + i*19}Q80 ${120 + i*19} 160 ${155 + i*19}T320 ${155+i*19}`} stroke={i % 2 ? "#db9464" : "#794c3f"} strokeWidth="14" />)}
                <path d="M160 116L127 250H193Z" fill="#352f32" />
                <path d="M160 148V250" stroke="#f4d7a1" strokeWidth="2" strokeDasharray="10 12" />
              </> : artwork === 4 ? <>
                <circle cx="160" cy="127" r="87" stroke="#ba8ce0" strokeWidth="2" />
                <path d="M160 37L255 127L160 217L65 127Z" fill="#57367d" stroke="#edb5e7" strokeWidth="3" />
                <path d="M160 66L223 127L160 188L97 127Z" fill="#9d65c3" />
                <path d="M160 91L198 127L160 164L122 127Z" fill="#f1b4dc" />
                {[0,1,2,3,4,5,6].map(i => <path key={i} d={`M${24+i*45} 225V${205-(i%3)*14}`} stroke="#8bd3d0" strokeWidth="8" />)}
              </> : <>
                <path d="M-20 188L110 42L164 105L210 49L340 195V270H-20Z" fill="#263d52" />
                <path d="M-20 230L125 80L171 143L222 95L340 239" stroke="#f1d69b" strokeWidth="17" />
                <path d="M-20 254L125 104L171 167L222 119L340 263" stroke="#d37654" strokeWidth="10" />
                <circle cx="257" cy="56" r="18" fill="#f1d69b" />
              </>}
            </svg>
            <span className="sleeve-number">VOL. {String(index + 1).padStart(2, "0")}</span>
            <Disc3 className="sleeve-mark" size={24} />
          </div>
          <div className="pt-5">
            <div className="flex items-start justify-between gap-2"><h2 className="font-display text-xl font-bold">{profile.name}</h2><span className={`collection-status ${profile.valid ? '' : 'collection-status-warning'}`}>{profile.valid ? <Check size={12} /> : null}{profile.valid ? "Ready" : "Needs a fix"}</span></div>
            <p className="mt-2 text-sm text-muted-foreground">{profile.trackCount === null ? "Waiting for your songs" : `${profile.trackCount} songs · Your personal selection`}</p>
            <details className="collection-details">
              <summary>{profile.valid ? "Source details" : "See what needs fixing"}</summary>
              <p className="mt-3 break-all">{profile.path}</p>
              {profile.errors.length > 0 && <><p className="mt-3">Each collection needs 70–700 songs with complete track details.</p><ul className="mt-2 list-inside list-disc">{profile.errors.map((error, i) => <li key={i}>{error}</li>)}</ul></>}
            </details>
          </div>
        </section>; })}
      </div>
    </>}
    <div className="collection-footer">
      <div><p role="status" className="font-medium">{query.data ? query.data.valid ? "Your collection is ready to go." : "Almost there. Let’s get every collection ready." : "Your next rotation starts here."}</p><p className="mt-1 text-sm text-muted-foreground">{query.data?.valid ? "Next up: your playlist workspace." : "Update your source files, then refresh your collection."}</p></div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw className={query.isFetching ? "animate-spin" : ""} /> Refresh collection</Button>
        {query.data?.valid && <Button className="rounded-full px-6 py-3" onClick={() => navigate("/organize")}>Organize playlists <ArrowRight /></Button>}
      </div>
    </div>
  </Layout>;
}
