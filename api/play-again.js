// api/play-again.js
import { RoomManager } from '../src/rooms.js';
import { GameEngine } from '../src/game-engine.js';
import { broadcast } from '../src/supabase-admin.js';

const rooms = new RoomManager();
const engine = new GameEngine();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { roomCode, playerId } = req.body || {};

  const result = await engine.playAgain(roomCode, playerId);
  if (!result) return res.status(400).json({ error: 'Oda bulunamadı veya veriler okunamadı.' });

  if (result.reset) {
    await broadcast(roomCode, 'new_question', result.firstQ);
  } else {
    await broadcast(roomCode, 'play_again_update', {
      votes: result.votes,
      total: result.total
    });
  }

  return res.status(200).json({ success: true, ...result });
}
