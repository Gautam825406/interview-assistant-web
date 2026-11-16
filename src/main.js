import { api, ApiError, getToken, getUser, saveAuth, clearAuth, isLoggedIn, isAdmin } from './api.js'
import { isQuestion, MOCK_QUESTIONS, QUESTION_BANK } from './questions.js'

// ---------- storage (namespaced per logged-in user) ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)) },
}
const uid = () => getUser()?.id || 'anon'
const SESSIONS_KEY = () => 'ia_sessions_' + uid()
const RESUME_KEY = () => 'ia_resume_' + uid()
const DOCS_KEY = () => 'ia_docs_' + uid()
const SETTINGS_KEY = () => 'ia_settings_' + uid()

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ---------- state ----------
let meData = null          // {user, subscription, usage} from /api/auth/me
let aiStatus = null        // {provider, configured, chat_model, vision_model}
let currentSession = null
let liveTimer = null
let liveSeconds = 0
let recognition = null
let micOn = false
let tabStream = null
let mockState = null
let dashFilter = 'All'
let sessionGatePassed = false
let pendingOrderId = null
let plansCache = []

// ---------- settings (local only: language) ----------
function getSettings() { return store.get(SETTINGS_KEY(), { lang: 'English' }) }
function getResume() { return store.get(RESUME_KEY(), '') }
function getSessions() { return store.get(SESSIONS_KEY(), []) }
function saveSessions(list) { store.set(SESSIONS_KEY(), list) }

// ---------- navigation ----------
function show(sectionId) {
  // Flow: landing page first (guests) → login/signup → user panel (overview).
  // Guests may see the landing page and the auth page only; everything else
  // sends them to login. Signed-in users land on the Overview panel.
  if (!isLoggedIn() && sectionId !== 'auth' && sectionId !== 'home') { showAuth(); return }
  if (isLoggedIn() && sectionId === 'auth') { sectionId = 'overview' }
  if (sectionId === 'admin' && !isAdmin()) { sectionId = 'overview' }
  document.querySelectorAll('main section').forEach((s) => s.classList.toggle('active', s.id === sectionId))
  document.querySelectorAll('.nav [data-nav]').forEach((b) => b.classList.toggle('active', b.dataset.nav === sectionId))
  window.scrollTo({ top: 0 })
  if (sectionId === 'overview') renderOverview()
  if (sectionId === 'sessions') renderSessions()
  if (sectionId === 'bank') renderBank()
  if (sectionId === 'settings') renderSettings()
  if (sectionId === 'pricing') renderPlans()
  if (sectionId === 'admin') renderAdmin('overview')
  if (sectionId === 'live') refreshAiStatusLine()
}
document.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => show(b.dataset.nav)))

function setBodyAuth() {
  document.body.classList.toggle('logged-in', isLoggedIn())
  document.body.classList.toggle('logged-out', !isLoggedIn())
  document.body.classList.toggle('is-admin', isAdmin())
  const u = getUser()
  $('userChip').innerHTML = u ? `<span class="chip">${esc(u.name || u.email)} · ${esc(u.plan_slug || 'free')}${u.role === 'admin' ? ' · admin' : ''}</span>` : ''
}

// ---------- auth ----------
let authMode = 'login'
function showAuth(msg) {
  setBodyAuth()
  document.querySelectorAll('main section').forEach((s) => s.classList.toggle('active', s.id === 'auth'))
  window.scrollTo({ top: 0 })
  if (msg) {
    $('authError').textContent = msg
    $('authError').style.display = ''
  } else {
    $('authError').style.display = 'none'
  }
}
function setAuthMode(mode) {
  authMode = mode
  $('tabLogin').classList.toggle('active', mode === 'login')
  $('tabSignup').classList.toggle('active', mode === 'signup')
  $('signupFields').style.display = mode === 'signup' ? '' : 'none'
  $('authSubmitBtn').textContent = mode === 'signup' ? 'Create account' : 'Log in'
  $('authHint').textContent = mode === 'signup'
    ? 'The first account created on the service becomes the admin.'
    : 'New here? Switch to the Sign up tab — the first account created becomes the service admin.'
  $('authError').style.display = 'none'
}
$('tabLogin').addEventListener('click', () => setAuthMode('login'))
$('tabSignup').addEventListener('click', () => setAuthMode('signup'))
$('authPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('authSubmitBtn').click() })

$('authSubmitBtn').addEventListener('click', async () => {
  const email = $('authEmail').value.trim()
  const password = $('authPassword').value
  const name = $('authName').value.trim()
  const err = $('authError')
  const fail = (m) => { err.textContent = m; err.style.display = '' }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid email address.')
  if (password.length < 6) return fail('Password must be at least 6 characters.')
  if (authMode === 'signup' && !name) return fail('Enter your name.')
  $('authSubmitBtn').disabled = true
  $('authSubmitBtn').textContent = 'Please wait…'
  try {
    const res = authMode === 'signup'
      ? await api.signup(name, email, password)
      : await api.login(email, password)
    saveAuth(res.token, res.user)
    meData = await api.me()
    setBodyAuth()
    await refreshAiStatus()
    await loadPublicPlans()
    show('overview')
    if (pendingOrderId) { const oid = pendingOrderId; pendingOrderId = null; await handleVerify(oid) }
  } catch (e) {
    fail(e.message || 'Login failed. Try again.')
  } finally {
    $('authSubmitBtn').disabled = false
    setAuthMode(authMode)
  }
})

function logout() {
  stopMic(); stopTabAudio()
  clearAuth(); meData = null; aiStatus = null; currentSession = null
  showAuth()
}
$('logoutBtn').addEventListener('click', logout)
$('logoutBtn2').addEventListener('click', logout)
window.addEventListener('ia:unauthorized', () => showAuth('Session expired — please log in again.'))

// ---------- plans + Cashfree checkout ----------
function fmtPrice(plan) {
  const p = Number(plan.price || 0)
  const n = p.toFixed(2).replace(/\.00$/, '')
  if (plan.currency === 'INR') return '₹' + n
  return '$' + n
}
function planPeriod(plan) {
  if (plan.slug === 'free') return 'free forever'
  if (plan.duration_days === 7) return '/ week'
  if (plan.duration_days === 30) return '/ month'
  if (plan.duration_days === 365) return '/ year'
  return plan.duration_days ? `/ ${plan.duration_days} days` : ''
}
function currentPlanSlug() {
  return meData?.subscription?.plan_slug || meData?.user?.plan_slug || 'free'
}

async function loadPublicPlans() {
  try {
    plansCache = await api.plans()
  } catch { plansCache = [] }
  renderPlans()
  const strip = $('homePlanStrip')
  if (strip) {
    strip.innerHTML = plansCache.length
      ? plansCache.map((p) => `<span class="chip">${esc(p.name)} — ${esc(fmtPrice(p))}${esc(planPeriod(p))}</span>`).join('')
      : ''
  }
}

function renderPlans() {
  const grid = $('plansGrid')
  if (!grid) return
  const cur = currentPlanSlug()
  const sub = meData?.subscription
  $('currentPlanLine').innerHTML = meData
    ? sub
      ? `Your plan: <b>${esc(sub.plan_slug)}</b> · ${esc(sub.status)}${sub.expires_at ? ' · valid until ' + esc(new Date(sub.expires_at).toLocaleDateString()) : ''}`
      : `Your plan: <b>${esc(meData.user.plan_slug || 'free')}</b> · no active subscription`
    : ''
  if (!plansCache.length) { grid.innerHTML = '<p class="muted">Plans could not be loaded — the service may be starting up. Try again in a moment.</p>'; return }
  grid.innerHTML = plansCache.map((p) => {
    const isCur = p.slug === cur
    const isFree = p.slug === 'free'
    const feats = (p.features || []).map((f) => `<li>${esc(f)}</li>`).join('')
    const limits = [
      p.sessions_limit ? `${p.sessions_limit} sessions` : 'Unlimited sessions',
      p.minutes_per_session ? `${p.minutes_per_session} min / session` : '',
      p.mock_limit ? `${p.mock_limit} mock interview${p.mock_limit > 1 ? 's' : ''}` : 'Unlimited mocks',
    ].filter(Boolean).join(' · ')
    return `<div class="card glass plan-card ${p.slug === 'monthly' ? 'popular' : ''}">
      <h3>${esc(p.name)}${p.slug === 'monthly' ? ' <span class="badge">Most popular</span>' : ''}</h3>
      <p class="price">${esc(fmtPrice(p))}<span class="small muted"> ${esc(planPeriod(p))}</span></p>
      <p class="muted small">${esc(limits)}</p>
      ${feats ? `<ul class="muted small">${feats}</ul>` : ''}
      <button class="btn ${isCur ? 'ghost' : ''}" data-sub="${esc(p.slug)}" ${(isCur || (isFree && cur !== 'free')) ? 'disabled' : ''}>${isCur ? '✓ Current plan' : isFree ? 'Free plan' : 'Subscribe'}</button>
    </div>`
  }).join('')
  grid.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => subscribe(b.dataset.sub)))
}

