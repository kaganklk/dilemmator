// api/next-question.js
import { RoomManager } from '../src/rooms.js';
import { GameEngine } from '../src/game-engine.js';
import { broadcast } from '../src/supabase-admin.js';

const rooms = new RoomManager();
const engine = new GameEngine();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { roomCode, playerId } = req.body || {};

  // Paralel: getRoom ve getPlayers aynı anda başlat (200-600ms kazanım)
  const [room, players] = await Promise.all([
    rooms.getRoom(roomCode),
    rooms.getPlayers(roomCode)
  ]);
  const activePlayers = (players || []).filter(p => p.connected !== false);
  const isHost = room && (Number(playerId) === Number(room.hostId) || (activePlayers.length <= 1 && activePlayers.some(p => Number(p.id) === Number(playerId))));

  if (!isHost) {
    return res.status(403).json({ error: 'Yetkisiz işlem.' });
  }

  // rooms.getRoom'dan gelen veriyi engine'e ilet (engine içinde tekrar SELECT yapmasın)
  const preloadedRoom = room ? {
    questions: room.questions,
    current_question_index: room.currentQuestionIndex,
    settings: room.settings
  } : null;

  const nextRes = await engine.nextQuestion(roomCode, preloadedRoom);
  if (nextRes.error) {
    return res.status(200).json({ success: false, error: nextRes.error });
  }

  // Broadcast'i BEKLE, sonra yanıt dön (serverless'da yanıt sonrası fonksiyon ölür)
  if (nextRes.gameOver) {
    await broadcast(roomCode, 'game_ended', nextRes.results);
  } else {
    await broadcast(roomCode, 'new_question', nextRes.question);
  }

  return res.status(200).json({ success: true, ...nextRes });
}
