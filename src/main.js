import { findAnswer, genericAnswer, isQuestion, extractResumeFacts, resumeLine, MOCK_QUESTIONS, QUESTION_BANK } from './demo-bank.js'

// ---------- storage ----------
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } },
  set(k, v) { localStorage.setItem(k, JSON.stringify(v)) },
}
const SESSIONS_KEY = 'ia_sessions'
const RESUME_KEY = 'ia_resume'
const DOCS_KEY = 'ia_docs'
const SETTINGS_KEY = 'ia_settings'

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// ---------- navigation ----------
function show(sectionId) {
  document.querySelectorAll('main section').forEach((s) => s.classList.toggle('active', s.id === sectionId))
  window.scrollTo({ top: 0 })
  if (sectionId === 'dashboard') renderDashboard()
  if (sectionId === 'bank') renderBank()
  if (sectionId === 'settings') renderSettings()
}
document.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => show(b.dataset.nav)))

// ---------- state ----------
let currentSession = null
let liveTimer = null
let liveSeconds = 0
let recognition = null
let micOn = false
let tabStream = null
let mockState = null
let dashFilter = 'All'

// ---------- settings ----------
function getSettings() { return store.get(SETTINGS_KEY, { groqKey: '', groqModel: 'openai/gpt-oss-120b', lang: 'English' }) }
function getResume() { return store.get(RESUME_KEY, '') }
function getSessions() { return store.get(SESSIONS_KEY, []) }
function saveSessions(list) { store.set(SESSIONS_KEY, list) }

// ---------- dashboard ----------
const FILTERS = ['All', 'Interview', 'Regular', 'Mock']
function renderDashboard() {
  $('dashFilters').innerHTML = FILTERS.map((f) => `<button class="chip ${f === dashFilter ? 'active' : ''}" data-f="${f}">${f}</button>`).join('')
  document.querySelectorAll('#dashFilters .chip').forEach((c) => c.addEventListener('click', () => { dashFilter = c.dataset.f; renderDashboard() }))
  const q = ($('dashSearch').value || '').toLowerCase()
  const list = getSessions().filter((s) => (dashFilter === 'All' || s.mode === dashFilter) && (!q || (s.company + ' ' + s.role + ' ' + s.mode).toLowerCase().includes(q)))
  $('dashList').innerHTML = list.length ? list.map((s) => `
    <div class="session">
      <b>${esc(s.company || 'Untitled')} — ${esc(s.role || s.mode)}</b>
      <span class="chip">${esc(s.mode)}</span>
      <span class="muted small">${esc(new Date(s.createdAt).toLocaleString())} · ${s.turns?.length || 0} Q&amp;A · score ${s.score ?? '—'}</span>
      <p class="muted small">${esc((s.notes?.summary || '').slice(0, 160))}</p>
      <button class="btn ghost small" data-open="${s.id}">Open</button>
      <button class="btn ghost small" data-del="${s.id}">Delete</button>
    </div>`).join('') : '<p class="muted">No sessions yet. Create your first session — it will be saved here.</p>'
  document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openSession(b.dataset.open)))
  document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    saveSessions(getSessions().filter((s) => s.id !== b.dataset.del)); renderDashboard()
  }))
}
$('dashSearch').addEventListener('input', renderDashboard)

