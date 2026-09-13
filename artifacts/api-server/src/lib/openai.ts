import OpenAI from "openai";

let client: OpenAI | null = null;
let healthCache:
  | { checkedAt: number; value: { status: string; model: string; message: string } }
  | undefined;

export const openAIConfigured = () =>
  Boolean(process.env.OPENAI_API_KEY?.trim() && !process.env.OPENAI_API_KEY.startsWith("your_"));

export const openAIModel = () => process.env.OPENAI_MODEL || "gpt-5-mini";
export type OnkarModelRole = "master" | "insight" | "journal";
export const onkarAIModel = (role: OnkarModelRole) =>
  process.env[`${role.toUpperCase()}_AI_MODEL`] || openAIModel();
export const onkarReasoningEffort = (deep = false): "low" | "medium" | "high" => {
  if (deep) return "high";
  const configured = process.env.AI_REASONING_LEVEL;
  return configured === "medium" || configured === "high" ? configured : "low";
};

export function getOpenAI() {
  if (!openAIConfigured())
    throw new Error("OpenAI is not configured. Add OPENAI_API_KEY on the server.");
  client ??= new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 25_000,
    maxRetries: 2,
  });
  return client;
}

export async function openAIHealth(force = false) {
  if (!openAIConfigured())
    return {
      status: "unconfigured",
      model: openAIModel(),
      message: "OPENAI_API_KEY is not configured",
    };
  if (!force && healthCache && Date.now() - healthCache.checkedAt < 300_000)
    return healthCache.value;
  const model = openAIModel();
  try {
    await getOpenAI().models.retrieve(model);
    const value = {
      status: "connected",
      model,
      message: "OpenAI key and model access verified",
    };
    healthCache = { checkedAt: Date.now(), value };
    return value;
  } catch {
    const value = {
      status: "offline",
      model,
      message: "OpenAI could not verify model access",
    };
    healthCache = { checkedAt: Date.now(), value };
    return value;
  }
}

export async function structuredResponse<T>({
  name,
  instructions,
  input,
  schema,
  maxOutputTokens = 2400,
  model: requestedModel,
  reasoningEffort,
}: {
  name: string;
  instructions: string;
  input: string;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high";
}) {
  const model = requestedModel || openAIModel();
  const response = await getOpenAI().responses.create({
    model,
    instructions,
    input,
    max_output_tokens: maxOutputTokens,
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
    text: {
      format: {
        type: "json_schema",
        name,
        strict: true,
        schema,
      },
    },
  });
  if (!response.output_text) throw new Error("OpenAI returned no text output");
  return {
    output: JSON.parse(response.output_text) as T,
    model,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}
