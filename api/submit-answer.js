// api/submit-answer.js
import { GameEngine } from '../src/game-engine.js';
import { broadcast } from '../src/supabase-admin.js';

const engine = new GameEngine();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { roomCode, playerId, answer } = req.body || {};

  const result = await engine.submitAnswer(roomCode, playerId, answer);
  if (!result) return res.status(400).json({ error: 'Geçersiz cevap veya oda oyunda değil.' });

  // Herkes anında görsün
  await broadcast(roomCode, 'player_answered', {
    playerId: result.playerId,
    name: result.name,
    color: result.color,
    answer: result.answer,
    totalAnswered: result.totalAnswered,
    totalPlayers: result.totalPlayers,
  });

  // Herkes cevapladıysa sonuçları göster
  if (result.allAnswered) {
    const qResults = await engine.getQuestionResults(roomCode);
    if (qResults) {
      await broadcast(roomCode, 'question_results', qResults);
    }
  }

  return res.status(200).json({ success: true, ...result });
}