function openSession(id) {
  const s = getSessions().find((x) => x.id === id)
  if (!s) return
  show('sessionDetail')
  $('sessionDetailBody').innerHTML = `
    <div class="card"><h2>${esc(s.company || 'Session')} — ${esc(s.role || s.mode)}</h2>
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
function startSessionFromForm() {
  const f = readCreateForm()
  if (f.resume) store.set(RESUME_KEY, f.resume)
  const session = { id: 's' + Date.now(), mode: f.mode, company: f.company, role: f.role, language: f.language, resume: f.resume, jd: f.jd, createdAt: Date.now(), turns: [], notes: null, score: null }
  currentSession = session
  const list = getSessions(); list.unshift(session); saveSessions(list)
  $('liveTitle').textContent = `— ${session.company || 'Interview'} · ${session.role || session.mode}`
  $('transcript').textContent = 'Session started. Speak, capture tab audio, or type a question below.'
  $('answerBox').innerHTML = '<p class="muted">Ask a question and the suggested answer will appear here.</p>'
  liveSeconds = 0; updateTimer()
  show('live')
}
$('startLiveBtn').addEventListener('click', startSessionFromForm)
$('saveSessionBtn').addEventListener('click', () => {
  const f = readCreateForm()
  if (f.resume) store.set(RESUME_KEY, f.resume)
  const list = getSessions()
  list.unshift({ id: 's' + Date.now(), mode: f.mode, company: f.company, role: f.role, language: f.language, resume: f.resume, jd: f.jd, createdAt: Date.now(), turns: [], notes: null, score: null })
  saveSessions(list)
  alert('Draft session saved to the Dashboard.')
  show('dashboard')
})

// ---------- live timer ----------
function updateTimer() {
  const m = String(Math.floor(liveSeconds / 60)).padStart(2, '0')
  const s = String(liveSeconds % 60).padStart(2, '0')
  $('liveTimer').textContent = `${m}:${s}`
}
setInterval(() => { if (currentSession && $('live').classList.contains('active')) { liveSeconds++; updateTimer() } }, 1000)

// ---------- answers ----------
async function groqAnswer(question, facts) {
  const settings = getSettings()
  if (!settings.groqKey) return null
  const resume = getResume()
  const jd = currentSession?.jd || ''
  try {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + settings.groqKey },
      body: JSON.stringify({
        model: settings.groqModel || 'openai/gpt-oss-120b',
        messages: [
          { role: 'system', content: 'You are a real-time interview assistant. Give a short speakable answer (2-3 sentences), then 3 bullets, then a longer version. Ground every claim in the resume below. Never invent experience, projects, skills or dates not in the resume. If the resume does not support a claim, say so. Resume:\n' + (resume || '(none)') + '\nJob description:\n' + (jd || '(none)') },
          { role: 'user', content: question },
        ],
        temperature: 0.4,
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    const text = data.choices?.[0]?.message?.content || ''
    if (!text) return null
    return { id: 'groq', short: text.slice(0, 300), bullets: [], long: text }
  } catch { return null }
}

async function answerQuestion(question) {
  if (!question.trim()) return
  const facts = extractResumeFacts(currentSession?.resume || getResume())
  addTranscript('Interviewer: ' + question)
  const groq = await groqAnswer(question, facts)
  const local = findAnswer(question, facts) || genericAnswer(question, facts)
  const ans = groq || local
  const short = ans.short || ans.long || ''
  const bullets = ans.bullets || []
  const long = ans.long || short
  $('answerBox').innerHTML = `
    <div class="answer"><h4>Short answer — say this</h4><p>${esc(short)}</p>
    ${bullets.length ? `<h4>Key points</h4><ul>${bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
    <h4>Longer version</h4><p style="white-space:pre-wrap">${esc(long)}</p>
    ${ans.code ? `<h4>Code</h4><pre>${esc(ans.code)}</pre>` : ''}
    ${ans.diagram ? `<h4>Diagram</h4><pre>${esc(ans.diagram)}</pre>` : ''}
    <p class="small muted">Source: ${groq ? 'Groq (real AI)' : 'local demo answer bank'} · grounded in your resume where possible.</p></div>`
  $('floatPanel').classList.remove('hidden')
  $('floatBody').innerHTML = `<b>${esc(short)}</b>${bullets.length ? '<ul>' + bullets.map((b) => `<li>${esc(b)}</li>`).join('') + '</ul>' : ''}`
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

// ---------- mic (SpeechRecognition) ----------
$('micBtn').addEventListener('click', () => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition
  if (!SR) { alert('Speech recognition is not supported in this browser. Use desktop Chrome, or type the question instead.'); return }
  if (micOn && recognition) { recognition.stop(); micOn = false; $('micBtn').textContent = '🎤 Start Mic'; return }
  recognition = new SR()
  recognition.continuous = true
  recognition.interimResults = true
  recognition.lang = 'en-US'
  let finalText = ''
  recognition.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript
      if (e.results[i].isFinal) finalText += t + ' '
      else interim += t
    }
    addTranscript('… ' + (finalText + interim).trim())
    const text = (finalText + interim).trim()
    if (isQuestion(text) && $('autoAnswer').checked) {
      answerQuestion(text)
      finalText = ''
    }
  }
  recognition.onerror = (e) => { addTranscript('[Mic error: ' + e.error + ' — type the question instead.]') }
  recognition.onend = () => { if (micOn) { try { recognition.start() } catch {} } }
  recognition.start()
  micOn = true
  $('micBtn').textContent = '⏹ Stop Mic'
  addTranscript('[Mic listening… speak the interviewer question.]')
})