function loadCashfreeScript(mode) {
  return new Promise((resolve, reject) => {
    if (window.Cashfree) return resolve()
    const s = document.createElement('script')
    s.src = mode === 'PROD'
      ? 'https://sdk.cashfree.com/js/ui/2.0.0/cashfree.prod.js'
      : 'https://sdk.cashfree.com/js/ui/2.0.0/cashfree.sandbox.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Could not load the Cashfree checkout. Check your connection and try again.'))
    document.head.appendChild(s)
  })
}

async function subscribe(planSlug) {
  const out = $('payResult')
  out.textContent = 'Creating your secure checkout…'
  try {
    const order = await api.checkout(planSlug)
    await loadCashfreeScript(order.mode || 'SANDBOX')
    const cashfree = window.Cashfree({ mode: (order.mode || 'SANDBOX') === 'PROD' ? 'production' : 'sandbox' })
    await cashfree.checkout({ paymentSessionId: order.payment_session_id, redirectTarget: '_modal' })
    out.textContent = 'Verifying your payment…'
    await handleVerify(order.order_id)
  } catch (e) {
    out.textContent = 'Checkout failed: ' + (e.message || 'unknown error')
  }
}

async function handleVerify(orderId) {
  const out = $('payResult')
  try {
    const res = await api.verify(orderId)
    meData = await api.me()
    setBodyAuth()
    await loadPublicPlans()
    if (res.status === 'success' || res.subscription) {
      out.textContent = `✅ Payment successful — your ${res.subscription?.plan_slug || ''} plan is active${res.subscription?.expires_at ? ' until ' + new Date(res.subscription.expires_at).toLocaleDateString() : ''}.`
    } else {
      out.textContent = 'Payment status: ' + (res.status || 'pending') + '. If you paid and this stays pending, contact support with order ' + orderId + '.'
    }
  } catch (e) {
    out.textContent = 'Could not verify the payment: ' + e.message
  }
  show('pricing')
}

// ---------- upgrade modal (plan limit reached) ----------
function showUpgrade(message) {
  $('upgradeText').textContent = message || 'Your free plan limit is reached. Upgrade for unlimited sessions and mocks.'
  $('upgradeModal').classList.remove('hidden')
}
$('upgradeCloseBtn').addEventListener('click', () => $('upgradeModal').classList.add('hidden'))
$('upgradeGoBtn').addEventListener('click', () => { $('upgradeModal').classList.add('hidden'); show('pricing') })

// ---------- AI status ----------
async function refreshAiStatus() {
  try { aiStatus = await api.aiStatus() } catch { aiStatus = null }
  refreshAiStatusLine()
}
function refreshAiStatusLine() {
  const line = $('aiStatusLine')
  const setLine = $('aiStatusSettings')
  const text = aiStatus
    ? aiStatus.configured
      ? `🤖 AI ready — ${esc(aiStatus.provider)} (${esc(aiStatus.chat_model || '')})`
      : '⚠️ AI is not configured yet — the service owner needs to add a provider key in the Admin panel.'
    : '🤖 AI status unknown — the service may be starting up.'
  if (line) line.innerHTML = text
  if (setLine) setLine.innerHTML = text
}

// ---------- overview + sessions ----------
const FILTERS = ['All', 'Interview', 'Regular', 'Mock']
function sessionCard(s) {
  return `
    <div class="session">
      <div class="session-top"><b>${esc(s.company || 'Untitled')} — ${esc(s.role || s.mode)}</b><span class="chip">${esc(s.mode)}</span></div>
      <span class="muted small">${esc(new Date(s.createdAt).toLocaleString())} · ${s.turns?.length || 0} Q&amp;A · score ${s.score ?? '—'}</span>
      <p class="muted small">${esc((s.notes?.summary || '').slice(0, 160))}</p>
      <div class="row"><button class="btn ghost small" data-open="${s.id}">Open</button><button class="btn ghost small" data-del="${s.id}">Delete</button></div>
    </div>`
}
function bindSessionButtons(root) {
  root.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openSession(b.dataset.open)))
  root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    saveSessions(getSessions().filter((s) => s.id !== b.dataset.del)); renderSessions(); renderOverview()
  }))
}
function renderOverview() {
  const u = meData?.usage
  $('dashPlanLine').textContent = meData
    ? `Plan: ${meData.user.plan_slug || 'free'} · Sessions used: ${u?.sessions_used ?? '—'}${u?.sessions_limit ? ' / ' + u.sessions_limit : ''} · Mocks used: ${u?.mocks_used ?? '—'}${u?.mock_limit ? ' / ' + u.mock_limit : ''}`
    : 'Your saved sessions live only in this browser.'
  // Stat cards (textContent — no HTML escaping needed here).
  const firstName = (meData?.user?.name || '').split(' ')[0]
  $('dashName').textContent = firstName ? `, ${firstName}` : ''
  const sUsed = u?.sessions_used ?? 0, sLim = u?.sessions_limit
  $('statSessions').textContent = sLim ? `${sUsed} / ${sLim}` : `${sUsed}`
  $('statSessionsBar').style.width = sLim ? Math.min(100, (sUsed / sLim) * 100) + '%' : '0%'
  $('statSessionsSub').textContent = sLim ? `${Math.max(0, sLim - sUsed)} session${sLim - sUsed === 1 ? '' : 's'} left` : 'Unlimited sessions'
  const mUsed = u?.mocks_used ?? 0, mLim = u?.mock_limit
  $('statMocks').textContent = mLim ? `${mUsed} / ${mLim}` : `${mUsed}`
  $('statMocksBar').style.width = mLim ? Math.min(100, (mUsed / mLim) * 100) + '%' : '0%'
  $('statMocksSub').textContent = mLim ? `${Math.max(0, mLim - mUsed)} mock${mLim - mUsed === 1 ? '' : 's'} left` : 'Unlimited mocks'
  const planSlug = (meData?.user?.plan_slug || 'free')
  $('statPlan').textContent = planSlug.toUpperCase()
  $('statPlanSub').textContent = meData?.subscription?.expires_at
    ? `Valid until ${new Date(meData.subscription.expires_at).toLocaleDateString()}`
    : planSlug === 'free' ? 'Upgrade for unlimited' : 'Active subscription'
  if (aiStatus) {
    $('statAi').textContent = aiStatus.configured ? 'Ready' : 'Not set up'
    $('statAiSub').textContent = aiStatus.configured ? `${aiStatus.provider}${aiStatus.chat_model ? ' · ' + aiStatus.chat_model : ''}` : 'Owner must add a key'
  } else {
    $('statAi').textContent = '…'
    $('statAiSub').textContent = 'Checking…'
  }
  const recent = getSessions().slice(0, 4)
  $('recentList').innerHTML = recent.length ? recent.map(sessionCard).join('') : '<p class="muted">No sessions yet. Create your first session — it will show up here.</p>'
  bindSessionButtons($('recentList'))
}
function renderSessions() {
  $('dashFilters').innerHTML = FILTERS.map((f) => `<button class="chip ${f === dashFilter ? 'active' : ''}" data-f="${f}">${f}</button>`).join('')
  document.querySelectorAll('#dashFilters .chip').forEach((c) => c.addEventListener('click', () => { dashFilter = c.dataset.f; renderSessions() }))
  const q = ($('dashSearch').value || '').toLowerCase()
  const list = getSessions().filter((s) => (dashFilter === 'All' || s.mode === dashFilter) && (!q || (s.company + ' ' + s.role + ' ' + s.mode).toLowerCase().includes(q)))
  $('dashList').innerHTML = list.length ? list.map(sessionCard).join('') : '<p class="muted">No sessions yet. Create your first session — it will be saved here.</p>'
  bindSessionButtons($('dashList'))
}
$('dashSearch').addEventListener('input', renderSessions)

