// api/next-question.js
import { RoomManager } from '../src/rooms.js';
import { GameEngine } from '../src/game-engine.js';
import { broadcast } from '../src/supabase-admin.js';

const rooms = new RoomManager();
const engine = new GameEngine();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { roomCode, playerId } = req.body || {};

  const room = await rooms.getRoom(roomCode);
  if (!room || Number(playerId) !== room.hostId) {
    return res.status(403).json({ error: 'Yetkisiz işlem.' });
  }

  const nextRes = await engine.nextQuestion(roomCode);
  if (nextRes.gameOver) {
    await broadcast(roomCode, 'game_ended', nextRes.results);
  } else {
    await broadcast(roomCode, 'new_question', nextRes.question);
  }

  return res.status(200).json({ success: true, ...nextRes });
}
