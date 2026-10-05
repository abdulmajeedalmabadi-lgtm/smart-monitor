import { randomBytes } from 'node:crypto';
for(const name of ['IOT_API_KEY'])console.log(`${name}=${randomBytes(32).toString('base64url')}`);
console.log('Keep these values private. Use different values for production and development.');
