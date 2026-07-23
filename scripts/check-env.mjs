import { existsSync, readFileSync } from 'node:fs';

function loadLocalEnv() {
  for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;

    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const [key, ...valueParts] = trimmed.split('=');
      process.env[key] = process.env[key] ?? valueParts.join('=');
    }
  }
}

loadLocalEnv();

const required = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.log(`Missing optional local env vars: ${missing.join(', ')}`);
  console.log('The app has safe fallbacks from .env.example for this project.');
  process.exit(0);
}

console.log('Supabase environment variables are present.');
