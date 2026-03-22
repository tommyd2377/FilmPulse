import { NextResponse } from "next/server"
import OpenAI from "openai"

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? "gpt-5.2"
const OPENAI_EXTRACT_MODEL = process.env.OPENAI_EXTRACT_MODEL ?? "gpt-5-mini"

const openai = OPENAI_API_KEY
  ? new OpenAI({
      apiKey: OPENAI_API_KEY,
    })
  : null

interface RecommendationRequestBody {
  userMessage?: unknown
  preference?: unknown
  previousResponseId?: unknown
  conversationHistory?: unknown
}

type ConversationRole = "user" | "assistant"

interface ConversationHistoryItem {
  role: ConversationRole
  content: string
}

function preferenceMode(preference: number): "indie" | "mixed" | "blockbusters" {
  if (preference <= 0.33) {
    return "indie"
  }
  if (preference >= 0.67) {
    return "blockbusters"
  }
  return "mixed"
}

function buildInstructions(preference: number): string {
  const mode = preferenceMode(preference)

  const preferenceDirective =
    mode === "indie"
      ? "Prioritize indie, international, or lesser-known films. Avoid obvious blockbusters unless the user asks."
      : mode === "blockbusters"
      ? "Prioritize popular, mainstream, or blockbuster films with broad appeal."
      : "Blend hidden gems and crowd-pleasers in a balanced way."

  return [
    "You are FilmPulse, a warm and conversational movie concierge.",
    "Keep replies natural and friendly, with contractions and clear personality, never robotic.",
    "Recommend 3-4 movies unless the user explicitly asks for more.",
    "For each movie, include a short reason (1 sentence) why it matches the user's taste.",
    "Format every movie title in **bold** markdown.",
    "End with one concise follow-up question to continue the conversation.",
    preferenceDirective,
  ].join("\n")
}

function sanitizeMovieTitles(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const deduped = new Set<string>()
  for (const item of value) {
    if (typeof item !== "string") {
      continue
    }
    const normalized = normalizeMovieTitle(item)
    if (!normalized || !isLikelyMovieTitle(normalized)) {
      continue
    }
    deduped.add(normalized)
  }

  return [...deduped]
}

