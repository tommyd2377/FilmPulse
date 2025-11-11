import { NextResponse } from "next/server"
import OpenAI from "openai"

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(req: Request) {
  try {
    const { messages } = await req.json()

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("Invalid or empty messages array")
    }

    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: messages,
    })

    if (!response.choices || response.choices.length === 0) {
      throw new Error("No response choices from OpenAI")
    }

    return NextResponse.json({ recommendation: response.choices[0].message.content })
  } catch (error: unknown) {
    console.error("Error in getRecommendation:", error)
    const message = error instanceof Error ? error.message : "Failed to get recommendation"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