// ---------- tab audio (Meet/Zoom in browser) ----------
$('tabAudioBtn').addEventListener('click', async () => {
  try {
    tabStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    const ctx = new AudioContext()
    const src = ctx.createMediaStreamSource(tabStream)
    const analyser = ctx.createAnalyser()
    src.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      if (!tabStream || tabStream.getTracks().every((t) => t.readyState === 'ended')) return
      analyser.getByteFrequencyData(data)
      const level = Math.round(data.reduce((a, b) => a + b, 0) / data.length)
      $('tabAudioBtn').textContent = '🔊 Tab audio live · level ' + level
      requestAnimationFrame(tick)
    }
    tick()
    tabStream.getVideoTracks()[0].addEventListener('ended', () => { $('tabAudioBtn').textContent = '🗂️ Capture Meet/Zoom Tab Audio'; tabStream = null })
    addTranscript('[Tab audio captured — pick the Meet/Zoom tab and tick “Share audio”. Live transcription of tab audio is not available in the browser, so type the question or use the mic as well.]')
  } catch (err) {
    alert('Tab capture was cancelled or is not supported. Use the mic or type the question instead. (' + err.message + ')')
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
  if (!currentSession) { show('dashboard'); return }
  if (micOn && recognition) { try { recognition.stop() } catch {} micOn = false }
  if (tabStream) { tabStream.getTracks().forEach((t) => t.stop()); tabStream = null }
  currentSession.notes = makeNotes(currentSession)
  currentSession.score = currentSession.notes.score
  saveSessions(getSessions().map((s) => (s.id === currentSession.id ? currentSession : s)))
  $('floatPanel').classList.add('hidden')
  alert('Session saved with AI notes. Score: ' + currentSession.score + '/100')
  openSession(currentSession.id)
  currentSession = null
})