function openSession(id) {
  const s = getSessions().find((x) => x.id === id)
  if (!s) return
  show('sessionDetail')
  $('sessionDetailBody').innerHTML = `
    <div class="card glass"><h2>${esc(s.company || 'Session')} — ${esc(s.role || s.mode)}</h2>
    <p class="muted small">${esc(s.mode)} · ${esc(new Date(s.createdAt).toLocaleString())} · ${esc(s.language || '')}</p>
    <h3>AI Notes</h3>
    <p><b>Summary:</b> ${esc(s.notes?.summary || 'No notes yet.')}</p>
    <p><b>Key points:</b></p><ul>${(s.notes?.keyPoints || []).map((k) => `<li>${esc(k)}</li>`).join('') || '<li>—</li>'}</ul>
    <p><b>Action items:</b></p><ul>${(s.notes?.actionItems || []).map((k) => `<li>${esc(k)}</li>`).join('') || '<li>—</li>'}</ul>
    <p><b>Score:</b> ${s.score ?? '—'} / 100</p>
    <h3>Transcript &amp; answers</h3>
    ${(s.turns || []).map((t) => `<p><b>Q:</b> ${esc(t.q)}</p><p><b>A:</b> ${esc(t.a)}</p><hr/>`).join('') || '<p class="muted">No turns recorded.</p>'}
    </div>`
}

// ---------- resume file ----------
$('fResumeFile').addEventListener('change', async (e) => {
  const file = e.target.files[0]
  if (!file) return
  if (file.name.endsWith('.txt')) {
    $('fResume').value = await file.text()
    return
  }
  if (file.name.endsWith('.pdf')) {
    try {
      const pdfjs = await import('pdfjs-dist')
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
      const buf = await file.arrayBuffer()
      const pdf = await pdfjs.getDocument({ data: buf }).promise
      let text = ''
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        text += content.items.map((it) => it.str).join(' ') + '\n'
      }
      $('fResume').value = text
      $('resumeFileNote').textContent = `PDF extracted: ${pdf.numPages} page(s). Check the text above.`
    } catch (err) {
      $('resumeFileNote').textContent = 'PDF extraction failed in this browser — please paste your resume text above instead. (' + err.message + ')'
    }
  }
})

function readCreateForm() {
  return {
    mode: $('fMode').value,
    company: $('fCompany').value.trim(),
    role: $('fRole').value.trim(),
    language: $('fLang').value,
    resume: $('fResume').value.trim(),
    jd: $('fJD').value.trim(),
  }
}

// Gate: one /api/sessions/start per live session. 402 -> upgrade prompt.
async function beginLiveSession(session) {
  try {
    const r = await api.sessionsStart()
    sessionGatePassed = true
    if (meData) { meData.usage = { ...(meData.usage || {}), sessions_used: r.sessions_used, sessions_limit: r.sessions_limit } }
  } catch (e) {
    if (e instanceof ApiError && e.status === 402) { showUpgrade(e.message); return false }
    if (e instanceof ApiError && e.status === 503) { alert(e.message); return false }
    alert('Could not start the session: ' + e.message)
    return false
  }
  currentSession = session
  const list = getSessions(); list.unshift(session); saveSessions(list)
  $('liveTitle').textContent = `— ${session.company || 'Interview'} · ${session.role || session.mode}`
  $('transcript').textContent = 'Session started. Speak, capture tab audio, or type a question below.'
  $('answerBox').innerHTML = '<p class="muted">Ask a question and the suggested answer will appear here.</p>'
  liveSeconds = 0; updateTimer()
  show('live')
  return true
}

$('startLiveBtn').addEventListener('click', async () => {
  const f = readCreateForm()
  if (f.resume) store.set(RESUME_KEY(), f.resume)
  const session = { id: 's' + Date.now(), mode: f.mode, company: f.company, role: f.role, language: f.language, resume: f.resume, jd: f.jd, createdAt: Date.now(), turns: [], notes: null, score: null }
  await beginLiveSession(session)
})
$('saveSessionBtn').addEventListener('click', () => {
  const f = readCreateForm()
  if (f.resume) store.set(RESUME_KEY(), f.resume)
  const list = getSessions()
  list.unshift({ id: 's' + Date.now(), mode: f.mode, company: f.company, role: f.role, language: f.language, resume: f.resume, jd: f.jd, createdAt: Date.now(), turns: [], notes: null, score: null })
  saveSessions(list)
  alert('Draft session saved. Find it in Sessions.')
  show('sessions')
})

// ---------- live timer ----------
function updateTimer() {
  const m = String(Math.floor(liveSeconds / 60)).padStart(2, '0')
  const s = String(liveSeconds % 60).padStart(2, '0')
  $('liveTimer').textContent = `${m}:${s}`
}
setInterval(() => { if (currentSession && $('live').classList.contains('active')) { liveSeconds++; updateTimer() } }, 1000)

// ---------- answers (all AI via the backend) ----------
function systemPrompt() {
  const resume = currentSession?.resume || getResume()
  const jd = currentSession?.jd || ''
  return 'You are a real-time interview assistant. Give a short speakable answer (2-3 sentences), then 3 bullets, then a longer version. Ground every claim in the resume below. Never invent experience, projects, skills or dates not in the resume. If the resume does not support a claim, say so. Resume:\n' + (resume || '(none)') + '\nJob description:\n' + (jd || '(none)')
}

async function answerQuestion(question) {
  if (!question.trim()) return
  addTranscript('Interviewer: ' + question)
  $('answerBox').innerHTML = '<p class="muted">Thinking…</p>'
  let text = ''
  try {
    const res = await api.aiChat([
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: question },
    ], { temperature: 0.4 })
    text = (res.text || '').trim()
  } catch (e) {
    if (e instanceof ApiError && e.status === 402) { showUpgrade(e.message); $('answerBox').innerHTML = '<p class="muted">Plan limit reached — upgrade to continue.</p>'; return }
    if (e instanceof ApiError && e.status === 503) { $('answerBox').innerHTML = '<p class="muted">AI is not configured yet — the service owner needs to add a provider key in the Admin panel.</p>'; return }
    $('answerBox').innerHTML = '<p class="muted">Could not get an answer: ' + esc(e.message) + '</p>'
    return
  }
  if (!text) { $('answerBox').innerHTML = '<p class="muted">The AI returned an empty answer — try again.</p>'; return }
  const short = text.slice(0, 300)
  $('answerBox').innerHTML = `
    <div class="answer"><h4>Short answer — say this</h4><p>${esc(short)}</p>
    <h4>Longer version</h4><p style="white-space:pre-wrap">${esc(text)}</p>
    <p class="small muted">Answered by the service AI · grounded in your resume where possible.</p></div>`
  $('floatPanel').classList.remove('hidden')
  $('floatBody').innerHTML = `<b>${esc(short)}</b>`
  if (currentSession) {
    currentSession.turns.push({ q: question, a: short })
    saveSessions(getSessions().map((s) => (s.id === currentSession.id ? currentSession : s)))
  }
}

function addTranscript(line) {
  const el = $('transcript')
  if (el.textContent.startsWith('Transcript will') || el.textContent.startsWith('Session started')) el.textContent = ''
  el.textContent += (el.textContent ? '\n' : '') + line
  el.scrollTop = el.scrollHeight
}

