import type OpenAI from "openai"
import type {
  Response,
  ResponseCreateParamsNonStreaming,
  ResponseStreamEvent,
} from "openai/resources/responses/responses"

export interface ResponseStreamOptions {
  signal?: AbortSignal
  timeout?: number
  onTextDelta?: (delta: string, text: string) => void | Promise<void>
  onEvent?: (event: ResponseStreamEvent) => void | Promise<void>
}

function abortError(): Error {
  const error = new Error("The OpenAI response was cancelled.")
  error.name = "AbortError"
  return error
}

function responseText(response: Response): string {
  const outputText = response.output
    .flatMap((item) => item.type === "message" ? item.content : [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("")

  return outputText || response.output_text || ""
}

/** Owns the SDK stream's only reader; callers consume events and text, never its HTTP body. */
export async function createResponseStream(
  client: OpenAI,
  params: Omit<ResponseCreateParamsNonStreaming, "stream">,
  options: ResponseStreamOptions = {}
): Promise<Response> {
  if (options.signal?.aborted) {
    throw abortError()
  }

  const controller = new AbortController()
  const cancel = () => controller.abort()
  options.signal?.addEventListener("abort", cancel, { once: true })
  let timedOut = false
  const timeout = options.timeout ?? 120_000
  const deadline = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeout)
  let streamController: AbortController | undefined
  let text = ""
  const assertActive = () => {
    if (controller.signal.aborted || streamController?.signal.aborted) {
      if (timedOut) {
        const error = new Error("The OpenAI response timed out before completion.")
        error.name = "TimeoutError"
        throw error
      }
      throw abortError()
    }
  }

  try {
    const stream = await client.responses.create(
      { ...params, stream: true },
      { signal: controller.signal, timeout, maxRetries: 0 }
    )
    streamController = stream.controller

    for await (const event of stream) {
      assertActive()

      await options.onEvent?.(event)
      assertActive()

      if (event.type === "response.output_text.delta") {
        text += event.delta
        await options.onTextDelta?.(event.delta, text)
        assertActive()
      } else if (event.type === "response.completed") {
        if (event.response.status !== "completed") {
          throw new Error(`The OpenAI response ended with status ${event.response.status ?? "unknown"}.`)
        }
        const outputText = responseText(event.response) || text
        if (!outputText.trim()) {
          throw new Error("The OpenAI response completed without text output.")
        }
        return { ...event.response, output_text: outputText }
      } else if (event.type === "response.failed") {
        throw new Error(event.response.error?.message || "The OpenAI response failed.")
      } else if (event.type === "response.incomplete") {
        throw new Error(`The OpenAI response was incomplete${event.response.incomplete_details?.reason ? `: ${event.response.incomplete_details.reason}` : ""}.`)
      } else if (event.type === "error") {
        throw new Error(event.message || "The OpenAI response stream failed.")
      }
    }

    assertActive()
    throw new Error("The OpenAI response stream ended before completion.")
  } catch (error) {
    if (controller.signal.aborted) {
      assertActive()
    }
    throw error
  } finally {
    clearTimeout(deadline)
    options.signal?.removeEventListener("abort", cancel)
    // The SDK also closes its iterator on return/error. Abort only if it has not already done so.
    if (streamController && !streamController.signal.aborted) {
      streamController.abort()
    }
  }
}
