import { getOpenAIClient } from "@/app/openai";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

export const runtime = "nodejs";

function getPromptUrl(): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:3000";
  const token = process.env.PROMPT_API_TOKEN || "";
  const aiType = process.env.PROMPT_AI_TYPE || "Florence"
  return `${base}/api/v1/ai_prompt?ai_type=${encodeURIComponent(aiType)}&token=${encodeURIComponent(token)}`;
}

function extractUrls(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s,)\]}>"']+/g;
  const matches = text.match(urlRegex);
  if (!matches) return [];
  return Array.from(new Set(matches));
}

function resolveUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hash && parsed.hash.length > 1) {
      const fragment = decodeURIComponent(parsed.hash.slice(1));
      if (fragment.endsWith(".html") || fragment.endsWith(".md")) {
        parsed.hash = "";
        parsed.pathname = "/" + fragment.replace(/^\//, "");
        return parsed.toString();
      }
    }
  } catch {}
  return url;
}

async function fetchUrlContent(url: string): Promise<string> {
  try {
    const resolved = resolveUrl(url);
    const res = await fetch(resolved, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Needpedia-Greeter/1.0" },
    });
    if (!res.ok) return "";
    const html = await res.text();
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&[a-z]+;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000);
  } catch {
    return "";
  }
}

async function getMasterPrompt(): Promise<string> {
  const aiType = process.env.PROMPT_AI_TYPE || "Florence";
  console.log(`[Master Prompt] AI Type: ${aiType}`);
  
  try {
    const res = await fetch(getPromptUrl());
    const data = await res.json();
    let prompt = data.prompt || "";
    
    console.log(`[Master Prompt] Present: ${prompt.length > 0 ? "Yes" : "No"}`);
    console.log(`[Master Prompt] Length: ${prompt.length} characters`);

    const urls = extractUrls(prompt);
    if (urls.length > 0) {
      const contents = await Promise.all(
        urls.slice(0, 3).map((url) => fetchUrlContent(url)),
      );
      const sources = urls.slice(0, 3).map((url, i) => {
        const content = contents[i];
        return content
          ? `Source: ${url}\nContent: ${content}`
          : `Source: ${url} (unavailable)`;
      }).join("\n\n");
      prompt += "\n\n---\nThe following source content is available for reference:\n\n" + sources;
    }

    return prompt;
  } catch (error) {
    console.error("Failed to fetch master prompt:", error);
    return "";
  }
}

// collect_signup_info: creates a one-time, short-lived draft on Needpedia.
// Only name + email ever leave the chat — passwords stay on the signup page.
const TOOLS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "collect_signup_info",
      description:
        "Save the visitor's name and email, then return a one-time signup link. Call ONLY after the visitor has explicitly provided BOTH their full name and email address in this conversation. Never ask for or pass passwords.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Full name the visitor provided" },
          email: { type: "string", description: "Email address the visitor provided" },
        },
        required: ["name", "email"],
      },
    },
  },
];

export async function POST(request: Request) {
  const { messages } = await request.json();
  const openai = getOpenAIClient();

  const masterPrompt = await getMasterPrompt();
  
  console.log(`[Chat] Master prompt loaded: ${masterPrompt ? "Yes" : "No"}`);
  console.log(`[Chat] Messages count: ${messages.length}`);

  const fullMessages = masterPrompt
    ? [{ role: "system" as const, content: masterPrompt }, ...messages]
    : messages;

  const stream = await openai.chat.completions.create({
    model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    messages: fullMessages,
    tools: TOOLS,
    temperature: 0.2,
    stream: true,
  });

  return new Response(stream.toReadableStream());
}
