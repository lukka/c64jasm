import { createMcpServer, McpToolBackend } from '../../client/src/mcpServer';
import { version } from '../package.json';

export function createServer(controller: McpToolBackend) {
    return createMcpServer(controller, { version, mode: 'standalone' });
}