$('askBtn').addEventListener('click', () => { const q = $('typedQ').value.trim(); if (q) { answerQuestion(q); $('typedQ').value = '' } })
$('typedQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('askBtn').click() })
$('simulateBtn').addEventListener('click', () => answerQuestion('What is RAG and how do you measure it?'))
$('codeHelpBtn').addEventListener('click', () => answerQuestion('Two Sum — explain the optimal solution with code'))
$('designHelpBtn').addEventListener('click', () => answerQuestion('System design: design a URL shortener'))

// ---------- audio engine: mic + tab audio -> live transcript ----------
// Two transcription paths:
//  1. SpeechRecognition (Chrome only, free) for the mic — fast.
//  2. The service's /api/ai/transcribe (Whisper) for tab / system audio and
//     as the mic fallback — a browser cannot feed tab audio into
//     SpeechRecognition. No API key is needed in the browser anymore.
const LANG_CODE = { English: 'en', Hindi: 'hi', Hinglish: 'hi', Spanish: 'es', French: 'fr', German: 'de', Japanese: 'ja', Mandarin: 'zh' }
const SR_LANG = { English: 'en-US', Hindi: 'hi-IN', Hinglish: 'hi-IN', Spanish: 'es-ES', French: 'fr-FR', German: 'de-DE', Japanese: 'ja-JP', Mandarin: 'zh-CN' }
let micStream = null
let micRecorder = null
let tabRecorder = null
let tabCtx = null
let whisperBusy = false
let whisperQueue = []
let lastWhisperText = ''
let transcribeWarned = false
let whisperErrorShown = false

function audioStatus(text) { const el = $('audioStatus'); if (el) el.textContent = text }
function langCode() { return LANG_CODE[currentSession?.language || getSettings().lang] || 'en' }

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', '']
  for (const m of candidates) { if (!m) return ''; try { if (MediaRecorder.isTypeSupported(m)) return m } catch {} }
  return ''
}

async function whisperTranscribe(blob) {
  try {
    const data = await api.aiTranscribe(blob)
    return (data.text || '').trim()
  } catch (e) {
    if (e instanceof ApiError && e.status === 402) {
      if (!transcribeWarned) { transcribeWarned = true; showUpgrade(e.message) }
      return ''
    }
    if (!whisperErrorShown) {
      whisperErrorShown = true
      addTranscript(e instanceof ApiError && e.status === 503
        ? '[Transcription unavailable: the service owner has not added an AI key yet.]'
        : '[Transcription error: ' + e.message + ']')
    } else {
      audioStatus('⚠️ Transcription error: ' + e.message)
    }
    return ''
  }
}

// Transcribe chunks one at a time so answers stay in order.
async function pumpWhisperQueue() {
  if (whisperBusy) return
  whisperBusy = true
  while (whisperQueue.length) {
    const { blob, label } = whisperQueue.shift()
    const text = await whisperTranscribe(blob)
    if (!text || text.length < 2) continue
    if (text === lastWhisperText) continue // Whisper repeats itself on silence
    lastWhisperText = text
    addTranscript(label + ': ' + text)
    audioStatus('🎧 Last heard ' + new Date().toLocaleTimeString() + ' — ' + label)
    if (isQuestion(text) && $('autoAnswer').checked) answerQuestion(text)
  }
  whisperBusy = false
}

// Record in ~5 second cycles: stop the recorder, send that complete file,
// then start a fresh recorder. Using start(5000) timeslices instead gives
// chunks WITHOUT the file header after the first one, and Whisper rejects
// every one of them as "not a valid media file".
function startWhisperRecorder(stream, label) {
  const audioOnly = new MediaStream(stream.getAudioTracks())
  if (!audioOnly.getAudioTracks().length) return null
  const mime = pickMimeType()
  whisperErrorShown = false
  const ctrl = {
    _stopped: false, _rec: null, _timer: null,
    stop() {
      this._stopped = true
      clearTimeout(this._timer)
      try { if (this._rec && this._rec.state !== 'inactive') this._rec.stop() } catch {}
    },
  }
  const startOne = () => {
    if (ctrl._stopped) return
    let rec
    try { rec = new MediaRecorder(audioOnly, mime ? { mimeType: mime } : undefined) } catch { return }
    ctrl._rec = rec
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 1000) { whisperQueue.push({ blob: e.data, label }); pumpWhisperQueue() } }
    rec.onerror = () => { audioStatus('⚠️ ' + label + ' recorder error — restart capture.') }
    rec.onstop = () => { if (!ctrl._stopped) startOne() }
    try { rec.start() } catch { return }
    ctrl._timer = setTimeout(() => { try { if (rec.state === 'recording') rec.stop() } catch {} }, 5000)
  }
  startOne()
  return ctrl._rec ? ctrl : null
}
function stopRecorder(rec) { try { if (rec && typeof rec.stop === 'function') rec.stop() } catch {} }

// ---------- mic (SpeechRecognition in Chrome, service Whisper fallback) ----------
$('micBtn').addEventListener('click', async () => {
  if (micOn) { stopMic(); return }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (SR) { startMicSR(SR); return }
  // No SpeechRecognition (Firefox / Safari / in-app browsers) — service Whisper mic instead.
  await startMicWhisper()
})

function stopMic() {
  micOn = false
  try { recognition?.stop() } catch {}
  recognition = null
  stopRecorder(micRecorder); micRecorder = null
  micStream?.getTracks().forEach((t) => t.stop()); micStream = null
  $('micBtn').textContent = '🎤 Start Mic'
  audioStatus('Mic stopped.')
}

function startMicSR(SR) {
  recognition = new SR()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = SR_LANG[currentSession?.language || getSettings().lang] || 'en-US'
  let finalText = ''
  let restarting = false
  recognition.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript
      if (e.results[i].isFinal) finalText += t + ' '
      else interim += t
    }
    // Interim text lives in the status line only — the transcript only
    // gets final sentences, so it no longer floods with "…" lines.
    audioStatus('🎙️ Mic hearing… ' + (finalText + interim).trim().slice(-80))
    const text = finalText.trim()
    if (text && isQuestion(text) && $('autoAnswer').checked) {
      addTranscript('You: ' + text)
      answerQuestion(text)
      finalText = ''
    } else if (text && text.length > 200) { addTranscript('You: ' + text); finalText = '' }
  }
  recognition.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      addTranscript('[Mic blocked — allow microphone access in the browser address bar, then try again.]')
      stopMic()
    } else if (e.error === 'network') {
      audioStatus('⚠️ Mic speech service lost network — retrying…')
    } else {
      addTranscript('[Mic error: ' + e.error + ' — type the question instead.]')
    }
  }
  recognition.onend = () => {
    // Chrome stops recognition after pauses; restart while mic is on.
    if (micOn && !restarting) {
      restarting = true
      setTimeout(() => { restarting = false; if (micOn) { try { recognition.start() } catch {} } }, 300)
    }
  }
  try {
    recognition.start()
    micOn = true
    $('micBtn').textContent = '⏹ Stop Mic'
    addTranscript('[Mic listening (speech recognition)… speak the question, or capture the Meet/Zoom tab for the interviewer.]')
    audioStatus('🎙️ Mic on — listening…')
  } catch (err) {
    addTranscript('[Mic could not start: ' + err.message + ' — trying service transcription instead.]')
    startMicWhisper()
  }
}

async function startMicWhisper() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
    micRecorder = startWhisperRecorder(micStream, 'You')
    if (!micRecorder) { addTranscript('[Mic recorder could not start in this browser.]'); return }
    micOn = true
    $('micBtn').textContent = '⏹ Stop Mic'
    addTranscript('[Mic listening (service transcription)… speak and the transcript will appear in ~5 second chunks.]')
    audioStatus('🎙️ Mic on (service) — listening…')
  } catch (err) {
    alert('Microphone was blocked or is unavailable. Allow microphone access and retry. (' + err.message + ')')
  }
}

