// api/rate-question.js
import { supabase } from '../src/supabase-admin.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { questionId, playerId, roomCode, type } = req.body || {};
  if (!questionId || !playerId || !roomCode) {
    return res.status(400).json({ error: 'Eksik parametre' });
  }

  if (type === null || type === undefined) {
    // Oyu geri cek (sil)
    const { error } = await supabase
      .from('question_ratings')
      .delete()
      .eq('question_id', String(questionId))
      .eq('player_id', String(playerId))
      .eq('room_id', String(roomCode));
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, action: 'removed' });
  }

  // Oy ver (upsert)
  const { error } = await supabase
    .from('question_ratings')
    .upsert({
      question_id: String(questionId),
      player_id: String(playerId),
      room_id: String(roomCode),
      type
    }, { onConflict: 'question_id,player_id,room_id' });

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ success: true, action: 'rated', type });
}
