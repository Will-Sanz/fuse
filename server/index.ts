import { createReviewApp } from './review-server';
const { app, close } = createReviewApp({ dataDir: process.env.FUSE_DEMO_DIR });
const port = Number(process.env.PORT || 3001);
const server = app.listen(port, '127.0.0.1', () =>
  console.log(`Fuse demo: http://127.0.0.1:${port}`),
);
const stop = () =>
  server.close(() => {
    close();
    process.exit(0);
  });
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
