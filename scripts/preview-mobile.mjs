import express from 'express';
import { resolve } from 'node:path';
const app = express();
app.use(express.static(resolve('apps/mobile/dist')));
app.get('/{*path}', (_req, res) => res.sendFile(resolve('apps/mobile/dist/index.html')));
const server = app.listen(8095, '0.0.0.0', (error) => {
  if (error) {
    console.error(error);
    process.exitCode = 1;
    return;
  }
  console.log('Ahia mobile web preview: http://localhost:8095');
});
