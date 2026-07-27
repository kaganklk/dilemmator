// api/create-room.js
import { RoomManager } from '../src/rooms.js';

const rooms = new RoomManager();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { name } = req.body || {};
  const result = await rooms.createRoom(name);
  if (result.error) {
    return res.status(400).json({ type: 'error', message: result.error });
  }
  return res.status(200).json({
    type: 'room_created',
    ...result
  });
}
