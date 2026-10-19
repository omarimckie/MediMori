import {
  centralAgentRuntimeDbProbeGet,
  centralAgentRuntimeDbProbeMethodNotAllowed,
} from "@/lib/central-agent-runtime-db-probe/handler";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return centralAgentRuntimeDbProbeGet(request);
}

export async function POST() {
  return centralAgentRuntimeDbProbeMethodNotAllowed();
}

export async function PUT() {
  return centralAgentRuntimeDbProbeMethodNotAllowed();
}

export async function PATCH() {
  return centralAgentRuntimeDbProbeMethodNotAllowed();
}

export async function DELETE() {
  return centralAgentRuntimeDbProbeMethodNotAllowed();
}
