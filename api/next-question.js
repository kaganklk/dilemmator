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
  const players = await rooms.getPlayers(roomCode);
  const activePlayers = (players || []).filter(p => p.connected !== false);
  const isHost = room && (Number(playerId) === Number(room.hostId) || (activePlayers.length <= 1 && activePlayers.some(p => Number(p.id) === Number(playerId))));

  if (!isHost) {
    return res.status(403).json({ error: 'Yetkisiz işlem.' });
  }

  const nextRes = await engine.nextQuestion(roomCode);
  if (nextRes.error) {
    // Yarış koşulu (race condition) gibi durumlarda, error dönüyoruz.
    return res.status(200).json({ success: false, error: nextRes.error });
  }

  // DB'ye yazma tamamlandı → hemen yanıt dön (host anında yeni soruyu görür)
  // Broadcast arka planda gönderilir (diğer oyuncular Realtime ile yakalar)
  res.status(200).json({ success: true, ...nextRes });

  // Yanıt gönderildikten SONRA broadcast et (await bloklarken response gecikmesin)
  if (nextRes.gameOver) {
    broadcast(roomCode, 'game_ended', nextRes.results).catch(console.error);
  } else {
    broadcast(roomCode, 'new_question', nextRes.question).catch(console.error);
  }

}