// ---------- tab audio (Meet/Zoom in browser) — transcribed by the service ----------
$('tabAudioBtn').addEventListener('click', async () => {
  if (tabStream) { stopTabAudio(); return }
  try {
    tabStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    const audioTracks = tabStream.getAudioTracks()
    if (!audioTracks.length) {
      addTranscript('[This capture has NO audio track — stop it, pick the Meet/Zoom tab again and tick “Share audio” before sharing.]')
      tabStream.getTracks().forEach((t) => t.stop()); tabStream = null
      return
    }
    // Level meter (visual only).
    tabCtx = new AudioContext()
    const src = tabCtx.createMediaStreamSource(new MediaStream(audioTracks))
    const analyser = tabCtx.createAnalyser()
    src.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      if (!tabStream || tabStream.getTracks().every((t) => t.readyState === 'ended')) return
      analyser.getByteFrequencyData(data)
      const level = Math.round(data.reduce((a, b) => a + b, 0) / data.length)
      $('tabAudioBtn').textContent = '🔊 Tab audio live · level ' + level + ' (click to stop)'
      requestAnimationFrame(tick)
    }
    tick()
    tabStream.getVideoTracks()[0]?.addEventListener('ended', () => stopTabAudio())
    audioTracks[0].addEventListener('ended', () => stopTabAudio())
    // Real transcription: 5-second chunks of the tab audio only, via the service.
    tabRecorder = startWhisperRecorder(tabStream, 'Interviewer')
    if (!tabRecorder) addTranscript('[Tab audio captured, but the recorder could not start in this browser — type the question or use the mic as well.]')
    else addTranscript('[Tab audio live — the interviewer’s voice will be transcribed in ~5 second chunks. Pick the Meet/Zoom tab and keep “Share audio” ticked.]')
  } catch (err) {
    alert('Tab capture was cancelled or is not supported. Use the mic or type the question instead. (' + err.message + ')')
  }
})

function stopTabAudio() {
  stopRecorder(tabRecorder); tabRecorder = null
  tabStream?.getTracks().forEach((t) => t.stop()); tabStream = null
  tabCtx?.close().catch(() => {}); tabCtx = null
  $('tabAudioBtn').textContent = '🗂️ Capture Meet/Zoom Tab Audio'
  audioStatus('Tab audio stopped.')
}

// ---------- screenshot: capture the screen, READ the question, answer it ----------
// The service reads the screenshot (backend /api/ai/vision) — no key needed here.
async function serviceVision(image) {
  try {
    const res = await api.aiVision(image)
    return { text: (res.text || '').trim() }
  } catch (e) {
    if (e instanceof ApiError && e.status === 402) return { error: '402', message: e.message }
    return { error: 'vision', message: e.message }
  }
}

$('shotBtn').addEventListener('click', async () => {
  let stream = null
  try {
    $('shotBox').innerHTML = '<p class="small muted">📸 Pick the screen or window with the question…</p>'
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    const track = stream.getVideoTracks()[0]
    const video = document.createElement('video')
    video.srcObject = stream
    await video.play()
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d').drawImage(video, 0, 0)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
    stream.getTracks().forEach((t) => t.stop())
    stream = null
    $('shotBox').innerHTML = `<img src="${dataUrl}" style="max-width:100%;border-radius:8px" /><p class="small muted">📸 Reading the screenshot…</p>`
    const r = await serviceVision(dataUrl)
    if (r.error === '402') { showUpgrade(r.message); $('shotBox').innerHTML += '<p class="small muted">Plan limit reached — upgrade to continue.</p>'; return }
    if (r.error) {
      $('shotBox').innerHTML += '<p class="small muted">Could not read the screenshot: ' + esc(r.message) + '</p>'
      return
    }
    const q = r.text
    if (!q || /^NO QUESTION FOUND/i.test(q)) {
      $('shotBox').innerHTML += '<p class="small muted">No question found in the screenshot — make sure the problem is visible on screen, then try again.</p>'
      return
    }
    $('shotBox').innerHTML += `<p><b>Read from screen:</b> ${esc(q)}</p>`
    answerQuestion(q)
  } catch (err) {
    stream?.getTracks().forEach((t) => t.stop())
    if (err?.name === 'NotAllowedError') $('shotBox').innerHTML = '<p class="small muted">Screenshot was cancelled.</p>'
    else $('shotBox').innerHTML = '<p class="small muted">Screenshot failed: ' + esc(err.message) + '</p>'
  }
})

// ---------- floating panel ----------
$('floatMinBtn').addEventListener('click', () => { $('floatBody').style.display = $('floatBody').style.display === 'none' ? '' : 'none' })
$('floatCloseBtn').addEventListener('click', () => $('floatPanel').classList.add('hidden'))
$('discreetToggle').addEventListener('change', (e) => $('floatPanel').classList.toggle('discreet', e.target.checked))
$('smallTextToggle').addEventListener('change', (e) => $('floatPanel').classList.toggle('smallText', e.target.checked))

// ---------- end session & notes ----------
function makeNotes(session) {
  const qs = session.turns.map((t) => t.q)
  const score = session.turns.length ? Math.min(100, 55 + session.turns.length * 7) : 50
  return {
    summary: `Session with ${session.company || 'the interviewer'} (${session.mode}, ${session.turns.length} questions answered). ${qs.length ? 'Covered: ' + qs.slice(0, 3).join('; ') + '.' : 'No questions were recorded.'}`,
    keyPoints: qs.slice(0, 5).map((q) => 'Answered: ' + q),
    actionItems: ['Review the answers given and tighten the weakest one.', 'Add the missed details to your resume notes.', 'Practise the same questions in Mock Interview.'],
    score,
  }
}
$('endLiveBtn').addEventListener('click', () => {
  if (!currentSession) { show('sessions'); return }
  stopMic()
  stopTabAudio()
  currentSession.notes = makeNotes(currentSession)
  currentSession.score = currentSession.notes.score
  saveSessions(getSessions().map((s) => (s.id === currentSession.id ? currentSession : s)))
  $('floatPanel').classList.add('hidden')
  alert('Session saved with AI notes. Score: ' + currentSession.score + '/100')
  openSession(currentSession.id)
  currentSession = null
  sessionGatePassed = false
})

