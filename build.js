// Runs on Netlify at build time: writes public config from environment variables.
// Only the PUBLIC anon key goes to the browser. Real protection comes from RLS in the database.
const fs = require('fs');
const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error('Set SUPABASE_URL and SUPABASE_ANON_KEY in Netlify environment variables');
fs.mkdirSync('public', { recursive: true });
fs.writeFileSync('public/config.js', 'window.ENV=' + JSON.stringify({ SUPABASE_URL, SUPABASE_ANON_KEY, SCHOOL_NAME: process.env.SCHOOL_NAME || '' }) + ';');