function normalizeMovieTitle(rawTitle: string): string {
  return rawTitle
    .trim()
    .replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/g, "")
    .replace(/^[\-–—:;,.!?()\[\]]+|[\-–—:;,.!?()\[\]]+$/g, "")
    .replace(/\s*\((\d{4}|[A-Za-z]{3,}\s\d{4})\)$/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function isLikelyMovieTitle(title: string): boolean {
  if (title.length < 2 || title.length > 80) {
    return false
  }

  if (/[.?!]\s+\w+/.test(title)) {
    return false
  }

  if (title.split(/\s+/).length > 14) {
    return false
  }

  const words = title.split(/\s+/)
  const lowercaseStarts = words.filter((word) => /^[a-z]/.test(word)).length
  if (words.length >= 5 && lowercaseStarts >= words.length - 1) {
    return false
  }

  return true
}

function sanitizeConversationHistory(value: unknown): ConversationHistoryItem[] {
  if (!Array.isArray(value)) {
    return []
  }

  const history: ConversationHistoryItem[] = []

  for (const item of value.slice(-12)) {
    if (!item || typeof item !== "object") {
      continue
    }

    const roleValue = "role" in item ? item.role : undefined
    const contentValue = "content" in item ? item.content : undefined

    if ((roleValue !== "user" && roleValue !== "assistant") || typeof contentValue !== "string") {
      continue
    }

    const content = contentValue.trim().slice(0, 800)
    if (!content) {
      continue
    }

    history.push({
      role: roleValue,
      content,
    })
  }

  return history
}

function buildConversationAwareInput(userMessage: string, history: ConversationHistoryItem[]): string {
  if (history.length === 0) {
    return userMessage
  }

  const formattedHistory = history
    .map((turn) => `${turn.role === "assistant" ? "Assistant" : "User"}: ${turn.content}`)
    .join("\n")

  return [
    "Conversation so far (oldest to newest):",
    formattedHistory,
    "",
    `Latest user message: ${userMessage}`,
  ].join("\n")
}

function extractMovieTitlesFromMarkdown(text: string): string[] {
  const matches: string[] = []
  const patterns = [/\*\*(.*?)\*\*/g, /\*([^*\n]+)\*/g]

  for (const pattern of patterns) {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const candidate = match[1]?.trim()
      if (!candidate) {
        continue
      }
      matches.push(candidate.replace(/['’]s$/i, "").trim())
    }
  }

  return sanitizeMovieTitles(matches)
}

function createSSEEvent(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return "Failed to get recommendation"
}

function shouldRetryWithoutPreviousResponseId(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const message = error.message.toLowerCase()
  return message.includes("previous_response_id") || message.includes("previous response")
}

async function extractMovieTitlesFromText(responseText: string): Promise<string[]> {
  if (!openai || !responseText.trim()) {
    return []
  }

  const markdownTitles = extractMovieTitlesFromMarkdown(responseText)

  try {
    const extraction = await openai.responses.create({
      model: OPENAI_EXTRACT_MODEL,
      input: responseText,
      instructions:
        "Extract only exact movie titles mentioned in the assistant reply. Do not include commentary fragments, connective phrases, or anything that is not an actual movie title. Return only JSON matching the schema.",
      text: {
        format: {
          type: "json_schema",
          name: "movie_title_extraction",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              movieTitles: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: ["movieTitles"],
          },
        },
      },
    })

    const parsed = JSON.parse(extraction.output_text) as { movieTitles?: unknown }
    return sanitizeMovieTitles([...sanitizeMovieTitles(parsed.movieTitles), ...markdownTitles])
  } catch (error) {
    console.error("Failed to extract movie titles:", error)
    return markdownTitles
  }
}

async function streamAssistantResponse(options: {
  userMessage: string
  preference: number
  previousResponseId: string | null
  conversationHistory: ConversationHistoryItem[]
  onToken: (delta: string) => void
}): Promise<{ responseText: string; responseId: string | null }> {
  if (!openai) {
    throw new Error("OpenAI API key is not configured. Please add OPENAI_API_KEY to your environment.")
  }

  const instructions = buildInstructions(options.preference)
  const input = buildConversationAwareInput(options.userMessage, options.conversationHistory)

  const runAttempt = async (previousResponseId: string | null) => {
    let responseText = ""
    let responseId: string | null = null
    let sawTokenDelta = false

    const stream = await openai.responses.create({
      model: OPENAI_MODEL,
      instructions,
      input,
      previous_response_id: previousResponseId ?? undefined,
      store: true,
      stream: true,
    })

    for await (const event of stream) {
      if (event.type === "response.output_text.delta" && event.delta) {
        sawTokenDelta = true
        responseText += event.delta
        options.onToken(event.delta)
      } else if (event.type === "response.completed") {
        responseId = event.response.id
        if (!sawTokenDelta && event.response.output_text) {
          responseText = event.response.output_text
          options.onToken(event.response.output_text)
        }
      } else if (event.type === "response.failed") {
        throw new Error(event.response.error?.message ?? "OpenAI response failed.")
      } else if (event.type === "error") {
        throw new Error(event.message || "OpenAI stream error.")
      }
    }

    return { responseText, responseId }
  }

  try {
    return await runAttempt(options.previousResponseId)
  } catch (error) {
    if (options.previousResponseId && shouldRetryWithoutPreviousResponseId(error)) {
      console.warn("Retrying without previous_response_id:", options.previousResponseId)
      return runAttempt(null)
    }
    throw error
  }
}

export async function POST(req: Request) {
  if (!openai) {
    return NextResponse.json(
      { error: "OpenAI API key is not configured. Please add OPENAI_API_KEY to your environment." },
      { status: 500 }
    )
  }

  let body: RecommendationRequestBody
  try {
    body = (await req.json()) as RecommendationRequestBody
  } catch {
    return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 })
  }

  const userMessage = typeof body.userMessage === "string" ? body.userMessage.trim() : ""
  const preference = typeof body.preference === "number" && Number.isFinite(body.preference) ? body.preference : 0.5
  const previousResponseId =
    typeof body.previousResponseId === "string" && body.previousResponseId.trim()
      ? body.previousResponseId.trim()
      : null
  const conversationHistory = sanitizeConversationHistory(body.conversationHistory)

  if (!userMessage) {
    return NextResponse.json({ error: "userMessage is required." }, { status: 400 })
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(createSSEEvent(event, data)))
      }

      try {
        const { responseText, responseId } = await streamAssistantResponse({
          userMessage,
          preference,
          previousResponseId,
          conversationHistory,
          onToken: (delta) => {
            sendEvent("token", { delta })
          },
        })

        const movieTitles = await extractMovieTitlesFromText(responseText)
        sendEvent("metadata", { responseId, movieTitles })
      } catch (error) {
        console.error("Error in getRecommendation:", error)
        sendEvent("error", { message: getErrorMessage(error) })
      } finally {
        sendEvent("done", {})
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
