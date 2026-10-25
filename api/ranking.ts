import { createOnlineRuntime } from '../server/runtime.js';
import { createVercelHandler } from '../server/vercel-handler.js';

export default createVercelHandler(async () => {
  const { app } = await createOnlineRuntime({ serverless: true });
  return app;
});
