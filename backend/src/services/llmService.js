/**
 * LLM service used for:
 *   1. Pre-visit symptom summary (urgency level, chief complaint, 3 suggested questions)
 *   2. Post-visit patient-friendly summary (plain-language notes + medication schedule)
 *
 * Design goals (per assignment "LLM failures must be handled gracefully"):
 *   - Bounded timeout per call (LLM_TIMEOUT_MS)
 *   - Retry with backoff up to LLM_MAX_RETRIES
 *   - Strict JSON-only prompting + defensive parsing (strips markdown fences, validates shape)
 *   - On exhausted retries or malformed output: never throw up to the caller / never
 *     block the booking or visit-completion flow. Instead return a `fallback` result
 *     with llm_status='failed' (or 'fallback') so the appointment can still proceed
 *     and staff can see that manual review is needed.
 */

const LLM_PROVIDER = process.env.LLM_PROVIDER || 'anthropic';
const TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || '15000', 10);
const MAX_RETRIES = parseInt(process.env.LLM_MAX_RETRIES || '2', 10);

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`LLM request timed out after ${ms}ms`)), ms)),
  ]);
}

function stripCodeFences(text) {
  return text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
}

async function callAnthropic(systemPrompt, userPrompt) {
  const fetch = global.fetch || (await import('node-fetch')).default;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      max_tokens: 700,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${body}`);
  }
  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Anthropic response contained no text block');
  return textBlock.text;
}

async function callOpenAI(systemPrompt, userPrompt) {
  const fetch = global.fetch || (await import('node-fetch')).default;
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error('OpenAI response contained no message content');
  return text;
}

async function callLLM(systemPrompt, userPrompt) {
  const call = LLM_PROVIDER === 'openai' ? callOpenAI : callAnthropic;

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = await withTimeout(call(systemPrompt, userPrompt), TIMEOUT_MS);
      return raw;
    } catch (err) {
      lastErr = err;
      console.warn(`[llmService] attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt))); // exponential backoff
      }
    }
  }
  throw lastErr;
}

const PRE_VISIT_SYSTEM = `You are a clinical triage assistant helping a doctor prepare for a patient visit.
Respond with STRICT JSON ONLY, no markdown, no commentary, matching exactly this shape:
{"urgency_level": "Low" | "Medium" | "High", "chief_complaint": "short phrase", "suggested_questions": ["q1", "q2", "q3"]}`;

async function generatePreVisitSummary({ symptoms, durationDays }) {
  const userPrompt = `Analyse these symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor. Symptoms: ${symptoms}${
    durationDays ? ` (duration: ${durationDays} days)` : ''
  }`;

  try {
    const raw = await callLLM(PRE_VISIT_SYSTEM, userPrompt);
    const parsed = JSON.parse(stripCodeFences(raw));
    if (!parsed.urgency_level || !parsed.chief_complaint || !Array.isArray(parsed.suggested_questions)) {
      throw new Error('LLM returned malformed JSON shape');
    }
    return {
      status: 'success',
      urgency_level: parsed.urgency_level,
      chief_complaint: parsed.chief_complaint,
      suggested_questions: parsed.suggested_questions.slice(0, 3),
      raw,
    };
  } catch (err) {
    console.error('[llmService] pre-visit summary failed, using fallback:', err.message);
    return {
      status: 'failed',
      // Safe fallback so a doctor is never left with a blank screen; urgency defaults
      // to Medium (never silently downgrade risk) and the doctor is flagged to read
      // the raw symptom text directly.
      urgency_level: 'Medium',
      chief_complaint: symptoms.slice(0, 120),
      suggested_questions: [
        'Could you describe when the symptoms started and how they have changed?',
        'Have you taken any medication or home remedies for this so far?',
        'Do you have any relevant medical history or allergies I should know about?',
      ],
      error: err.message,
      raw: null,
    };
  }
}

const POST_VISIT_SYSTEM = `You are a medical communication assistant that turns clinical notes into
a clear, friendly summary for a patient with no medical background.
Respond with STRICT JSON ONLY, no markdown, no commentary, matching exactly this shape:
{"patient_summary": "2-4 sentence plain language summary", "medication_schedule_text": "human readable schedule", "follow_up_steps": ["step1", "step2"]}`;

async function generatePostVisitSummary({ notes, prescription, followUpDate }) {
  const prescriptionText = Array.isArray(prescription) && prescription.length
    ? prescription
        .map((p) => `${p.drug} ${p.dosage || ''}, ${p.frequency_per_day || '?'}x/day for ${p.duration_days || '?'} days`)
        .join('; ')
    : 'No medication prescribed';

  const userPrompt = `Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps: ${notes}
Prescription: ${prescriptionText}
Follow-up date: ${followUpDate || 'not scheduled'}`;

  try {
    const raw = await callLLM(POST_VISIT_SYSTEM, userPrompt);
    const parsed = JSON.parse(stripCodeFences(raw));
    if (!parsed.patient_summary || !parsed.medication_schedule_text) {
      throw new Error('LLM returned malformed JSON shape');
    }
    return {
      status: 'success',
      patient_summary: parsed.patient_summary,
      medication_schedule_text: parsed.medication_schedule_text,
      follow_up_steps: parsed.follow_up_steps || [],
      raw,
    };
  } catch (err) {
    console.error('[llmService] post-visit summary failed, using fallback:', err.message);
    return {
      status: 'failed',
      patient_summary:
        'Your doctor has recorded notes from your visit. Please see the medication schedule below and contact the clinic if you have questions - our system was unable to generate a plain-language summary automatically.',
      medication_schedule_text: prescriptionText,
      follow_up_steps: followUpDate ? [`Follow-up visit on ${followUpDate}`] : [],
      error: err.message,
      raw: null,
    };
  }
}

module.exports = { generatePreVisitSummary, generatePostVisitSummary };
