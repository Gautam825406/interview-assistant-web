// Local demo answer bank. No API key needed.
// Answers are grounded in the pasted resume text when it is available:
// extractResumeFacts() pulls only facts actually present in the resume
// (name, projects, skills, education) and cites them. Never invents experience.

export function extractResumeFacts(resumeText = '') {
  const t = resumeText || ''
  const facts = { name: '', projects: [], skills: [], education: '' }
  const knownProjects = ['IncidentPilot', 'RegLens', 'QueryPilot', 'CodeSentry', 'ContentForge AI', 'ResearchMind', 'ResumeForge AI', 'PDF RAG Chatbot']
  for (const p of knownProjects) {
    if (t.toLowerCase().includes(p.toLowerCase())) facts.projects.push(p)
  }
  const knownSkills = ['LangChain', 'LangGraph', 'RAG', 'FastAPI', 'Python', 'SQL', 'FAISS', 'Groq', 'Gemini', 'PyTorch', 'Pandas', 'NumPy']
  for (const s of knownSkills) {
    if (t.toLowerCase().includes(s.toLowerCase())) facts.skills.push(s)
  }
  if (/iit guwahati/i.test(t)) facts.education = 'B.Sc. (Hons) Data Science & AI, IIT Guwahati'
  if (/7\.62/.test(t)) facts.education += facts.education ? ', CGPA 7.62/10' : 'CGPA 7.62/10'
  const nameMatch = t.trim().split('\n')[0]?.trim()
  if (nameMatch && nameMatch.length < 40 && /^[A-Za-z .'-]+$/.test(nameMatch)) facts.name = nameMatch
  return facts
}

export function resumeLine(facts) {
  const parts = []
  if (facts.name) parts.push(facts.name)
  if (facts.education) parts.push(facts.education)
  if (facts.projects.length) parts.push('Projects: ' + facts.projects.join(', '))
  if (facts.skills.length) parts.push('Skills: ' + facts.skills.slice(0, 6).join(', '))
  return parts.join(' — ')
}

export function isQuestion(text) {
  const s = (text || '').trim()
  if (!s) return false
  if (s.endsWith('?')) return true
  return /^(what|why|how|when|where|who|which|can you|could you|tell me|explain|describe|define|do you|have you|did you|would you|is |are |was |were |should|tell us|walk me|give me)/i.test(s)
}

// Each entry: keywords + short (speakable, ~30-45s) + bullets + long version
export const ANSWER_BANK = [
  {
    id: 'about-yourself',
    keys: ['tell me about yourself', 'introduce yourself', 'about yourself', 'walk me through your resume', 'tell us about yourself'],
    short: 'I am a final-year Data Science and AI student, and I build production GenAI systems — RAG, agents and evals — not just demos. I would love to bring that to this role.',
    bullets: ['Final-year B.Sc. Data Science & AI — focus on GenAI, RAG and agents', 'Built and deployed live systems: incident triage, compliance RAG, query routing', 'Measured work: evals, abstention and faithfulness scores, not just demos'],
    long: 'I am a final-year B.Sc. Data Science and AI student. Over the last year I have focused on generative AI: RAG pipelines, LangChain and LangGraph agents, and FastAPI backends. What sets my work apart is that I measure it — I run evals for retrieval, faithfulness and abstention, and I deploy the systems live. I am looking for a GenAI or AI Engineer role where I can build production AI systems and keep improving them with real user feedback.',
  },
  {
    id: 'rag',
    keys: ['rag', 'retrieval augmented', 'retrieval-augmented', 'what is rag'],
    short: 'RAG grounds an LLM in your own documents: retrieve the relevant chunks, then generate an answer only from that evidence, with citations and abstention when evidence is missing.',
    bullets: ['Chunk documents, embed them, store in a vector index', 'Retrieve top-k chunks for the query, re-rank if needed', 'Generate from retrieved evidence only, cite sources, abstain when unsure'],
    long: 'Retrieval-Augmented Generation has three steps. First, chunk your documents and embed them into a vector store such as FAISS. Second, at query time retrieve the top-k most relevant chunks — I measure this with recall@5 and MRR. Third, pass only those chunks to the LLM and instruct it to answer from the evidence, cite sources, and say "I don\'t know" when the evidence is missing. That last part — abstention — is what stops hallucinations. In my RegLens project I reached recall@5 of 0.897 and faithfulness of 0.974 on a 48-case golden set.',
  },
  {
    id: 'langchain-langgraph',
    keys: ['langchain', 'langgraph', 'agents', 'what is langgraph', 'agent'],
    short: 'LangChain is for chains and tools, LangGraph is for stateful multi-step agents with cycles, memory and human-in-the-loop. Use LangGraph when the flow needs branching and retries.',
    bullets: ['LangChain: LCEL chains, tools, structured output, memory', 'LangGraph: graph state, nodes, edges, cycles, checkpoints', 'Use LangGraph for research agents and multi-agent workflows'],
    long: 'LangChain gives you LCEL chains, tool calling, structured output and memory — good for a straightforward RAG pipeline. LangGraph builds on it with a state graph: nodes, edges, conditional branching, cycles and checkpoints. That is what you need for a real agent — for example a research agent that plans, searches, reflects, retries, and asks a human before acting. I use LangChain for chains and LangGraph when the workflow needs state, loops or human-in-the-loop.',
  },
  {
    id: 'two-sum',
    keys: ['two sum', 'two-sum'],
    short: 'Use a hash map: one pass, store each number and its index, check if target minus current exists. O(n) time, O(n) space.',
    bullets: ['One pass through the array', 'Map value -> index as you go', 'Check complement = target - nums[i] before inserting'],
    long: 'The optimal solution is a hash map in one pass. For each number, compute complement = target - nums[i]. If the complement is already in the map, return its index and the current index. Otherwise store the current number and its index. That is O(n) time and O(n) space. The brute force of checking every pair is O(n squared) and is what the interviewer expects you to improve on. Edge cases: duplicates, negative numbers, and no solution — clarify with the interviewer whether a solution is guaranteed.',
    code: 'def two_sum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        need = target - n\n        if need in seen:\n            return [seen[need], i]\n        seen[n] = i\n    return []',
  },
  {
    id: 'sliding-window',
    keys: ['sliding window', 'longest substring', 'maximum subarray', 'subarray'],
    short: 'Sliding window keeps two pointers and a window that grows and shrinks in one pass — O(n) time, ideal for contiguous subarray and substring problems.',
    bullets: ['Right pointer expands the window', 'Left pointer shrinks it when the condition breaks', 'Track the best answer as you go — O(n) time, O(1) or O(k) space'],
    long: 'Sliding window works when the answer is a contiguous subarray or substring and the window only moves forward. Keep a left and a right pointer. Move right to expand, and move left to shrink whenever the window violates the condition — for example a duplicate character, or a sum that is too large. Update the best answer at each step. That gives O(n) time instead of O(n squared) brute force. Classic examples: longest substring without repeating characters, and maximum sum subarray of size k.',
    code: 'def longest_unique(s):\n    seen, left, best = set(), 0, 0\n    for right, ch in enumerate(s):\n        while ch in seen:\n            seen.remove(s[left]); left += 1\n        seen.add(ch)\n        best = max(best, right - left + 1)\n    return best',
  },
  {
    id: 'system-design',
    keys: ['system design', 'design a', 'design an', 'architecture', 'scale', 'url shortener', 'chat system'],
    short: 'Start with requirements and capacity, then API, data model, and a high-level diagram: client, load balancer, services, cache, database, queue — then bottlenecks and trade-offs.',
    bullets: ['Clarify functional + non-functional requirements, estimate scale', 'API design, then data model and storage choice', 'Draw: client → LB → app servers → cache → DB → queue/workers', 'Call out bottlenecks, consistency, caching, and failure modes'],
    long: 'I would start by clarifying requirements: who uses it, read vs write ratio, and scale — for example 100 million URLs a day means about 1,200 writes per second. Then define the API, for example POST /shorten and GET /{code}. Then the data model: a short code, the long URL, expiry, and a counter. Then the diagram: client, load balancer, stateless app servers, a cache such as Redis for hot URLs, a relational database for the mapping, and a queue for analytics. Finally I discuss trade-offs: a counter with base-62 encoding vs a hash, cache invalidation, and how the system degrades if the database is slow. I always end with bottlenecks and what I would change at 10x scale.',
    diagram: 'Client → Load Balancer → App Servers → Redis Cache → Database\n                                        ↘ Queue → Analytics Workers',
  },
  {
    id: 'sql',
    keys: ['sql', 'join', 'index', 'query', 'database', 'normalization', 'what is a join'],
    short: 'SQL joins combine rows from two tables on a key. Use indexes on join and filter columns, and avoid SELECT star — fetch only the columns you need.',
    bullets: ['INNER JOIN: only matching rows; LEFT JOIN: all left rows + matches', 'Index the columns used in JOIN, WHERE and ORDER BY', 'GROUP BY + HAVING filters groups; WHERE filters rows first'],
    long: 'An INNER JOIN returns only rows that match in both tables, while a LEFT JOIN returns every row from the left table and nulls where there is no match. For performance, index the columns used in JOIN, WHERE and ORDER BY clauses, avoid SELECT *, and filter with WHERE before grouping. A common interview pattern is: find the second-highest salary with a subquery or a window function such as RANK() or DENSE_RANK() — and explain the difference: RANK leaves gaps after ties, DENSE_RANK does not.',
    code: 'SELECT name, salary FROM employees\nWHERE salary = (\n  SELECT MAX(salary) FROM employees\n  WHERE salary < (SELECT MAX(salary) FROM employees)\n);',
  },
  {
    id: 'python-fastapi',
    keys: ['fastapi', 'python', 'pydantic', 'what is fastapi'],
    short: 'FastAPI is a modern Python web framework: type hints give you validation with Pydantic, automatic docs, and async support — ideal for GenAI APIs.',
    bullets: ['Pydantic models validate request and response bodies', 'Async endpoints with async/await for LLM and DB calls', 'Automatic OpenAPI docs at /docs; dependency injection for auth and DB sessions'],
    long: 'FastAPI is my go-to for GenAI backends. You define request and response shapes as Pydantic models, so validation is automatic and wrong input returns a clear 422 error. Endpoints can be async, which matters when you call an LLM or a database. It generates OpenAPI docs automatically, and dependency injection keeps auth and database sessions clean. I have built FastAPI services for RAG chatbots, incident triage and query routing, deployed on Render and Vercel.',
  },
  {
    id: 'strengths',
    keys: ['strength', 'greatest strength', 'your strengths'],
    short: 'My strength is shipping measured AI systems — I do not just call an LLM, I evaluate retrieval, faithfulness and abstention, then deploy and iterate.',
    bullets: ['Ship end-to-end: RAG, agents, FastAPI, deployment', 'Measure everything: evals before claiming a result', 'Learn fast and document clearly'],
    long: 'My biggest strength is that I ship measured systems. Many people can call an LLM API; I build the whole pipeline — retrieval, prompting, evals and deployment — and I can tell you the numbers, like recall@5 or faithfulness, instead of just saying it works. I also learn fast: I picked up LangGraph and eval-driven development by building real projects, and I document my work so a team can pick it up.',
  },
  {
    id: 'weakness',
    keys: ['weakness', 'greatest weakness', 'your weakness'],
    short: 'I used to over-build before testing with users. Now I ship a small working version first, measure it, then improve — my eval work is part of that habit.',
    bullets: ['Honest, specific, not a disguised strength', 'Show what you changed: small releases + evals', 'End with what you are doing now'],
    long: 'Earlier I tended to over-build — adding features before testing whether the core worked. I changed that by shipping a small working version first, measuring it with evals, and then improving. For example, with my RAG projects I now run a golden test set before adding new features. It is still something I watch in myself, but the eval-first habit keeps it in check.',
  },
  {
    id: 'why-company',
    keys: ['why this company', 'why do you want', 'why should we hire', 'why hire you'],
    short: 'I want this role because it matches what I actually do — production GenAI — and I can contribute from day one with RAG, agents and evals, while learning from a strong team.',
    bullets: ['Match the role to real, deployed work — not just interest', 'Name the team or product area and what you would build there', 'Close with what you want to learn next'],
    long: 'I want this role because it is exactly the work I already do: building production GenAI systems with RAG, agents and evaluation. I can contribute from day one — I have shipped live systems and I can show you the eval numbers behind them. At the same time I want to learn from a strong team: how you handle scale, safety and reliability in production. That combination — contribute now, learn fast — is why I am excited about this team.',
  },
  {
    id: 'hr-where-see-yourself',
    keys: ['where do you see yourself', 'five years', 'future'],
    short: 'In five years I want to be a GenAI engineer who owns production AI systems end-to-end — retrieval, agents, evals and reliability — and mentors others.',
    bullets: ['Short term: ship and learn in this role', 'Mid term: own a system end-to-end', 'Long term: lead and mentor in GenAI'],
    long: 'In the short term I want to ship real GenAI features in this role and learn how a strong team runs AI in production. In a few years I want to own a system end-to-end — retrieval, agents, evals, safety and reliability. Longer term I want to mentor others and help set the standard for measured, trustworthy AI systems.',
  },
]

export function findAnswer(question, facts) {
  const q = (question || '').toLowerCase()
  let best = null
  let bestScore = 0
  for (const entry of ANSWER_BANK) {
    for (const key of entry.keys) {
      if (q.includes(key)) {
        const score = key.length
        if (score > bestScore) { bestScore = score; best = entry }
      }
    }
  }
  if (!best) return null
  const grounded = { ...best }
  const line = resumeLine(facts)
  if (line && (best.id === 'about-yourself' || best.id === 'strengths' || best.id === 'why-company')) {
    grounded.long = grounded.long + '\n\nFrom my resume: ' + line + '.'
  }
  return grounded
}

export function genericAnswer(question, facts) {
  const line = resumeLine(facts)
  return {
    id: 'generic',
    short: 'Good question — let me answer it from my experience. ' + (line ? 'Based on my background: ' + line + '. ' : '') + 'I would structure it as: what I did, how I did it, and what the result was.',
    bullets: ['Start with a one-line direct answer', 'Give one concrete example from a real project', 'End with the result or number, and what you learned'],
    long: 'That is a good question. I would answer it in three parts. First, a direct one-line answer. Second, a concrete example from a project I actually built — ' + (facts.projects.length ? facts.projects.join(', ') : 'my RAG and agent projects') + ' — explaining what I did and why. Third, the measurable result and what I learned. If I do not know something, I say so honestly and explain how I would find out, rather than guessing.',
  }
}

export const MOCK_QUESTIONS = {
  'GenAI / RAG': [
    'What is RAG and why do we need it instead of fine-tuning?',
    'How do you measure whether a RAG system is working well?',
    'What causes hallucinations and how do you reduce them?',
    'Explain chunking and embedding choices in a RAG pipeline.',
    'How would you handle a question your documents cannot answer?',
  ],
  DSA: [
    'Explain Two Sum and its optimal solution.',
    'How does a sliding window work? Give an example.',
    'What is the time complexity of binary search and why?',
    'Explain the difference between a stack and a queue.',
    'How would you detect a cycle in a linked list?',
  ],
  HR: [
    'Tell me about yourself.',
    'What is your greatest strength?',
    'What is your greatest weakness?',
    'Why should we hire you?',
    'Where do you see yourself in five years?',
  ],
  'System Design': [
    'Design a URL shortener.',
    'How would you design a chat system like WhatsApp?',
    'How do you handle 10x traffic growth?',
    'SQL vs NoSQL — how do you choose?',
    'How would you design a rate limiter?',
  ],
  'Python + FastAPI': [
    'What is FastAPI and why use it over Flask?',
    'How does Pydantic validation work?',
    'Explain async and await in Python.',
    'How do you structure a FastAPI project?',
    'How would you add authentication to an API?',
  ],
  SQL: [
    'Explain INNER JOIN vs LEFT JOIN.',
    'How do you find the second-highest salary in SQL?',
    'What is an index and when does it hurt?',
    'What is the difference between WHERE and HAVING?',
    'Explain RANK() vs DENSE_RANK().',
  ],
}

export const QUESTION_BANK = {
  Google: ['Tell me about a hard technical problem you solved.', 'Design a URL shortener.', 'Why Google?', 'Explain a project where you improved performance.'],
  Amazon: ['Tell me about a time you disagreed with a teammate.', 'How do you handle a tight deadline?', 'Design a recommendation system.', 'What is your biggest failure?'],
  Microsoft: ['Explain RAG to a non-technical person.', 'How do you debug a slow API?', 'Tell me about a team project.', 'What is your favourite data structure and why?'],
  Flipkart: ['Design a search system for an e-commerce site.', 'How would you scale a checkout service?', 'Tell me about yourself.', 'SQL: find top-selling products by category.'],
  'TCS / Infosys': ['What is OOP? Explain with an example.', 'Difference between SQL and NoSQL.', 'Tell me about your final-year project.', 'What are your strengths and weaknesses?'],
  'GenAI Roles': ['What is RAG?', 'LangChain vs LangGraph — when do you use each?', 'How do you evaluate an LLM system?', 'How do you prevent hallucinations in production?'],
}
