// api/start-game.js
import { RoomManager } from '../src/rooms.js';
import { GameEngine } from '../src/game-engine.js';
import { broadcast } from '../src/supabase-admin.js';

const rooms = new RoomManager();
const engine = new GameEngine();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { roomCode, playerId } = req.body || {};

  const room = await rooms.getRoom(roomCode);
  const players = await rooms.getPlayers(roomCode);
  const activePlayers = (players || []).filter(p => p.connected !== false);
  const isHost = room && (Number(playerId) === Number(room.hostId) || (activePlayers.length <= 1 && activePlayers.some(p => Number(p.id) === Number(playerId))));

  if (!isHost) {
    return res.status(403).json({ error: 'Sadece oda sahibi oyunu başlatabilir.' });
  }

  const question = await engine.startGame(roomCode, room.settings.questionCount);
  await broadcast(roomCode, 'game_started', { question });
  return res.status(200).json({ success: true, question });
}
