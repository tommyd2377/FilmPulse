import type { NextRequest } from "next/server"
import { discoveryRequest, readBody } from "@/lib/discovery/http"
import { resetDiscovery, resetRequestSchema } from "@/lib/discovery/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  return discoveryRequest(request, async (store, uid) => {
    await readBody(request, resetRequestSchema)
    await resetDiscovery(store, uid)
    return { reset: true }
  })
}
