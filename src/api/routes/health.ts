import type { FastifyInstance } from 'fastify';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/health',
    {
      schema: {
        tags: ['System'],
        summary: 'Health check',
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              service: { type: 'string' },
              company: { type: 'string' },
            },
          },
        },
      },
    },
    async () => ({
      status: 'ok',
      service: 'Spendo',
      company: 'arfly',
    }),
  );
}
