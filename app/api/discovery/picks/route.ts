import type { NextRequest } from "next/server"
import { discoveryRequest, readBody } from "@/lib/discovery/http"
import { pickFavorite, pickRequestSchema, undoFavorite, undoRequestSchema } from "@/lib/discovery/service"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  return discoveryRequest(request, async (store, uid) => {
    const { roundId, movieId } = await readBody(request, pickRequestSchema)
    await pickFavorite(store, uid, roundId, movieId)
    return { saved: true }
  })
}

export async function DELETE(request: NextRequest) {
  return discoveryRequest(request, async (store, uid) => {
    const { roundId } = await readBody(request, undoRequestSchema)
    await undoFavorite(store, uid, roundId)
    return { undone: true }
  })
}
