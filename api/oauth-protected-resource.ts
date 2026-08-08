import type { ServerResponse } from "node:http";
import { writeProtectedResourceMetadata } from "../src/hosted.js";
export const config = { runtime: "nodejs" };
export default function handler(_request: unknown, response: ServerResponse): void { writeProtectedResourceMetadata(response); }

