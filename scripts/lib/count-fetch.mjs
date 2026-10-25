/* Loaded into the MCP server's process by scripts/validate-mcp.mjs (node
 * --import): every request the server asks is written to stderr with its
 * time, so the script can count them from outside. */
const net = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  process.stderr.write(`fetch ${Date.now()} ${u.slice(0, 120)}\n`);
  return net(input, init);
};
