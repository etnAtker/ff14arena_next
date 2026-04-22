import { startServer } from './app';

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