// ---------- mock interview (AI feedback via the backend) ----------
const mockTopicEl = $('mockTopic')
mockTopicEl.innerHTML = Object.keys(MOCK_QUESTIONS).map((t) => `<option>${esc(t)}</option>`).join('')
$('startMockBtn').addEventListener('click', async () => {
  try {
    const r = await api.mocksStart()
    if (meData) { meData.usage = { ...(meData.usage || {}), mocks_used: r.mocks_used, mock_limit: r.mock_limit } }
  } catch (e) {
    if (e instanceof ApiError && e.status === 402) { showUpgrade(e.message); return }
    alert('Could not start the mock interview: ' + e.message)
    return
  }
  const topic = mockTopicEl.value
  mockState = { topic, company: $('mockCompany').value.trim(), questions: [...MOCK_QUESTIONS[topic]], idx: 0, answers: [], scores: [] }
  $('mockSetup').style.display = 'none'
  $('mockRun').style.display = ''
  $('mockResult').style.display = 'none'
  $('mockFeedback').innerHTML = ''
  showMockQ()
})
function showMockQ() {
  $('mockProgress').textContent = `Question ${mockState.idx + 1} of ${mockState.questions.length} — ${mockState.topic}`
  $('mockQ').textContent = mockState.questions[mockState.idx]
  $('mockA').value = ''
}
async function aiFeedback(question, answer) {
  const res = await api.aiChat([
    { role: 'system', content: 'You are a strict but fair interview coach. The candidate answered an interview question. Reply with exactly two lines and nothing else:\nScore: <number 0-100>\nFeedback: <two sentences of specific advice — what was good, and the one thing to improve>.' },
    { role: 'user', content: 'Question: ' + question + '\nCandidate answer: ' + (answer || '(no answer given)') },
  ], { temperature: 0.3, max_tokens: 400 })
  const text = (res.text || '').trim()
  const m = text.match(/Score:\s*(\d{1,3})/i)
  const fb = (text.match(/Feedback:\s*([\s\S]*)/i)?.[1] || text).trim()
  return { score: m ? Math.max(0, Math.min(100, parseInt(m[1], 10))) : null, fb }
}
$('mockNextBtn').addEventListener('click', async () => {
  const answer = $('mockA').value
  const q = mockState.questions[mockState.idx]
  $('mockNextBtn').disabled = true
  $('mockFeedback').innerHTML = '<p class="muted">Getting feedback…</p>'
  let score = null
  let fb = ''
  try {
    const r = await aiFeedback(q, answer)
    score = r.score; fb = r.fb
  } catch (e) {
    if (e instanceof ApiError && e.status === 402) { showUpgrade(e.message); $('mockNextBtn').disabled = false; return }
    fb = 'Feedback is unavailable right now: ' + e.message
  }
  $('mockNextBtn').disabled = false
  mockState.answers.push({ q, a: answer })
  mockState.scores.push(score)
  $('mockFeedback').innerHTML = `<div class="answer"><h4>Feedback${score !== null ? ' — ' + score + '/100' : ''}</h4><p>${esc(fb)}</p></div>`
  mockState.idx++
  if (mockState.idx >= mockState.questions.length) {
    setTimeout(finishMock, 600)
  } else {
    setTimeout(showMockQ, 600)
  }
})
function finishMock() {
  const nums = mockState.scores.filter((s) => typeof s === 'number')
  const avg = nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null
  const session = { id: 's' + Date.now(), mode: 'Mock', company: mockState.company, role: mockState.topic, language: getSettings().lang, createdAt: Date.now(), turns: mockState.answers.map((x) => ({ q: x.q, a: x.a })), notes: { summary: `Mock interview on ${mockState.topic}: ${mockState.answers.length} questions answered.`, keyPoints: mockState.answers.map((x) => x.q), actionItems: ['Re-do the lowest-scored question.', 'Practise the same topic again tomorrow.'] }, score: avg }
  const list = getSessions(); list.unshift(session); saveSessions(list)
  $('mockRun').style.display = 'none'
  $('mockResult').style.display = ''
  $('mockResult').innerHTML = `<h3>Mock complete — ${avg !== null ? avg + '/100' : 'no score'}</h3><p>${esc(avg === null ? 'No scores were recorded (the AI feedback was unavailable).' : avg >= 75 ? 'Strong. Keep practising the weaker questions.' : avg >= 55 ? 'Good base. Work on concrete examples and structure.' : 'Keep practising — aim for a concrete example in every answer.')}</p><button class="btn" onclick="document.querySelector('[data-nav=sessions]').click()">View in Sessions</button>`
  $('mockSetup').style.display = ''
  mockState = null
}
$('mockEndBtn').addEventListener('click', () => { if (mockState) finishMock() })

// ---------- question bank ----------
function renderBank() {
  $('bankList').innerHTML = Object.entries(QUESTION_BANK).map(([company, qs]) => `
    <div class="card glass"><h3>${esc(company)}</h3>${qs.map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>`).join('')
  document.querySelectorAll('#bankList .chip').forEach((c) => c.addEventListener('click', async () => {
    if (!currentSession) {
      const session = { id: 's' + Date.now(), mode: 'Interview', company: '', role: '', language: getSettings().lang, resume: getResume(), jd: '', createdAt: Date.now(), turns: [], notes: null, score: null }
      const ok = await beginLiveSession(session)
      if (!ok) return
    }
    show('live')
    answerQuestion(c.dataset.q)
  }))
}

// ---------- settings & docs ----------
async function renderSettings() {
  const s = getSettings()
  $('setLang').value = s.lang || 'English'
  const resume = getResume()
  $('savedResumeInfo').textContent = resume ? `Saved resume: ${resume.length} characters. First line: ${resume.split('\n')[0] || ''}` : 'No resume saved yet — paste one in New Session.'
  // Account info from the backend
  try {
    if (!meData) meData = await api.me()
    const u = meData.user
    const sub = meData.subscription
    const usg = meData.usage || {}
    $('accountInfo').innerHTML = `
      <p><b>${esc(u.name)}</b> · ${esc(u.email)} · role <b>${esc(u.role)}</b></p>
      <p class="muted small">Plan: <b>${esc(u.plan_slug || 'free')}</b>${sub ? ` · ${esc(sub.status)}${sub.expires_at ? ' until ' + esc(new Date(sub.expires_at).toLocaleDateString()) : ''}` : ' · no active subscription'}</p>
      <p class="muted small">Usage: ${usg.sessions_used ?? '—'}${usg.sessions_limit ? ' / ' + usg.sessions_limit : ''} sessions · ${usg.mocks_used ?? '—'}${usg.mock_limit ? ' / ' + usg.mock_limit : ''} mocks</p>`
    $('cancelSubBtn').style.display = sub && sub.status === 'active' ? '' : 'none'
  } catch (e) {
    $('accountInfo').innerHTML = '<p class="muted">Could not load account info: ' + esc(e.message) + '</p>'
  }
  await refreshAiStatus()
  const docs = store.get(DOCS_KEY(), [])
  $('docsList').innerHTML = docs.length ? docs.map((d, i) => `<p><b>${esc(d.title)}</b> <button class="btn ghost small" data-docdel="${i}">Delete</button><br/><span class="muted small">${esc(d.text.slice(0, 200))}</span></p>`).join('') : '<p class="muted small">No documents yet.</p>'
  document.querySelectorAll('[data-docdel]').forEach((b) => b.addEventListener('click', () => {
    const d = store.get(DOCS_KEY(), []); d.splice(+b.dataset.docdel, 1); store.set(DOCS_KEY(), d); renderSettings()
  }))
}
$('saveSettingsBtn').addEventListener('click', () => {
  store.set(SETTINGS_KEY(), { lang: $('setLang').value })
  alert('Settings saved in this browser only.')
})
$('cancelSubBtn').addEventListener('click', async () => {
  if (!confirm('Cancel your subscription? You keep access until it expires.')) return
  try {
    await api.cancelSubscription()
    meData = await api.me()
    alert('Subscription cancelled — access continues until expiry.')
    renderSettings(); await loadPublicPlans()
  } catch (e) { alert('Could not cancel: ' + e.message) }
})
$('clearDataBtn').addEventListener('click', () => {
  if (!confirm('Clear all saved sessions, resume, documents and settings in this browser? (Your account and plan are kept on the service.)')) return
  ;[SESSIONS_KEY(), RESUME_KEY(), DOCS_KEY(), SETTINGS_KEY()].forEach((k) => localStorage.removeItem(k))
  renderSettings(); renderSessions(); renderOverview()
})
$('addDocBtn').addEventListener('click', () => {
  const title = $('docTitle').value.trim()
  const text = $('docText').value.trim()
  if (!title || !text) { alert('Add a title and text for the document.'); return }
  const docs = store.get(DOCS_KEY(), []); docs.push({ title, text }); store.set(DOCS_KEY(), docs)
  $('docTitle').value = ''; $('docText').value = ''
  renderSettings()
})

// ---------- admin panel ----------
let adminTab = 'overview'
document.querySelectorAll('#adminTabs .chip').forEach((c) => c.addEventListener('click', () => {
  adminTab = c.dataset.atab
  document.querySelectorAll('#adminTabs .chip').forEach((x) => x.classList.toggle('active', x === c))
  renderAdmin(adminTab)
}))
function renderAdmin(tab) {
  if (!isAdmin()) { show('home'); return }
  adminTab = tab
  document.querySelectorAll('#admin .atab').forEach((el) => { el.style.display = el.id === 'admin' + tab[0].toUpperCase() + tab.slice(1) ? '' : 'none' })
  document.querySelectorAll('#adminTabs .chip').forEach((x) => x.classList.toggle('active', x.dataset.atab === tab))
  if (tab === 'overview') loadAdminOverview()
  if (tab === 'users') loadAdminUsers()
  if (tab === 'subs') loadAdminSubs()
  if (tab === 'payments') loadAdminPayments()
  if (tab === 'plans') loadAdminPlans()
  if (tab === 'providers') loadAdminProviders()
}
function adminErr(el, e) { el.innerHTML = '<p class="muted">Could not load: ' + esc(e.message) + '</p>' }

