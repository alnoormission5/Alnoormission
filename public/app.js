const sb = supabase.createClient(ENV.SUPABASE_URL, ENV.SUPABASE_ANON_KEY);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => Math.round(v * 100) / 100;
const q = async p => { const { data, error } = await p; if (error) throw error; return data; };
const safe = f => async (...a) => { try { await f(...a); } catch (e) { toast(e.message || 'Something went wrong', 1); } };
const opts = (rows, l) => rows.map(r => `<option value="${esc(r.id)}">${esc(l(r))}</option>`).join('');
const cls = c => `${c.name}-${c.section}`;
const tbl = (h, r) => `<div class="tw"><table><thead><tr>${h.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${r.map(x => `<tr>${x.map(c => `<td>${c}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${h.length}" class="mut">Nothing here yet.</td></tr>`}</tbody></table></div>`;
function toast(m, bad) { const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.setAttribute('role', 'status'); t.textContent = m; document.body.append(t); setTimeout(() => t.remove(), 4000); }
function busy(b, on) { b.dataset.t ??= b.textContent; b.disabled = on; b.textContent = on ? 'Please wait…' : b.dataset.t; }
let me = null;

function login() {
  $('#app').innerHTML = `<main class="login"><form id="lf" class="card"><h1>AL Noor Mission School</h1>
  <label>Email<input type="email" name="e" required autocomplete="username"></label>
  <label>Password<input type="password" name="p" required autocomplete="current-password"></label>
  <button class="pri">Sign in</button></form></main>`;
  $('#lf').onsubmit = async ev => {
    ev.preventDefault(); const f = ev.target, b = f.querySelector('button'); busy(b, 1);
    const { error } = await sb.auth.signInWithPassword({ email: f.e.value.trim(), password: f.p.value });
    busy(b, 0); error ? toast('Email or password is incorrect', 1) : start();
  };
}

async function start() {
  const { data: { user } } = await sb.auth.getUser(); if (!user) return login();
  const { data } = await sb.from('profiles').select('*').eq('id', user.id).single();
  if (!data || !data.active) { await sb.auth.signOut(); login(); return toast('This account is not active. Contact the school office.', 1); }
  me = data;
  const tabs = { admin: [['Performance', adminPerf], ['People', adminPeople], ['Setup', adminSetup], ['Attendance', attendanceView], ['Holidays', holidaysView], ['Audit log', adminAudit], ['Report cards', reportView], ['Result access', resultAccessView]], teacher: [['Enter marks', teacherView], ['Attendance', attendanceView], ['Report cards', reportView]], student: [['My results', studentView], ['My attendance', myAttendance]] }[me.role];
  $('#app').innerHTML = `<header><b>AL Noor Mission School</b><nav id="nav">${tabs.map((t, i) => `<button data-i="${i}">${t[0]}</button>`).join('')}</nav><span>${esc(me.full_name)} (${me.role}) <button id="out">Sign out</button></span></header><main id="main"></main>`;
  const go = async i => {
    [...$('#nav').children].forEach((b, j) => b.classList.toggle('on', i === j));
    $('#main').innerHTML = '<p class="mut">Loading…</p>';
    try { await tabs[i][1]($('#main')); } catch (e) { $('#main').innerHTML = `<p class="err">Could not load this page: ${esc(e.message)}</p>`; }
  };
  $('#nav').onclick = e => e.target.dataset.i && go(+e.target.dataset.i);
  $('#out').onclick = async () => { await sb.auth.signOut(); me = null; login(); };
  go(0);
}

/* ---------- STUDENT ---------- */
async function studentView(el) {
    const blk = await q(sb.from('result_blocks').select('message').maybeSingle());
  if (blk) return el.innerHTML = `<h2>My results</h2><div class="card" style="border-left:5px solid var(--err)"><h3>Results are on hold</h3><p>${esc(blk.message)}</p><p class="mut">Please contact the school office.</p></div>`;
  const [m, ex, sub] = await Promise.all([q(sb.from('marks').select('exam_id,subject_id,marks_obtained,max_marks')), q(sb.from('exams').select('id,name').order('name')), q(sb.from('subjects').select('id,name'))]);
  const sn = Object.fromEntries(sub.map(s => [s.id, s.name]));
  let T = 0, M = 0, pcts = [], h = '';
  for (const e of ex) {
    const r = m.filter(x => x.exam_id === e.id); if (!r.length) continue;
    const t = r.reduce((a, x) => a + +x.marks_obtained, 0), mx = r.reduce((a, x) => a + +x.max_marks, 0);
    T += t; M += mx; pcts.push(100 * t / mx);
    h += `<section class="card"><h3>${esc(e.name)}</h3>${tbl(['Subject', 'Marks', 'Out of', 'Percentage'], r.map(x => [esc(sn[x.subject_id]), x.marks_obtained, x.max_marks, num(100 * x.marks_obtained / x.max_marks) + '%']))}<p><b>Total ${num(t)}/${num(mx)} · ${num(100 * t / mx)}% · Average ${num(t / r.length)} per subject</b></p></section>`;
  }
  el.innerHTML = `<h2>My results</h2>` + (M ? `<div class="stats"><div class="card stat"><span class="mut">Overall percentage</span><b>${num(100 * T / M)}%</b></div><div class="card stat"><span class="mut">Total marks</span><b>${num(T)}/${num(M)}</b></div><div class="card stat"><span class="mut">Average across exams</span><b>${num(pcts.reduce((a, b) => a + b, 0) / pcts.length)}%</b></div></div>` + h : '<p>No marks have been entered for you yet.</p>');
}

/* ---------- TEACHER ---------- */
/* ---------- TEACHER ---------- */
async function teacherView(el) {
  const [as, ex] = await Promise.all([
    q(sb.from('teacher_assignments').select('class_id,subject_id,classes(name,section),subjects(name)')),
    q(sb.from('exams').select('id,name,max_marks').order('name'))
  ]);
  if (!as.length) return el.innerHTML = '<p>No classes are assigned to you yet. Contact the administrator.</p>';
  if (!ex.length) return el.innerHTML = '<p>No exams exist yet. Contact the administrator.</p>';
  const classes = [...new Map(as.map(x => [x.class_id, x.classes])).entries()];
  el.innerHTML = `<h2>Enter marks</h2><div class="card row">
    <label>Class<select id="a">${classes.map(([id, c]) => `<option value="${esc(id)}">${esc(cls(c))}</option>`).join('')}</select></label>
    <label>Exam<select id="e">${ex.map((x, i) => `<option value="${i}">${esc(x.name)} (max ${x.max_marks} per subject)</option>`).join('')}</select></label>
    <button id="ld" class="pri">Load students</button></div><div id="grid"></div>`;

  $('#ld').onclick = safe(async () => {
    const cid = $('#a').value, e = ex[$('#e').value];
    const subs = as.filter(x => x.class_id === cid).map(x => ({ id: x.subject_id, name: x.subjects.name })).sort((a, b) => a.name.localeCompare(b.name));
    const st = await q(sb.from('students').select('id,admission_no,full_name').eq('class_id', cid).order('admission_no'));
    const mk = await q(sb.from('marks').select('student_id,subject_id,marks_obtained').eq('exam_id', e.id).in('subject_id', subs.map(s => s.id)));
    const cur = Object.fromEntries(mk.map(x => [x.student_id + '|' + x.subject_id, x.marks_obtained]));

    const heads = ['Student', ...subs.map(s => `${esc(s.name)} (/${e.max_marks})`), 'Total', 'Percentage'];
    const rows = st.map(s => [
      `${esc(s.full_name)}<div class="mut" style="font-size:12px">${esc(s.admission_no)}</div>`,
      ...subs.map(sj => `<input type="number" class="mk" data-st="${esc(s.id)}" data-sb="${esc(sj.id)}" min="0" max="${e.max_marks}" step="0.01" value="${cur[s.id + '|' + sj.id] ?? ''}" aria-label="${esc(sj.name)} marks for ${esc(s.full_name)}">`),
      '<span class="tt"></span>', '<span class="pc"></span>'
    ]);
    $('#grid').innerHTML = `<div class="card">${tbl(heads, rows)}<p id="avg" class="mut"></p><button id="sv" class="pri">Save marks</button></div>`;

    const calc = () => {
      document.querySelectorAll('#grid tbody tr').forEach(tr => {
        let t = 0, n = 0;
        tr.querySelectorAll('.mk').forEach(i => { if (i.value !== '') { t += +i.value; n++; } });
        tr.querySelector('.tt').textContent = n ? `${num(t)}/${num(n * e.max_marks)}` : '';
        tr.querySelector('.pc').textContent = n ? num(100 * t / (n * e.max_marks)) + '%' : '';
      });
      $('#avg').textContent = 'Class average: ' + subs.map(sj => {
        const v = [...document.querySelectorAll('.mk')].filter(i => i.dataset.sb === sj.id && i.value !== '').map(i => +i.value);
        return `${sj.name} ${v.length ? num(v.reduce((a, b) => a + b, 0) / v.length) : '-'}`;
      }).join(' · ');
    };
    $('#grid').oninput = calc; calc();

    $('#sv').onclick = safe(async ev => {
      const out = [];
      for (const i of document.querySelectorAll('.mk')) {
        if (i.value === '') continue;
        const v = +i.value;
        if (!(v >= 0 && v <= e.max_marks)) return toast(`Marks must be between 0 and ${e.max_marks}`, 1);
        out.push({ student_id: i.dataset.st, subject_id: i.dataset.sb, exam_id: e.id, marks_obtained: v });
      }
      if (!out.length) return toast('Enter at least one mark', 1);
      busy(ev.target, 1);
      try { await q(sb.from('marks').upsert(out, { onConflict: 'student_id,subject_id,exam_id' })); toast(`Saved ${out.length} marks`); }
      finally { busy(ev.target, 0); }
    });
  });
}
/* ---------- ADMIN ---------- */
async function adminPerf(el) {
  const [cl, ex] = await Promise.all([q(sb.from('classes').select('id,name,section')), q(sb.from('exams').select('id,name'))]);
  el.innerHTML = `<h2>School performance</h2><div class="card row"><label>Class<select id="c">${opts(cl, cls)}</select></label><label>Exam<select id="e">${opts(ex, x => x.name)}</select></label><button id="ld" class="pri">Show results</button></div><div id="grid"></div>`;
  $('#ld').onclick = safe(async () => {
    const [st, sm] = await Promise.all([q(sb.from('students').select('id,admission_no,full_name').eq('class_id', $('#c').value).order('admission_no')), q(sb.from('exam_summary').select('*').eq('class_id', $('#c').value).eq('exam_id', $('#e').value))]);
    const by = Object.fromEntries(sm.map(x => [x.student_id, x]));
    const avg = sm.length ? num(sm.reduce((a, x) => a + +x.percentage, 0) / sm.length) + '%' : 'no marks yet';
    $('#grid').innerHTML = `<div class="card">${tbl(['Admission no', 'Student', 'Subjects', 'Total', 'Percentage', 'Average marks'], st.map(s => { const x = by[s.id]; return [esc(s.admission_no), esc(s.full_name), x ? x.subjects : '-', x ? `${num(x.total)}/${num(x.max_total)}` : '-', x ? x.percentage + '%' : '-', x ? x.avg_marks : '-']; }))}<p><b>Class average: ${avg}</b></p></div>`;
  });
}

async function adminPeople(el) {
  const [cl, pr] = await Promise.all([q(sb.from('classes').select('id,name,section')), q(sb.from('profiles').select('id,full_name,email,role,active').order('role'))]);
  el.innerHTML = `<h2>People</h2><form id="nf" class="card grid"><label>Role<select name="role"><option>student</option><option>teacher</option><option>admin</option></select></label>
  <label>Full name<input name="full_name" required minlength="2" maxlength="100"></label><label>Email<input type="email" name="email" required></label>
  <label>Temporary password (10+ characters)<input type="password" name="password" required minlength="10" autocomplete="new-password"></label>
  <label>Admission number (students)<input name="admission_no"></label><label>Class (students)<select name="class_id"><option value="">None</option>${opts(cl, cls)}</select></label>
  <button class="pri">Create account</button></form>
  <div class="card">${tbl(['Name', 'Email', 'Role', 'Status', ''], pr.map(p => [esc(p.full_name), esc(p.email), p.role, p.active ? 'Active' : 'Disabled', `<button data-id="${esc(p.id)}" data-a="${p.active}">${p.active ? 'Disable' : 'Enable'}</button>`]))}</div>`;
  $('#nf').onsubmit = safe(async ev => {
    ev.preventDefault(); const b = ev.target.querySelector('button'); busy(b, 1);
    try {
      const { data: { session } } = await sb.auth.getSession();
      const r = await fetch('/.netlify/functions/create-user', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token }, body: JSON.stringify(Object.fromEntries(new FormData(ev.target))) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      toast('Account created'); adminPeople(el);
    } finally { busy(b, 0); }
  });
  el.querySelector('.card:last-child').onclick = safe(async e => {
    const id = e.target.dataset.id; if (!id) return;
    if (id === me.id) return toast('You cannot disable your own account', 1);
    await q(sb.from('profiles').update({ active: e.target.dataset.a !== 'true' }).eq('id', id)); adminPeople(el);
  });
}

async function adminSetup(el) {
  const [yr, cl, su, te] = await Promise.all([q(sb.from('academic_years').select('id,name')), q(sb.from('classes').select('id,name,section')), q(sb.from('subjects').select('id,name')), q(sb.from('profiles').select('id,full_name').eq('role', 'teacher'))]);
  const F = (title, table, fields) => `<form class="card" data-t="${table}"><h3>${title}</h3>${fields.map(f => `<label>${f[1]}${f[2] ? `<select name="${f[0]}" required>${f[2]}</select>` : `<input name="${f[0]}" ${f[3] || 'required'}>`}</label>`).join('')}<button class="pri">Add</button></form>`;
  const Y = opts(yr, y => y.name);
  el.innerHTML = `<h2>Setup</h2><div class="grid">` +
    F('Academic year', 'academic_years', [['name', 'Name (e.g. 2026-27)']]) +
    F('Class', 'classes', [['name', 'Class (e.g. 8)'], ['section', 'Section'], ['academic_year_id', 'Academic year', Y]]) +
    F('Subject', 'subjects', [['name', 'Name'], ['code', 'Code']]) +
    F('Exam', 'exams', [['name', 'Name (Unit Test, Mid-Term...)'], ['max_marks', 'Maximum marks', '', 'type="number" min="1" required'], ['academic_year_id', 'Academic year', Y]]) +
    F('Assign teacher', 'teacher_assignments', [['teacher_id', 'Teacher', opts(te, t => t.full_name)], ['class_id', 'Class', opts(cl, cls)], ['subject_id', 'Subject', opts(su, s => s.name)]]) +
    F('Class teacher (can print report cards)', 'class_teachers', [['teacher_id', 'Teacher', opts(te, t => t.full_name)], ['class_id', 'Class', opts(cl, cls)]]) + `</div>`;
  el.onsubmit = safe(async e => { e.preventDefault(); const f = e.target; const row = Object.fromEntries(new FormData(f)); await q(f.dataset.t === 'class_teachers' ? sb.from('class_teachers').upsert(row, { onConflict: 'class_id' }) : sb.from(f.dataset.t).insert(row)); toast('Saved'); adminSetup(el); });
}

async function adminAudit(el) {
  const [a, pr, sub, ex] = await Promise.all([q(sb.from('marks_audit').select('*').order('changed_at', { ascending: false }).limit(100)), q(sb.from('profiles').select('id,full_name')), q(sb.from('subjects').select('id,name')), q(sb.from('exams').select('id,name'))]);
  const n = Object.fromEntries([...pr, ...sub, ...ex].map(x => [x.id, x.full_name || x.name]));
  el.innerHTML = `<h2>Audit log</h2><p class="mut">Latest 100 changes to marks. This log cannot be edited from the app.</p><div class="card">${tbl(['When', 'Changed by', 'Student', 'Subject', 'Exam', 'Action', 'Old', 'New'], a.map(x => [new Date(x.changed_at).toLocaleString(), esc(n[x.changed_by] || 'System'), esc(n[x.student_id]), esc(n[x.subject_id]), esc(n[x.exam_id]), x.action, x.old_marks ?? '-', x.new_marks ?? '-']))}</div>`;
}

/* ---------- REPORT CARDS (class teacher + admin) ---------- */
const grade = p => p >= 90 ? 'A+' : p >= 80 ? 'A' : p >= 70 ? 'B+' : p >= 60 ? 'B' : p >= 50 ? 'C' : p >= 40 ? 'D' : 'F';
async function reportView(el) {
  const cl = me.role === 'admin' ? await q(sb.from('classes').select('id,name,section,academic_years(name)'))
    : (await q(sb.from('class_teachers').select('classes(id,name,section,academic_years(name))').eq('teacher_id', me.id))).map(x => x.classes);
  if (!cl.length) return el.innerHTML = '<h2>Report cards</h2><p>Report cards are printed by the class teacher. Ask the administrator to assign you as class teacher (Setup).</p>';
  el.innerHTML = `<h2 class="noprint">Report cards</h2><div class="card row noprint"><label>Class<select id="c">${opts(cl, cls)}</select></label>
  <label>Student<select id="s"><option value="">All students</option></select></label><button id="ld" class="pri">Preview</button><button id="pr" disabled>Print or save as PDF</button></div>
  <p class="mut noprint">Click Preview, then Print and choose "Save as PDF" to download. You can click inside a Remarks box to type before printing.</p><div id="cards"></div>`;
  const loadSt = safe(async () => { const st = await q(sb.from('students').select('id,full_name').eq('class_id', $('#c').value).order('full_name')); $('#s').innerHTML = '<option value="">All students</option>' + opts(st, x => x.full_name); });
  $('#c').onchange = loadSt; loadSt();
  $('#pr').onclick = () => window.print();
  $('#ld').onclick = safe(async () => {
    const c = cl.find(x => x.id === $('#c').value);
    const [st, sub, ex] = await Promise.all([q(sb.from('students').select('id,admission_no,full_name').eq('class_id', c.id).order('full_name')), q(sb.from('subjects').select('id,name').order('name')), q(sb.from('exams').select('id,name,max_marks').order('name'))]);
    const m = st.length ? await q(sb.from('marks').select('student_id,subject_id,exam_id,marks_obtained,max_marks').in('student_id', st.map(s => s.id))) : [];
    const agg = st.map(s => { const r = m.filter(x => x.student_id === s.id); const t = r.reduce((a, x) => a + +x.marks_obtained, 0), mx = r.reduce((a, x) => a + +x.max_marks, 0); return { s, r, t, mx, p: mx ? 100 * t / mx : 0 }; });
    const ranked = agg.filter(a => a.mx).sort((a, b) => b.p - a.p);
    const rank = a => ranked.findIndex(x => num(x.p) === num(a.p)) + 1;
    const exU = ex.filter(e => m.some(x => x.exam_id === e.id)), subU = sub.filter(x => m.some(y => y.subject_id === x.id));
    const pick = $('#s').value, school = ENV.SCHOOL_NAME || 'School Name';
    const cards = agg.filter(a => !pick || a.s.id === pick).map(a => {
      const rows = subU.map(sj => { const r = a.r.filter(x => x.subject_id === sj.id); const t = r.reduce((z, x) => z + +x.marks_obtained, 0), mx = r.reduce((z, x) => z + +x.max_marks, 0);
        return [esc(sj.name), ...exU.map(e => { const x = r.find(y => y.exam_id === e.id); return x ? num(x.marks_obtained) : '-'; }), mx ? `${num(t)}/${num(mx)}` : '-', mx ? num(100 * t / mx) + '%' : '-']; });
      rows.push(['<b>Total</b>', ...exU.map(e => { const r = a.r.filter(x => x.exam_id === e.id); return r.length ? `<b>${num(r.reduce((z, x) => z + +x.marks_obtained, 0))}/${num(r.reduce((z, x) => z + +x.max_marks, 0))}</b>` : '-'; }), `<b>${num(a.t)}/${num(a.mx)}</b>`, `<b>${num(a.p)}%</b>`]);
      return `<article class="rc"><div class="rch"><h1>${esc(school)}</h1><h2>Progress Report Card</h2><div>Academic year ${esc(c.academic_years?.name || '')}</div></div>
      <div class="rci"><div><b>Student:</b> ${esc(a.s.full_name)}</div><div><b>Admission no:</b> ${esc(a.s.admission_no)}</div><div><b>Class:</b> ${esc(cls(c))}</div></div>
      ${a.mx ? tbl(['Subject', ...exU.map(e => `${esc(e.name)} (${num(e.max_marks)})`), 'Total', 'Percentage'], rows) : '<p>No marks recorded yet.</p>'}
      ${a.mx ? `<div class="sum"><span>Overall: ${num(a.p)}%</span><span>Grade: ${grade(a.p)}</span><span>Rank: ${rank(a)} of ${ranked.length}</span></div>` : ''}
      <div class="key">Grades: A+ 90 and above, A 80-89, B+ 70-79, B 60-69, C 50-59, D 40-49, F below 40</div>
      <div><b>Remarks:</b></div><div class="rem" contenteditable="true" aria-label="Remarks"></div>
      <div class="sig"><div>Class teacher</div><div>Parent signature</div><div>Principal</div></div>
      <div class="key">Issued on ${new Date().toLocaleDateString()}</div></article>`;
    });
    $('#cards').innerHTML = cards.join('') || '<p>No students in this class.</p>';
    $('#pr').disabled = !cards.length;
  });
}
/* ---------- ATTENDANCE ---------- */
const WEEKLY_OFF = [0]; // 0 = Sunday. Use [0, 6] if Saturday is also off.
const ST = { present: 'Present', absent: 'Absent', late: 'Late', leave: 'Leave' };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => iso(new Date());
const dow = s => new Date(s + 'T00:00:00').getDay();
const monthEnd = m => `${m}-${String(new Date(+m.slice(0, 4), +m.slice(5), 0).getDate()).padStart(2, '0')}`;
const attPct = r => { const a = r.filter(x => x.status === 'present' || x.status === 'late').length; return r.length ? num(100 * a / r.length) + '%' : '-'; };
async function pages(make) { let out = [], from = 0; for (;;) { const r = await q(make().range(from, from + 999)); out = out.concat(r); if (r.length < 1000) return out; from += 1000; } }
const myClasses = async () => me.role === 'admin' ? q(sb.from('classes').select('id,name,section')) : (await q(sb.from('class_teachers').select('classes(id,name,section)').eq('teacher_id', me.id))).map(x => x.classes);

/* Class teacher / admin: mark attendance + monthly summary */
async function attendanceView(el) {
  const cl = await myClasses();
  if (!cl.length) return el.innerHTML = '<h2>Attendance</h2><p>Attendance is marked by the class teacher. Ask the administrator to assign you as class teacher (Setup).</p>';
  el.innerHTML = `<h2>Attendance</h2><div class="card row"><label>Class<select id="c">${opts(cl, cls)}</select></label>
  <label>Date<input type="date" id="d" value="${today()}" max="${today()}"></label><button id="ld" class="pri">Load students</button></div><div id="grid"></div>
  <div class="card row"><label>Month<input type="month" id="m" value="${today().slice(0, 7)}"></label><button id="rp">Monthly summary</button></div><div id="rep"></div>`;

  $('#ld').onclick = safe(async () => {
    const d = $('#d').value, cid = $('#c').value;
    if (!d) return toast('Choose a date', 1);
    if (d > today()) return toast('You cannot mark attendance for a future date', 1);
    const [hol, st, at] = await Promise.all([
      q(sb.from('holidays').select('name').eq('date', d)),
      q(sb.from('students').select('id,admission_no,full_name').eq('class_id', cid).order('admission_no')),
      q(sb.from('attendance').select('student_id,status').eq('date', d))
    ]);
    if (hol.length) return $('#grid').innerHTML = `<div class="card"><b>${esc(d)}</b> is a holiday: ${esc(hol[0].name)}. Attendance is not taken.</div>`;
    if (WEEKLY_OFF.includes(dow(d))) return $('#grid').innerHTML = `<div class="card"><b>${esc(d)}</b> is a weekly off day. Attendance is not taken.</div>`;
    const cur = Object.fromEntries(at.map(x => [x.student_id, x.status]));
    const saved = st.some(s => cur[s.id]);
    $('#grid').innerHTML = `<div class="card"><p><button id="allp">Mark all present</button></p>${tbl(['Admission no', 'Student', 'Status'], st.map(s => [esc(s.admission_no), esc(s.full_name),
      `<select class="at" data-id="${esc(s.id)}" aria-label="Status for ${esc(s.full_name)}">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${(cur[s.id] || 'present') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`]))}
      <p class="mut">${st.length} students. ${saved ? 'Attendance is already saved for this date; saving will update it.' : 'Not saved yet.'}</p><button id="sv" class="pri">Save attendance</button></div>`;
    $('#allp').onclick = () => document.querySelectorAll('.at').forEach(s => s.value = 'present');
    $('#sv').onclick = safe(async ev => {
      const rows = [...document.querySelectorAll('.at')].map(s => ({ student_id: s.dataset.id, date: d, status: s.value }));
      if (!rows.length) return toast('No students in this class', 1);
      busy(ev.target, 1);
      try { await q(sb.from('attendance').upsert(rows, { onConflict: 'student_id,date' })); toast(`Attendance saved for ${rows.length} students`); }
      finally { busy(ev.target, 0); }
    });
  });

  $('#rp').onclick = safe(async () => {
    const m = $('#m').value, cid = $('#c').value; if (!m) return toast('Choose a month', 1);
    const st = await q(sb.from('students').select('id,admission_no,full_name').eq('class_id', cid).order('admission_no'));
    const ids = new Set(st.map(s => s.id));
    const at = (await pages(() => sb.from('attendance').select('student_id,status').gte('date', m + '-01').lte('date', monthEnd(m)).order('date').order('student_id'))).filter(x => ids.has(x.student_id));
    $('#rep').innerHTML = `<div class="card">${tbl(['Admission no', 'Student', 'Present', 'Late', 'Absent', 'Leave', 'Attendance %'], st.map(s => {
      const r = at.filter(x => x.student_id === s.id), c = k => r.filter(x => x.status === k).length;
      return [esc(s.admission_no), esc(s.full_name), c('present'), c('late'), c('absent'), c('leave'), `<b>${attPct(r)}</b>`];
    }))}<p class="mut">Attendance % = (Present + Late) divided by days marked. Holidays and weekly offs are not counted.</p></div>`;
  });
}

/* Admin: holidays */
async function holidaysView(el) {
  const h = await q(sb.from('holidays').select('id,date,name').order('date'));
  el.innerHTML = `<h2>Holidays</h2><form id="hf" class="card row"><label>Date<input type="date" name="date" required></label>
  <label>Holiday name<input name="name" required minlength="2" maxlength="80"></label><button class="pri">Add holiday</button></form>
  <div class="card">${tbl(['Date', 'Holiday', ''], h.map(x => [esc(x.date), esc(x.name), `<button data-id="${esc(x.id)}">Remove</button>`]))}</div>`;
  $('#hf').onsubmit = safe(async ev => { ev.preventDefault(); await q(sb.from('holidays').insert(Object.fromEntries(new FormData(ev.target)))); toast('Holiday added'); holidaysView(el); });
  el.querySelector('.card:last-child').onclick = safe(async e => {
    const id = e.target.dataset.id; if (!id || !confirm('Remove this holiday?')) return;
    await q(sb.from('holidays').delete().eq('id', id)); holidaysView(el);
  });
}

/* Student: monthly calendar */
async function myAttendance(el) {
  el.innerHTML = `<h2>My attendance</h2><div class="card row"><label>Month<input type="month" id="m" value="${today().slice(0, 7)}"></label></div><div id="out"></div>`;
  const draw = safe(async () => {
    const m = $('#m').value; if (!m) return;
    const y = +m.slice(0, 4), mo = +m.slice(5), last = new Date(y, mo, 0).getDate();
    const [at, hol, all] = await Promise.all([
      q(sb.from('attendance').select('date,status').gte('date', m + '-01').lte('date', monthEnd(m))),
      q(sb.from('holidays').select('date,name').gte('date', m + '-01').lte('date', monthEnd(m)).order('date')),
      pages(() => sb.from('attendance').select('status').order('date'))
    ]);
    const A = Object.fromEntries(at.map(x => [x.date, x.status])), H = Object.fromEntries(hol.map(x => [x.date, x.name]));
    const cnt = k => at.filter(x => x.status === k).length;
    const cells = Array(new Date(y, mo - 1, 1).getDay()).fill('<div class="cd e"></div>');
    for (let d = 1; d <= last; d++) {
      const dt = `${m}-${String(d).padStart(2, '0')}`; let c = 'cd', lab = '';
      if (H[dt]) { c += ' h'; lab = H[dt]; } else if (A[dt]) { c += ' ' + A[dt]; lab = ST[A[dt]]; } else if (WEEKLY_OFF.includes(dow(dt))) { c += ' o'; lab = 'Off'; }
      cells.push(`<div class="${c}" title="${esc(lab)}"><b>${d}</b><span>${esc(lab)}</span></div>`);
    }
    $('#out').innerHTML = `<div class="stats"><div class="card stat"><span class="mut">This month</span><b>${attPct(at)}</b></div>
      <div class="card stat"><span class="mut">Present / Late</span><b>${cnt('present')} / ${cnt('late')}</b></div>
      <div class="card stat"><span class="mut">Absent / Leave</span><b>${cnt('absent')} / ${cnt('leave')}</b></div>
      <div class="card stat"><span class="mut">Overall attendance</span><b>${attPct(all)}</b></div></div>
      <div class="card"><div class="cal">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(w => `<div class="wd">${w}</div>`).join('')}${cells.join('')}</div>
      <div class="lg"><span><i class="present"></i>Present</span><span><i class="late"></i>Late</span><span><i class="absent"></i>Absent</span><span><i class="leave"></i>Leave</span><span><i class="h"></i>Holiday</span><span><i class="o"></i>Weekly off</span></div></div>
      ${hol.length ? `<div class="card"><b>Holidays this month</b><br>${hol.map(x => `${esc(x.date)}: ${esc(x.name)}`).join('<br>')}</div>` : ''}`;
  });
  $('#m').onchange = draw; draw();
}
/* ---------- RESULT ACCESS (block / unblock students) ---------- */
async function resultAccessView(el) {
  const cl = me.role === 'admin' ? await q(sb.from('classes').select('id,name,section'))
    : (await q(sb.from('class_teachers').select('classes(id,name,section)').eq('teacher_id', me.id))).map(x => x.classes);
  if (!cl.length) return el.innerHTML = '<h2>Result access</h2><p>This is managed by the class teacher. Ask the administrator to assign you as class teacher (Setup).</p>';
  const DEF = 'Fee is due. Please pay the fee to view your results.';
  el.innerHTML = `<h2>Result access</h2><div class="card row"><label>Class<select id="c">${opts(cl, cls)}</select></label><button id="ld" class="pri">Load students</button></div>
  <p class="mut">A blocked student cannot see any marks. They see your message instead. Edit the message before clicking Block.</p><div id="grid"></div>`;
  const load = safe(async () => {
    const st = await q(sb.from('students').select('id,admission_no,full_name').eq('class_id', $('#c').value).order('admission_no'));
    const bl = await q(sb.from('result_blocks').select('student_id,message'));
    const B = Object.fromEntries(bl.map(x => [x.student_id, x.message]));
    $('#grid').innerHTML = `<div class="card">${tbl(['Admission no', 'Student', 'Status', 'Message to student', ''], st.map(s => {
      const b = B[s.id] !== undefined;
      return [esc(s.admission_no), esc(s.full_name), b ? '<b class="err">Blocked</b>' : 'Allowed',
        `<input class="bm" data-id="${esc(s.id)}" maxlength="200" value="${esc(b ? B[s.id] : DEF)}" style="width:100%;min-width:280px" aria-label="Message for ${esc(s.full_name)}">`,
        b ? `<button data-a="unblock" data-id="${esc(s.id)}">Unblock</button>` : `<button class="pri" data-a="block" data-id="${esc(s.id)}">Block</button>`];
    }))}</div>`;
  });
  $('#ld').onclick = load;
  $('#grid').onclick = safe(async e => {
    const a = e.target.dataset.a, id = e.target.dataset.id; if (!a) return;
    if (a === 'block') {
      const msg = $('#grid').querySelector(`.bm[data-id="${id}"]`).value.trim();
      if (msg.length < 3 || msg.length > 200) return toast('Message must be 3 to 200 characters', 1);
      busy(e.target, 1);
      try { await q(sb.from('result_blocks').upsert({ student_id: id, message: msg }, { onConflict: 'student_id' })); toast('Results blocked for this student'); } finally { busy(e.target, 0); }
    } else {
      busy(e.target, 1);
      try { await q(sb.from('result_blocks').delete().eq('student_id', id)); toast('Results unblocked'); } finally { busy(e.target, 0); }
    }
    load();
  });
}
start();
