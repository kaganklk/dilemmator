// api/stats.js
import { supabase } from '../src/supabase-admin.js';

export default async function handler(req, res) {
  try {
    const { count: roomsCount } = await supabase.from('rooms').select('*', { count: 'exact', head: true });
    const { count: playersCount } = await supabase.from('players').select('*', { count: 'exact', head: true }).eq('connected', true);

    return res.status(200).json({
      rooms: roomsCount || 0,
      players: playersCount || 0,
    });
  } catch (error) {
    return res.status(200).json({ rooms: 0, players: 0 });
  }
}
