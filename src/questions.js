// Question lists + question detection. These are PROMPTS shown to the user —
// not answers. All AI answers now come from the SaaS backend (/api/ai/chat).

export function isQuestion(text) {
  const s = (text || '').trim()
  if (!s) return false
  if (s.endsWith('?')) return true
  return /^(what|why|how|when|where|who|which|can you|could you|tell me|explain|describe|define|do you|have you|did you|would you|is |are |was |were |should|tell us|walk me|give me)/i.test(s)
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
