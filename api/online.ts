import { createOnlineRuntime } from '../server/runtime';
import { createVercelHandler } from '../server/vercel-handler';

export default createVercelHandler(async () => {
  const { app } = await createOnlineRuntime({ serverless: true });
  return app;
});
