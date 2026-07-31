// api/stats.js
import { supabase } from '../src/supabase-admin.js';
import { GameEngine } from '../src/game-engine.js';

const engine = new GameEngine();

export default async function handler(req, res) {
  try {
    // Şu an connected=true olan oyuncuların listesi
    const { data: connectedPlayers } = await supabase
      .from('players')
      .select('room_code')
      .eq('connected', true);

    const playersCount = connectedPlayers?.length || 0;

    // Aktif oda = içinde en az 1 bağlı oyuncu olan oda (terk edilmiş odalar sayılmaz)
    const activeRoomCodes = new Set(connectedPlayers?.map(p => p.room_code) || []);
    const roomsCount = activeRoomCodes.size;

    return res.status(200).json({
      rooms: roomsCount,
      players: playersCount,
      dilemmas: engine.getDilemmasCount(),
    });
  } catch (error) {
    return res.status(200).json({ rooms: 0, players: 0, dilemmas: 42 });
  }
}
