import FilmDiscovery from "@/components/film-discovery"
import { dataMode } from "@/lib/discovery/store"

export const dynamic = "force-dynamic"

export default function Home() {
  return (
    <main className="min-h-screen bg-background">
      <FilmDiscovery mode={dataMode()} />
    </main>
  )
}

