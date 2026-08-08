import type { IncomingMessage, ServerResponse } from "node:http";
import { handleMcpNodeRequest } from "../src/hosted.js";
export const config = { runtime: "nodejs", maxDuration: 60 };
export default async function handler(request: IncomingMessage & { body?: unknown }, response: ServerResponse): Promise<void> {
  await handleMcpNodeRequest(request, response);
}