async function loadAdminOverview() {
  const el = $('adminOverview')
  el.innerHTML = '<p class="muted">Loading…</p>'
  try {
    const o = await api.adminOverview()
    el.innerHTML = `<div class="grid">
      <div class="card glass stat"><div class="stat-num">${o.users_total ?? 0}</div><div class="muted small">Total users</div></div>
      <div class="card glass stat"><div class="stat-num">${o.paying_users ?? 0}</div><div class="muted small">Paying users</div></div>
      <div class="card glass stat"><div class="stat-num">${o.free_users ?? 0}</div><div class="muted small">Free users</div></div>
      <div class="card glass stat"><div class="stat-num">${o.active_subscriptions ?? 0}</div><div class="muted small">Active subscriptions</div></div>
      <div class="card glass stat"><div class="stat-num">$${Number(o.revenue_total || 0).toFixed(2)}</div><div class="muted small">Revenue (successful payments)</div></div>
      <div class="card glass stat"><div class="stat-num">${o.ai_calls_today ?? 0}</div><div class="muted small">AI calls today</div></div>
    </div>
    <p class="muted small">Tip: set your provider keys under AI Providers, and your prices under Plans. Users pay with Cashfree; subscriptions activate automatically.</p>`
  } catch (e) { adminErr(el, e) }
}

async function loadAdminUsers() {
  const el = $('adminUsers')
  el.innerHTML = '<p class="muted">Loading…</p>'
  try {
    const users = await api.adminUsers()
    if (!users.length) { el.innerHTML = '<p class="muted">No users yet.</p>'; return }
    el.innerHTML = `<div class="table-wrap"><table>
      <tr><th>Name</th><th>Email</th><th>Role</th><th>Plan</th><th>Subscription</th><th>Usage</th><th>Grant access</th></tr>
      ${users.map((u) => `<tr>
        <td>${esc(u.name)}</td><td>${esc(u.email)}</td>
        <td><select data-role="${u.id}"><option value="user" ${u.role === 'user' ? 'selected' : ''}>user</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option></select>
            <button class="btn ghost small" data-saverole="${u.id}">Save</button></td>
        <td>${esc(u.plan_slug)}</td>
        <td>${u.subscription ? esc(u.subscription.plan_slug) + ' · ' + esc(u.subscription.status) + (u.subscription.expires_at ? '<br/><span class="muted small">until ' + esc(new Date(u.subscription.expires_at).toLocaleDateString()) + '</span>' : '') : '<span class="muted">—</span>'}</td>
        <td class="small">${u.sessions_used ?? 0} sessions · ${u.mocks_used ?? 0} mocks</td>
        <td><select data-grantplan="${u.id}"><option value="weekly">weekly</option><option value="monthly">monthly</option><option value="yearly">yearly</option><option value="free">free</option></select>
            <input data-grantdays="${u.id}" type="number" min="1" placeholder="days" style="width:80px;display:inline-block;margin:0" />
            <button class="btn ghost small" data-grant="${u.id}">Grant</button></td>
      </tr>`).join('')}
    </table></div>`
    el.querySelectorAll('[data-saverole]').forEach((b) => b.addEventListener('click', async () => {
      const role = el.querySelector(`[data-role="${b.dataset.saverole}"]`).value
      try { await api.adminPatchUser(b.dataset.saverole, { role }); alert('Role updated.'); loadAdminUsers() }
      catch (e) { alert('Could not update role: ' + e.message) }
    }))
    el.querySelectorAll('[data-grant]').forEach((b) => b.addEventListener('click', async () => {
      const plan = el.querySelector(`[data-grantplan="${b.dataset.grant}"]`).value
      const days = parseInt(el.querySelector(`[data-grantdays="${b.dataset.grant}"]`).value || '', 10)
      try { await api.adminGrant(b.dataset.grant, plan, Number.isFinite(days) ? days : undefined); alert('Access granted: ' + plan + '.'); loadAdminUsers() }
      catch (e) { alert('Could not grant access: ' + e.message) }
    }))
  } catch (e) { adminErr(el, e) }
}

async function loadAdminSubs() {
  const el = $('adminSubs')
  el.innerHTML = '<p class="muted">Loading…</p>'
  try {
    const subs = await api.adminSubscriptions()
    el.innerHTML = subs.length ? `<div class="table-wrap"><table>
      <tr><th>User</th><th>Plan</th><th>Status</th><th>Amount</th><th>Starts</th><th>Expires</th><th>Order</th></tr>
      ${subs.map((s) => `<tr><td>${esc(s.email || s.user_email || '')}</td><td>${esc(s.plan_slug)}</td><td>${esc(s.status)}</td><td>${esc(s.amount ?? '')} ${esc(s.currency || '')}</td><td>${s.starts_at ? esc(new Date(s.starts_at).toLocaleString()) : '—'}</td><td>${s.expires_at ? esc(new Date(s.expires_at).toLocaleString()) : '—'}</td><td class="small">${esc(s.cf_order_id || '')}</td></tr>`).join('')}
    </table></div>` : '<p class="muted">No subscriptions yet.</p>'
  } catch (e) { adminErr(el, e) }
}

async function loadAdminPayments() {
  const el = $('adminPayments')
  el.innerHTML = '<p class="muted">Loading…</p>'
  try {
    const pays = await api.adminPayments()
    el.innerHTML = pays.length ? `<div class="table-wrap"><table>
      <tr><th>User</th><th>Plan</th><th>Amount</th><th>Status</th><th>Order</th><th>Payment ID</th><th>When</th></tr>
      ${pays.map((p) => `<tr><td>${esc(p.email || p.user_email || '')}</td><td>${esc(p.plan_slug)}</td><td>${esc(p.amount ?? '')} ${esc(p.currency || '')}</td><td>${esc(p.status)}</td><td class="small">${esc(p.cf_order_id || '')}</td><td class="small">${esc(p.cf_payment_id || '')}</td><td>${p.created_at ? esc(new Date(p.created_at).toLocaleString()) : '—'}</td></tr>`).join('')}
    </table></div>` : '<p class="muted">No payments yet.</p>'
  } catch (e) { adminErr(el, e) }
}

