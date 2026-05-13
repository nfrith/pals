#!/usr/bin/env bun

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { discoverSystemRoot, startPulseRuntime } from "./runtime.ts";

const server = new McpServer({
  name: "als-statusline-pulse",
  version: "2.0.0",
});
server.server.registerCapabilities({
  tools: {
    listChanged: false,
  },
});
server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [],
}));

const runtime = startPulseRuntime({
  systemRoot: discoverSystemRoot(),
});

const shutdown = () => {
  runtime.stop();
};

process.stdin.on("end", shutdown);
process.stdin.on("close", shutdown);

const transport = new StdioServerTransport();
await server.connect(transport);
