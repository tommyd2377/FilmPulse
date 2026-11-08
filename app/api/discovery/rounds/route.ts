import type { NextRequest } from "next/server"
import { discoveryRequest, readBody } from "@/lib/discovery/http"
import { createRound, roundRequestSchema } from "@/lib/discovery/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  return discoveryRequest(request, async (store, uid) => createRound(store, uid, await readBody(request, roundRequestSchema)))
}
