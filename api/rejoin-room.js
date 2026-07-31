// api/rejoin-room.js
import { RoomManager } from '../src/rooms.js';
import { GameEngine } from '../src/game-engine.js';
import { broadcast } from '../src/supabase-admin.js';

const rooms = new RoomManager();
const engine = new GameEngine();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { code = '', playerId, name } = req.body || {};
  const cleanCode = code.trim().toUpperCase();

  const result = await rooms.rejoinRoom(cleanCode, playerId, name);
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

  let gameEndResults = null;
  if (result.gameState === 'end') {
    const room = await rooms.getRoom(cleanCode);
    gameEndResults = await engine.getGameEndResults(cleanCode, room?.questions || []);
  }

  return res.status(200).json({
    type: 'room_joined',
    ...result,
    currentQuestion,
    gameEndResults
  });
}
