// api/stats.js
import { supabase } from '../src/supabase-admin.js';
import { GameEngine } from '../src/game-engine.js';

const engine = new GameEngine();

export default async function handler(req, res) {
  try {
    // Sadece aktif odaları say (biten veya boş odaları dışla)
    const { count: roomsCount } = await supabase
      .from('rooms')
      .select('*', { count: 'exact', head: true })
      .in('state', ['lobby', 'playing', 'results']);

    // Gerçekten bağlı oyuncuları say
    const { count: playersCount } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true })
      .eq('connected', true);

    return res.status(200).json({
      rooms: roomsCount || 0,
      players: playersCount || 0,
      dilemmas: engine.getDilemmasCount ? engine.getDilemmasCount() : 42,
    });
  } catch (error) {
    return res.status(200).json({ rooms: 0, players: 0, dilemmas: 42 });
  }
}
