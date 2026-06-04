import { NextResponse } from "next/server"
import OpenAI from "openai"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const DEFAULT_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe"
const MAX_DICTATION_AUDIO_BYTES = 25 * 1024 * 1024

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return errorResponse("OPENAI_API_KEY is missing. Add it to .env.local, then restart the dev server.", 400)
  }

  try {
    const formData = await request.formData()
    const audio = formData.get("audio")

    if (!audio || typeof audio === "string") {
      return errorResponse("Upload an audio recording to transcribe.", 400)
    }

    if (audio.size <= 0) {
      return errorResponse("The audio recording was empty.", 400)
    }

    if (audio.size > MAX_DICTATION_AUDIO_BYTES) {
      return errorResponse("Dictation recordings must be smaller than 25 MB.", 413)
    }

    if (audio.type && !audio.type.toLowerCase().startsWith("audio/")) {
      return errorResponse("Upload a valid audio recording.", 400)
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
    const transcription = await openai.audio.transcriptions.create({
      file: audio,
      model: process.env.OPENAI_TRANSCRIPTION_MODEL || DEFAULT_TRANSCRIPTION_MODEL,
      response_format: "json",
    })

    return NextResponse.json({ text: transcription.text.trim() })
  } catch {
    return errorResponse("Could not transcribe dictation.", 500)
  }
}
