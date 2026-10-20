import { mkdir,writeFile } from 'node:fs/promises';
await mkdir('deployment/static',{recursive:true});
await writeFile('deployment/static/.keep','');
