'use strict';

const http = require('node:http');

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.once('error', reject);
  });
}

function json(response, statusCode, payload, headers = {}) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

async function startWeatherProviderMock(options = {}) {
  const {
    dataset,
    delayMs = 1_250,
    oversizedBytes = 4_096,
    statusCode = 500,
    routes = {},
  } = options;
  const requests = [];
  const sockets = new Set();
  const timers = new Set();
  let redirectTarget = '';

  const builtInRoutes = {
    '/valid': async ({ response }) => {
      json(response, 200, {
        apiVersion: 'meteomate.weather.provider/v1',
        kind: 'WeatherDatasetResponse',
        dataset,
      });
    },
    '/malformed': async ({ response }) => {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end('{"dataset":');
    },
    '/status': async ({ response }) => {
      json(response, statusCode, { error: 'upstream unavailable' });
    },
    '/secret-error': async ({ request, response }) => {
      json(response, statusCode, { error: request.headers['x-api-key'] || 'upstream unavailable' });
    },
    '/wrong-envelope': async ({ response }) => {
      json(response, 200, {
        apiVersion: 'meteomate.weather.provider/v999',
        kind: 'WeatherDatasetResponse',
        dataset,
      });
    },
    '/bare-dataset': async ({ response }) => {
      json(response, 200, dataset);
    },
    '/reset': async ({ response }) => {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.write('{"apiVersion":"meteomate.weather.provider/v1","kind":"WeatherDatasetResponse","dataset":');
      response.destroy();
    },
    '/oversize': async ({ response }) => {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.write('{"padding":"');
      let remaining = oversizedBytes;
      while (remaining > 0 && !response.destroyed) {
        const chunkSize = Math.min(256, remaining);
        response.write('x'.repeat(chunkSize));
        remaining -= chunkSize;
      }
      if (!response.destroyed) response.end('"}');
    },
    '/delay': async ({ request, response }) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!response.destroyed && !response.writableEnded) {
          json(response, 200, {
            apiVersion: 'meteomate.weather.provider/v1',
            kind: 'WeatherDatasetResponse',
            dataset,
          });
        }
      }, delayMs);
      timers.add(timer);
      request.once('close', () => {
        if (!response.writableEnded) {
          clearTimeout(timer);
          timers.delete(timer);
        }
      });
    },
    '/redirect': async ({ response, url }) => {
      const location = url.searchParams.get('target') || redirectTarget || '/valid';
      response.writeHead(302, { Location: location });
      response.end();
    },
    '/wrong-content-type': async ({ response }) => {
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(JSON.stringify({
        apiVersion: 'meteomate.weather.provider/v1',
        kind: 'WeatherDatasetResponse',
        dataset,
      }));
    },
  };

  const server = http.createServer(async (request, response) => {
    response.once('error', () => {});
    try {
      const body = await readRequestBody(request);
      const url = new URL(request.url || '/', 'http://weather-provider.test');
      requests.push({
        method: String(request.method || 'GET').toUpperCase(),
        path: url.pathname,
        url: request.url || '/',
        headers: { ...request.headers },
        body,
      });
      const handler = routes[url.pathname] || builtInRoutes[url.pathname];
      if (!handler) {
        json(response, 404, { error: 'route not found' });
        return;
      }
      await handler({
        request,
        response,
        url,
        body,
        dataset,
        requests,
      });
    } catch (error) {
      if (!response.headersSent) json(response, 500, { error: error.message });
      else if (!response.destroyed) response.destroy(error);
    }
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  let closed = false;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    resetRequests() {
      requests.splice(0);
    },
    setRedirectTarget(target) {
      redirectTarget = String(target || '');
    },
    async close() {
      if (closed) return;
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

module.exports = {
  startWeatherProviderMock,
};
