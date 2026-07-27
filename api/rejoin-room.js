// api/rejoin-room.js
import { RoomManager } from '../src/rooms.js';
import { GameEngine } from '../src/game-engine.js';
import { broadcast } from '../src/supabase-admin.js';

const rooms = new RoomManager();
const engine = new GameEngine();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { code = '', name } = req.body || {};
  const cleanCode = code.trim().toUpperCase();

  const result = await rooms.rejoinRoom(cleanCode, name);
  if (result.error) {
    return res.status(400).json({ type: 'error', message: result.error });
  }

  await broadcast(cleanCode, 'player_joined', {
    players: result.players
  });

  let currentQuestion = null;
  if (result.gameState === 'playing' || result.gameState === 'results') {
    currentQuestion = await engine.getCurrentQuestion(cleanCode);
  }

  return res.status(200).json({
    type: 'room_joined',
    ...result,
    currentQuestion
  });
}
