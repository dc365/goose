'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const BrowserConnector = require('../capabilities/browser-connector.js');
const BrowserRuntime = require('../capabilities/browser-runtime.cjs');

function textContent(result) {
  return (result?.content || []).map((item) => item.text || '').join('\n');
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

class StdioMcpClient {
  constructor(command, args, cwd, env = {}) {
    this.nextId = 0;
    this.buffer = '';
    this.stderr = '';
    this.pending = new Map();
    this.child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child.stdout.on('data', (chunk) => this.onStdout(chunk));
    this.child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-8000);
    });
    this.child.on('exit', (code, signal) => {
      const error = new Error(`Playwright MCP exited before completing the test (code=${code}, signal=${signal})\n${this.stderr}`);
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
  }

  onStdout(chunk) {
    this.buffer += chunk.toString();
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || '';
    for (const line of lines) {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message || 'MCP request failed'));
      else pending.resolve(message.result);
    }
  }

  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${method} timed out\n${this.stderr}`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  notify(method, params = {}) {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  async tool(name, args = {}) {
    const result = await this.call('tools/call', { name, arguments: args });
    if (result?.isError) throw new Error(`${name} failed: ${textContent(result)}`);
    return result;
  }

  close() {
    if (!this.child.killed) this.child.kill('SIGTERM');
  }
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'meteomate-browser-test-'));
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>
      <html><body>
        <h1>MeteoMate Browser Check</h1>
        <label>City <input id="city" /></label>
        <button id="check-weather" onclick="document.querySelector('#result').textContent = 'Weather checked: ' + document.querySelector('#city').value">Check weather</button>
        <p id="result">Waiting</p>
      </body></html>`);
  });
  const port = await listen(server);
  const runtime = BrowserRuntime.resolveBrowserRuntime({
    productRoot: path.resolve(__dirname, '..'),
    mcpPackage: BrowserConnector.MCP_PACKAGE,
  });
  const args = [...runtime.argsPrefix, ...BrowserConnector.PRESET.args, '--output-dir', temp];
  const client = new StdioMcpClient(runtime.command, args, temp, runtime.env);

  try {
    await client.call('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'meteomate-browser-test', version: '1.0.0' },
    });
    client.notify('notifications/initialized');

    const listed = await client.call('tools/list');
    const discovered = new Set((listed.tools || []).map((tool) => tool.name));
    for (const tool of BrowserConnector.SAFE_TOOLS) {
      assert.ok(discovered.has(tool), `Playwright MCP is missing required tool ${tool}`);
    }
    for (const tool of BrowserConnector.BLOCKED_TOOLS) {
      assert.ok(discovered.has(tool), `Pinned Playwright MCP contract changed for ${tool}`);
      assert.ok(!BrowserConnector.SAFE_TOOLS.includes(tool), `${tool} must remain blocked`);
    }

    await client.tool('browser_navigate', { url: `http://127.0.0.1:${port}` });
    const initial = textContent(await client.tool('browser_snapshot'));
    assert.match(initial, /MeteoMate Browser Check/);

    await client.tool('browser_type', { target: '#city', text: 'Taipei' });
    await client.tool('browser_click', { target: '#check-weather' });
    const completed = textContent(await client.tool('browser_snapshot'));
    assert.match(completed, /Weather checked: Taipei/);

    await client.tool('browser_take_screenshot', {
      type: 'png',
      scale: 'css',
      filename: 'browser-live-smoke.png',
    });
    assert.ok(fs.existsSync(path.join(temp, 'browser-live-smoke.png')));
    await client.tool('browser_close');
    console.log(`MeteoMate browser integration passed (${BrowserConnector.SAFE_TOOLS.length} safe tools, navigation, input, click, screenshot).`);
  } finally {
    client.close();
    await closeServer(server);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
