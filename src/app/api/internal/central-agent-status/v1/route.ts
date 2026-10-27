import {
  centralAgentStatusGet,
  centralAgentStatusMethodNotAllowed,
} from "@/lib/central-agent-status/handler";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return centralAgentStatusGet(request);
}

export async function POST() {
  return centralAgentStatusMethodNotAllowed();
}

export async function PUT() {
  return centralAgentStatusMethodNotAllowed();
}

export async function PATCH() {
  return centralAgentStatusMethodNotAllowed();
}

export async function DELETE() {
  return centralAgentStatusMethodNotAllowed();
}
