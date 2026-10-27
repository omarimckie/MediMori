import { centralAgentManagerAgentConsumerResponse } from "@/lib/central-agent-manager/agent-consumer-handler";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return centralAgentManagerAgentConsumerResponse(request);
}

export async function POST(request: Request) {
  return centralAgentManagerAgentConsumerResponse(request);
}

export async function PUT() {
  return Response.json({ error: "Method not allowed." }, { status: 405 });
}

export async function PATCH() {
  return Response.json({ error: "Method not allowed." }, { status: 405 });
}

export async function DELETE() {
  return Response.json({ error: "Method not allowed." }, { status: 405 });
}