// ---------- mock interview ----------
const mockTopicEl = $('mockTopic')
mockTopicEl.innerHTML = Object.keys(MOCK_QUESTIONS).map((t) => `<option>${esc(t)}</option>`).join('')
$('startMockBtn').addEventListener('click', () => {
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
function scoreAnswer(answer, question) {
  const a = (answer || '').trim()
  if (a.length < 20) return { score: 35, fb: 'Too short — give a concrete example and a result, in 3–4 sentences.' }
  if (a.length < 80) return { score: 60, fb: 'Decent start. Add one real example from a project and a number or outcome.' }
  const hasExample = /project|built|implemented|used|worked|example/i.test(a)
  return { score: hasExample ? 85 : 72, fb: hasExample ? 'Good — concrete example and structure. Tighten the opening line so the answer lands in the first sentence.' : 'Good length. Add a concrete project example to make it believable.' }
}
$('mockNextBtn').addEventListener('click', () => {
  const answer = $('mockA').value
  const q = mockState.questions[mockState.idx]
  const { score, fb } = scoreAnswer(answer, q)
  mockState.answers.push({ q, a: answer })
  mockState.scores.push(score)
  $('mockFeedback').innerHTML = `<div class="answer"><h4>Feedback — ${score}/100</h4><p>${esc(fb)}</p></div>`
  mockState.idx++
  if (mockState.idx >= mockState.questions.length) {
    setTimeout(finishMock, 600)
  } else {
    setTimeout(showMockQ, 600)
  }
})
function finishMock() {
  const avg = Math.round(mockState.scores.reduce((a, b) => a + b, 0) / mockState.scores.length)
  const session = { id: 's' + Date.now(), mode: 'Mock', company: mockState.company, role: mockState.topic, language: getSettings().lang, createdAt: Date.now(), turns: mockState.answers.map((x) => ({ q: x.q, a: x.a })), notes: { summary: `Mock interview on ${mockState.topic}: ${mockState.answers.length} questions answered.`, keyPoints: mockState.answers.map((x) => x.q), actionItems: ['Re-do the lowest-scored question.', 'Practise the same topic again tomorrow.'] }, score: avg }
  const list = getSessions(); list.unshift(session); saveSessions(list)
  $('mockRun').style.display = 'none'
  $('mockResult').style.display = ''
  $('mockResult').innerHTML = `<h3>Mock complete — ${avg}/100</h3><p>${esc(avg >= 75 ? 'Strong. Keep practising the weaker questions.' : avg >= 55 ? 'Good base. Work on concrete examples and structure.' : 'Keep practising — aim for a concrete example in every answer.')}</p><button class="btn" onclick="document.querySelector('[data-nav=dashboard]').click()">View in Dashboard</button>`
  $('mockSetup').style.display = ''
  mockState = null
}
$('mockEndBtn').addEventListener('click', () => { if (mockState) finishMock() })

// ---------- question bank ----------
function renderBank() {
  $('bankList').innerHTML = Object.entries(QUESTION_BANK).map(([company, qs]) => `
    <div class="card"><h3>${esc(company)}</h3>${qs.map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>`).join('')
  document.querySelectorAll('#bankList .chip').forEach((c) => c.addEventListener('click', () => {
    if (!currentSession) {
      currentSession = { id: 's' + Date.now(), mode: 'Interview', company: '', role: '', language: getSettings().lang, createdAt: Date.now(), turns: [], notes: null, score: null }
      const list = getSessions(); list.unshift(currentSession); saveSessions(list)
    }
    show('live')
    answerQuestion(c.dataset.q)
  }))
}

// ---------- settings & docs ----------
function renderSettings() {
  const s = getSettings()
  $('groqKey').value = s.groqKey || ''
  $('groqModel').value = s.groqModel || 'openai/gpt-oss-120b'
  $('setLang').value = s.lang || 'English'
  const resume = getResume()
  $('savedResumeInfo').textContent = resume ? `Saved resume: ${resume.length} characters. First line: ${resume.split('\n')[0] || ''}` : 'No resume saved yet — paste one in New Session.'
  const docs = store.get(DOCS_KEY, [])
  $('docsList').innerHTML = docs.length ? docs.map((d, i) => `<p><b>${esc(d.title)}</b> <button class="btn ghost small" data-docdel="${i}">Delete</button><br/><span class="muted small">${esc(d.text.slice(0, 200))}</span></p>`).join('') : '<p class="muted small">No documents yet.</p>'
  document.querySelectorAll('[data-docdel]').forEach((b) => b.addEventListener('click', () => {
    const d = store.get(DOCS_KEY, []); d.splice(+b.dataset.docdel, 1); store.set(DOCS_KEY, d); renderSettings()
  }))
}
$('saveSettingsBtn').addEventListener('click', () => {
  store.set(SETTINGS_KEY, { groqKey: $('groqKey').value.trim(), groqModel: $('groqModel').value.trim() || 'openai/gpt-oss-120b', lang: $('setLang').value })
  alert('Settings saved in this browser only.')
})
$('clearDataBtn').addEventListener('click', () => {
  if (!confirm('Clear all saved sessions, resume, documents and settings in this browser?')) return
  ;[SESSIONS_KEY, RESUME_KEY, DOCS_KEY, SETTINGS_KEY].forEach((k) => localStorage.removeItem(k))
  renderSettings(); renderDashboard()
})
$('addDocBtn').addEventListener('click', () => {
  const title = $('docTitle').value.trim()
  const text = $('docText').value.trim()
  if (!title || !text) { alert('Add a title and text for the document.'); return }
  const docs = store.get(DOCS_KEY, []); docs.push({ title, text }); store.set(DOCS_KEY, docs)
  $('docTitle').value = ''; $('docText').value = ''
  renderSettings()
})

// ---------- init ----------
renderDashboard()
renderBank()
