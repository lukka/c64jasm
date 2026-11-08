import { McpServer, fromJsonSchema, JsonSchemaType } from '@modelcontextprotocol/server';
import type { C64ToolResult } from './c64Tools';

const toolDefinitions: { name: string; displayName: string; modelDescription: string; inputSchema: JsonSchemaType }[] = require('./mcpToolDefinitions.json');

export interface McpToolBackend {
    invoke(name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<C64ToolResult>;
}

export function createMcpServer(backend: McpToolBackend, options: { version: string; mode: 'vscode' | 'standalone' }): McpServer {
    const sessionInstructions = options.mode === 'vscode'
        ? 'Control the c64jasm debugger in this VS Code window. An existing F5 session is shared with the editor; do not start a replacement session. Use status to obtain its sessionId. Source breakpoints are synchronized with the editor. Start uses VS Code launch configurations and tasks.'
        : 'Control a standalone c64jasm debugger, independent of VS Code. Start a session with c64jasm_manageDebugger before reading runtime state. The server owns its VICE process and compiler watcher.';
    const server = new McpServer({ name: 'c64jasm', version: options.version }, {
        instructions: `${sessionInstructions} Source lines are 1-based. Addresses are decimal numbers or hexadecimal strings ($C000, 0xC000, or C000). Memory reads pause execution; use continue to resume. Screenshots and sprite images are PNG content. Source changes are compiled automatically; restart the debug session to load a new build into VICE.`
    });
    for (const definition of toolDefinitions) {
        server.registerTool(definition.name, {
            title: definition.displayName,
            description: definition.modelDescription,
            inputSchema: fromJsonSchema<Record<string, unknown>>(definition.inputSchema as JsonSchemaType),
            annotations: { readOnlyHint: definition.name === 'c64jasm_resolveMapping', openWorldHint: false }
        }, async (input, context) => ({ ...await backend.invoke(definition.name, input, context.mcpReq.signal) }));
    }
    return server;
}
