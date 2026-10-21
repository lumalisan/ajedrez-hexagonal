import { createOnlineRuntime } from './runtime.js';

const { app, service } = await createOnlineRuntime();
let sweeping = false;
const timer = setInterval(() => {
  if (sweeping) return;
  sweeping = true;
  void service
    .tick()
    .catch((error: unknown) => app.log.error(error, 'Clock sweep failed'))
    .finally(() => {
      sweeping = false;
    });
}, 1_000);
timer.unref();
app.addHook('onClose', async () => {
  clearInterval(timer);
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close();
  });
await app.listen({
  host: process.env.API_HOST ?? '127.0.0.1',
  port: Number(process.env.API_PORT ?? 3001),
});
