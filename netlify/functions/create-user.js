// Admin-only account creation. Uses the SERVICE ROLE key, which exists only in Netlify env vars (never in the browser).
const { createClient } = require('@supabase/supabase-js');
const json = (s, b) => ({ statusCode: s, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const UUID = /^[0-9a-f-]{36}$/i, EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const token = (event.headers.authorization || '').replace(/^Bearer /i, '');
  const { data: { user } } = await sb.auth.getUser(token);
  if (!user) return json(401, { error: 'Not signed in' });
  const { data: caller } = await sb.from('profiles').select('role,active').eq('id', user.id).single();
  if (!caller || caller.role !== 'admin' || !caller.active) return json(403, { error: 'Admins only' });

  let b; try { b = JSON.parse(event.body); } catch { return json(400, { error: 'Invalid request' }); }
  const { role, full_name, email, password, admission_no, class_id } = b;
  if (!['admin', 'teacher', 'student'].includes(role)) return json(400, { error: 'Invalid role' });
  if (typeof full_name !== 'string' || full_name.trim().length < 2 || full_name.length > 100) return json(400, { error: 'Enter a valid name' });
  if (!EMAIL.test(email || '')) return json(400, { error: 'Enter a valid email' });
  if (typeof password !== 'string' || password.length < 10) return json(400, { error: 'Password must be at least 10 characters' });
  if (role === 'student' && (!admission_no || !UUID.test(class_id || ''))) return json(400, { error: 'Students need an admission number and a class' });

  const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) return json(400, { error: error.message });
  const id = data.user.id;
  let r = await sb.from('profiles').insert({ id, role, full_name: full_name.trim(), email });
  if (!r.error && role === 'student') r = await sb.from('students').insert({ id, admission_no: admission_no.trim(), full_name: full_name.trim(), class_id });
  if (r.error) { await sb.auth.admin.deleteUser(id); return json(400, { error: r.error.message }); }
  return json(200, { ok: true });
};
