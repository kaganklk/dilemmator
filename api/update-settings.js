// api/update-settings.js
import { RoomManager } from '../src/rooms.js';
import { broadcast } from '../src/supabase-admin.js';

const rooms = new RoomManager();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { roomCode, playerId, questionCount } = req.body || {};

  const newSettings = await rooms.updateSettings(roomCode, playerId, questionCount);
  if (!newSettings) return res.status(403).json({ error: 'Yetkisiz işlem.' });

  await broadcast(roomCode, 'settings_updated', { settings: newSettings });

  return res.status(200).json({ success: true, settings: newSettings });
}
