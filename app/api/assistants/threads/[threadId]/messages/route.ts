import { assistantId } from "@/app/assistant-config";
import { openai } from "@/app/openai";

export const runtime = "nodejs";

// Send a new message to a thread
export async function POST(request, { params: { threadId } }) {
  const { content } = await request.json();

  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: content,
  });

  const stream = openai.beta.threads.runs.stream(threadId, {
    assistant_id: assistantId,
  });

  return new Response(stream.toReadableStream());
}

// Retrieve all messages for a thread
export async function GET(request, { params: { threadId } }) {
    try {
        const messages = await openai.beta.threads.messages.list(threadId);

        return new Response(JSON.stringify(messages), {
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        return new Response(
            JSON.stringify({ error: "Failed to fetch messages", details: error.message }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }
}
