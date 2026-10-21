import type { IncomingMessage, ServerResponse } from 'node:http';
import { finished } from 'node:stream/promises';
import type { FastifyInstance } from 'fastify';

/** Adapt native HTTP streams without parsing bodies twice or opening a listening socket. */
export function createVercelHandler(createApp: () => Promise<FastifyInstance>) {
  let ready: Promise<FastifyInstance> | undefined;
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      ready ??= createApp()
        .then(async (app) => {
          await app.ready();
          return app;
        })
        .catch((error: unknown) => {
          ready = undefined;
          throw error;
        });
      const app = await ready;
      // Keep the invocation alive until Fastify has finished sending its response.
      const completed = finished(response, { cleanup: true });
      app.server.emit('request', request, response);
      await completed;
    } catch {
      // Startup/transport errors must not expose connection strings or private configuration.
      if (!response.headersSent && !response.destroyed) {
        response.writeHead(503, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(
          JSON.stringify({
            error: 'El servicio en línea no está configurado o no está disponible.',
          }),
        );
      } else if (!response.destroyed) response.destroy();
    }
  };
}
