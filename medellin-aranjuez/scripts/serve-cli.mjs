import { serveDist } from './serve.mjs';

const port = +(process.env.PORT ?? 4190);
await serveDist(port);
console.log(`Sirviendo dist/ en http://localhost:${port}`);
