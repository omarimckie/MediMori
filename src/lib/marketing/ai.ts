import { getAiComplexModel, getAiSimpleModel, getOpenAiKey, isMockMode } from "./config";
import { logMarketing } from "./logger";

export type AiTaskComplexity = "simple" | "complex";

export type AiGenerateInput = {
  task: string;
  prompt: string;
  complexity?: AiTaskComplexity;
  cacheKey?: string;
};

export type AiStructuredInput<T> = AiGenerateInput & {
  fallback: T;
};

export interface AIProvider {
  id: string;
  generateText(input: AiGenerateInput): Promise<string>;
  generateStructuredOutput<T>(input: AiStructuredInput<T>): Promise<T>;
  classify(input: AiGenerateInput): Promise<string>;
  analyze(input: AiGenerateInput): Promise<string>;
}

const textCache = new Map<string, string>();

export class MockAIProvider implements AIProvider {
  id = "mock";

  async generateText(input: AiGenerateInput): Promise<string> {
    return `[mock:${input.task}] ${input.prompt.slice(0, 180)}`;
  }

  async generateStructuredOutput<T>(input: AiStructuredInput<T>): Promise<T> {
    return input.fallback;
  }

  async classify(input: AiGenerateInput): Promise<string> {
    return `mock-class:${input.task}`;
  }

  async analyze(input: AiGenerateInput): Promise<string> {
    return `Mock analysis for ${input.task}.`;
  }
}

export class OpenAIProvider implements AIProvider {
  id = "openai";

  constructor(private readonly apiKey: string) {}

  private modelFor(complexity: AiTaskComplexity = "simple") {
    return complexity === "complex" ? getAiComplexModel() : getAiSimpleModel();
  }

  private async complete(input: AiGenerateInput): Promise<string> {
    const cacheKey = input.cacheKey;
    if (cacheKey && textCache.has(cacheKey)) {
      return textCache.get(cacheKey) as string;
    }

    const started = Date.now();
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.modelFor(input.complexity),
        messages: [
          {
            role: "system",
            content:
              "You are a marketing copilot for Twilight Feather children's health storybooks. Never invent medical facts, testimonials, statistics, or partnerships. Stay inside the provided approved context.",
          },
          { role: "user", content: input.prompt },
        ],
        temperature: input.complexity === "complex" ? 0.4 : 0.2,
      }),
    });

    if (!response.ok) {
      const error = `OpenAI HTTP ${response.status}`;
      logMarketing({
        operation: input.task,
        provider: this.id,
        success: false,
        durationMs: Date.now() - started,
        error,
      });
      throw new Error(error);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim() || "";
    if (cacheKey) textCache.set(cacheKey, text);
    return text;
  }

  async generateText(input: AiGenerateInput): Promise<string> {
    return this.complete(input);
  }

  async generateStructuredOutput<T>(input: AiStructuredInput<T>): Promise<T> {
    try {
      const text = await this.complete({
        ...input,
        prompt: `${input.prompt}\n\nReturn JSON only.`,
      });
      const jsonStart = text.indexOf("{");
      const jsonEnd = text.lastIndexOf("}");
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        return JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as T;
      }
      return input.fallback;
    } catch {
      return input.fallback;
    }
  }

  async classify(input: AiGenerateInput): Promise<string> {
    return this.complete({ ...input, complexity: "simple" });
  }

  async analyze(input: AiGenerateInput): Promise<string> {
    return this.complete({ ...input, complexity: input.complexity ?? "complex" });
  }
}

export function getAIProvider(): AIProvider {
  if (isMockMode()) return new MockAIProvider();
  const key = getOpenAiKey();
  if (!key) return new MockAIProvider();
  return new OpenAIProvider(key);
}

export function estimatedAiCostUsd(complexity: AiTaskComplexity): number {
  if (isMockMode()) return 0;
  return complexity === "complex" ? 0.04 : 0.005;
}