async function loadAdminPlans() {
  const el = $('adminPlans')
  el.innerHTML = '<p class="muted">Loading…</p>'
  try {
    const plans = await api.adminPlans()
    el.innerHTML = plans.map((p) => `
      <div class="card glass">
        <div class="row"><h3 style="margin:0">${esc(p.slug)}</h3><span class="chip">${p.active ? 'active' : 'inactive'}</span></div>
        <div class="row">
          <div style="flex:1;min-width:140px"><label>Name</label><input data-p="${esc(p.slug)}" data-f="name" value="${esc(p.name || '')}" /></div>
          <div style="width:130px"><label>Price</label><input data-p="${esc(p.slug)}" data-f="price" type="number" step="0.01" min="0" value="${esc(p.price ?? '')}" /></div>
          <div style="width:100px"><label>Currency</label><input data-p="${esc(p.slug)}" data-f="currency" value="${esc(p.currency || 'USD')}" /></div>
          <div style="width:130px"><label>Duration (days)</label><input data-p="${esc(p.slug)}" data-f="duration_days" type="number" min="0" value="${esc(p.duration_days ?? '')}" /></div>
        </div>
        <div class="row">
          <div style="width:150px"><label>Sessions limit (blank = unlimited)</label><input data-p="${esc(p.slug)}" data-f="sessions_limit" type="number" min="0" value="${esc(p.sessions_limit ?? '')}" /></div>
          <div style="width:150px"><label>Minutes / session</label><input data-p="${esc(p.slug)}" data-f="minutes_per_session" type="number" min="0" value="${esc(p.minutes_per_session ?? '')}" /></div>
          <div style="width:150px"><label>Mock limit (blank = unlimited)</label><input data-p="${esc(p.slug)}" data-f="mock_limit" type="number" min="0" value="${esc(p.mock_limit ?? '')}" /></div>
          <div><label><input data-p="${esc(p.slug)}" data-f="active" type="checkbox" style="width:auto" ${p.active ? 'checked' : ''} /> Active (shown on Pricing page)</label></div>
        </div>
        <label>Features (one per line)</label>
        <textarea data-p="${esc(p.slug)}" data-f="features">${esc((p.features || []).join('\n'))}</textarea>
        <button class="btn small" data-saveplan="${esc(p.slug)}">Save plan</button>
      </div>`).join('') + `
      <div class="card glass">
        <h3>Create a new plan</h3>
        <div class="row">
          <div style="flex:1;min-width:120px"><label>Slug</label><input id="newPlanSlug" placeholder="e.g. quarterly" /></div>
          <div style="flex:1;min-width:120px"><label>Name</label><input id="newPlanName" placeholder="e.g. Quarterly" /></div>
          <div style="width:130px"><label>Price</label><input id="newPlanPrice" type="number" step="0.01" min="0" placeholder="99" /></div>
          <div style="width:130px"><label>Duration (days)</label><input id="newPlanDays" type="number" min="0" placeholder="90" /></div>
        </div>
        <button class="btn small" id="createPlanBtn">Create plan</button>
      </div>`
    el.querySelectorAll('[data-saveplan]').forEach((b) => b.addEventListener('click', async () => {
      const slug = b.dataset.saveplan
      const patch = {}
      el.querySelectorAll(`[data-p="${slug}"]`).forEach((inp) => {
        const f = inp.dataset.f
        if (inp.type === 'checkbox') { patch[f] = inp.checked; return }
        if (f === 'features') { patch[f] = inp.value.split('\n').map((x) => x.trim()).filter(Boolean); return }
        if (f === 'name' || f === 'currency') { patch[f] = inp.value.trim(); return }
        patch[f] = inp.value === '' ? null : Number(inp.value)
      })
      try { await api.adminPlanPut(slug, patch); alert('Plan saved.'); loadAdminPlans(); loadPublicPlans() }
      catch (e) { alert('Could not save plan: ' + e.message) }
    }))
    $('createPlanBtn').addEventListener('click', async () => {
      const slug = $('newPlanSlug').value.trim()
      const name = $('newPlanName').value.trim()
      const price = Number($('newPlanPrice').value)
      const days = Number($('newPlanDays').value)
      if (!slug || !name || !Number.isFinite(price)) { alert('Slug, name and price are required.'); return }
      try { await api.adminPlanCreate({ slug, name, price, currency: 'USD', duration_days: Number.isFinite(days) ? days : 30, sessions_limit: null, minutes_per_session: null, mock_limit: null, features: [], active: true }); alert('Plan created.'); loadAdminPlans(); loadPublicPlans() }
      catch (e) { alert('Could not create plan: ' + e.message) }
    })
  } catch (e) { adminErr(el, e) }
}

async function loadAdminProviders() {
  const el = $('adminProviders')
  el.innerHTML = '<p class="muted">Loading…</p>'
  try {
    const data = await api.adminProviders()
    const masked = data.keys_masked || {}
    const models = data.models || {}
    const keyField = (id, label, key) => `
      <label>${label}</label>
      <input id="${id}" type="password" placeholder="${masked[key] ? 'Set — ends ' + masked[key] : 'Not set — paste the key to set it'}" autocomplete="off" />
      <p class="small muted">${masked[key] ? 'Currently set (ends ' + esc(masked[key]) + '). Leave blank to keep it. ' : 'Not set. '} <button class="btn ghost small" type="button" data-clearkey="${key}">Clear key</button></p>`
    el.innerHTML = `<div class="card glass">
      <p class="muted small">Your provider keys are stored encrypted on the server and never shown in full — not even to you here. Leave a key blank to keep the current one.</p>
      <label>Default AI provider</label>
      <select id="pvDefault">
        ${['groq', 'openai', 'gemini', 'claude'].map((p) => `<option value="${p}" ${data.default_provider === p ? 'selected' : ''}>${p}</option>`).join('')}
      </select>
      ${keyField('pvGroqKey', 'Groq key', 'groq')}
      ${keyField('pvOpenaiKey', 'OpenAI (ChatGPT) key', 'openai')}
      ${keyField('pvGeminiKey', 'Google Gemini key', 'gemini')}
      ${keyField('pvClaudeKey', 'Anthropic (Claude) key', 'claude')}
      <div class="row">
        <div style="flex:1;min-width:200px"><label>Groq chat model</label><input id="pvGroqModel" value="${esc(models.groq_model || 'openai/gpt-oss-120b')}" /></div>
        <div style="flex:1;min-width:200px"><label>OpenAI chat model</label><input id="pvOpenaiModel" value="${esc(models.openai_model || 'gpt-4o-mini')}" /></div>
      </div>
      <div class="row">
        <div style="flex:1;min-width:200px"><label>Gemini chat model</label><input id="pvGeminiModel" value="${esc(models.gemini_model || 'gemini-2.0-flash')}" /></div>
        <div style="flex:1;min-width:200px"><label>Claude chat model</label><input id="pvClaudeModel" value="${esc(models.claude_model || 'claude-sonnet-4-20250514')}" /></div>
      </div>
      <p class="small muted">Vision models (used for screenshot reading): ${esc(JSON.stringify(models.vision_models || models.vision || 'server defaults'))}</p>
      <button class="btn" id="saveProvidersBtn">Save provider settings</button>
      <p class="small muted" id="pvResult"></p>
    </div>`
    el.querySelectorAll('[data-clearkey]').forEach((b) => b.addEventListener('click', async () => {
      if (!confirm('Clear the ' + b.dataset.clearkey + ' key? The provider will stop working until a new key is added.')) return
      try { await api.adminProvidersPut({ [b.dataset.clearkey + '_key']: null }); $('pvResult').textContent = b.dataset.clearkey + ' key cleared.'; loadAdminProviders() }
      catch (e) { $('pvResult').textContent = 'Could not clear the key: ' + e.message }
    }))
    $('saveProvidersBtn').addEventListener('click', async () => {
      const patch = { default_provider: $('pvDefault').value }
      const keyMap = { groq_key: $('pvGroqKey').value.trim(), openai_key: $('pvOpenaiKey').value.trim(), gemini_key: $('pvGeminiKey').value.trim(), claude_key: $('pvClaudeKey').value.trim() }
      for (const [k, v] of Object.entries(keyMap)) if (v) patch[k] = v
      patch.groq_model = $('pvGroqModel').value.trim()
      patch.openai_model = $('pvOpenaiModel').value.trim()
      patch.gemini_model = $('pvGeminiModel').value.trim()
      patch.claude_model = $('pvClaudeModel').value.trim()
      try { await api.adminProvidersPut(patch); $('pvResult').textContent = '✅ Provider settings saved.'; refreshAiStatus() }
      catch (e) { $('pvResult').textContent = 'Could not save: ' + e.message }
    })
  } catch (e) { adminErr(el, e) }
}

// ---------- init ----------
async function init() {
  renderBank()
  await loadPublicPlans()
  const params = new URLSearchParams(location.search)
  pendingOrderId = params.get('order_id') || params.get('cf_order_id')
  if (pendingOrderId) history.replaceState(null, '', location.pathname)
  if (isLoggedIn()) {
    try {
      meData = await api.me()
      setBodyAuth()
      await refreshAiStatus()
      show('overview')
      if (pendingOrderId) { const oid = pendingOrderId; pendingOrderId = null; await handleVerify(oid) }
    } catch (e) {
      showAuth(e.message || 'Could not reach the service. Try again.')
    }
  } else {
    // Guests start on the landing page, not the login form.
    setBodyAuth()
    show('home')
    if (pendingOrderId) {
      showAuth()
      $('authError').textContent = 'Log in to finish verifying your payment.'
      $('authError').style.display = ''
    }
  }
}
init()
