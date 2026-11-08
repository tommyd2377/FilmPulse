import type { NextRequest } from "next/server"
import { discoveryRequest } from "@/lib/discovery/http"
import { streamingServices } from "@/lib/discovery/on-demand"
import { DiscoveryError } from "@/lib/discovery/errors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  return discoveryRequest(request, async () => {
    const region = request.nextUrl.searchParams.get("region") ?? "US"
    if (!/^[A-Z]{2}$/.test(region)) throw new DiscoveryError("Choose a valid watch region.")
    return { services: await streamingServices(region) }
  })
}
