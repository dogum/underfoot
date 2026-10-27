/**
 * Underfoot as an MCP server over stdio. Answers are kept on disk between
 * runs in ~/.cache/underfoot (UNDERFOOT_CACHE names another folder, or "off").
 *
 *   { "mcpServers": { "underfoot": { "command": "node", "args": ["dist-headless/underfoot-mcp.mjs"] } } }
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { useNode } from '../headless/node';
import { createServer } from './server';

const env = process.env.UNDERFOOT_CACHE,
  cacheDir =
    env === 'off' ? null : env || join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'underfoot');
await useNode({ cacheDir });
await createServer().connect(new StdioServerTransport());
