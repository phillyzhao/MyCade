// Gemini commentator: one cheeky line about a finished match, generated from the real stats.
import { GoogleGenAI } from '@google/genai';

let ai = null;
function client() {
  if (ai) return ai;
  if (process.env.GEMINI_API_KEY) ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  else if (process.env.GOOGLE_CLOUD_PROJECT)
    ai = new GoogleGenAI({ vertexai: true, project: process.env.GOOGLE_CLOUD_PROJECT, location: process.env.GOOGLE_CLOUD_LOCATION || 'global' });
  return ai;
}

const GAME_NAMES = { bowling: 'bowling', balance: 'a balance-on-a-floating-island game', racing: 'kart racing', tennis: 'doubles tennis' };

export async function commentate({ game, standings = [], highlights = [] }) {
  const c = client();
  if (!c) return null;
  const table = standings.map((s) => `#${s.rank} ${s.name}${s.cpu ? ' (CPU)' : ''}: ${s.label ?? s.score}`).join('\n');
  const prompt = `You are the hype commentator of a party game night. Write ONE short, funny, friendly roast-style line (max 22 words) about this ${GAME_NAMES[game] || game} result, using the actual names and numbers. Players swung their real phones to play. No hashtags, no emojis, no quotes.\n\nResults:\n${table}\nHighlights: ${highlights.join('; ') || 'none'}`;
  const res = await Promise.race([
    c.models.generateContent({ model: process.env.GEMINI_TEXT_MODEL || 'gemini-3-flash-preview', contents: prompt, config: { temperature: 1.0, maxOutputTokens: 80, thinkingConfig: { thinkingBudget: 0 } } }),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000)),
  ]);
  const text = (res.text || '').trim().replace(/^["']|["']$/g, '');
  return text || null;
}
