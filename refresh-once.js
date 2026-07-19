import { refresh } from './lib/refresh.js';
refresh().catch((err) => {
  console.error(err);
  process.exit(1);
});
