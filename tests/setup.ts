import { config } from 'dotenv';

config({ path: '.env' });

process.env.ENCRYPTION_KEY ??=
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
process.env.DATABASE_URL ??= 'postgresql://spendo:spendo@localhost:5432/spendo';
process.env.FINTABLE_DRY_RUN ??= 'true';
process.env.FINTABLE_API_TOKEN ??= '';
process.env.LOG_LEVEL ??= 'error';
