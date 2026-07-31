// api/leave-room.js — Oyuncu Sayfadan Çıktığında Anında Çevrimdışı Bildirimi ve Durum Kontrolü
import { RoomManager } from '../src/rooms.js';
import { broadcast } from '../src/supabase-admin.js';

const rooms = new RoomManager();

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { roomCode, playerId } = req.body || {};

  if (!roomCode || !playerId) {
    return res.status(400).json({ error: 'Eksik parametre' });
  }

  const result = await rooms.leaveRoom(roomCode.toString().trim().toUpperCase(), playerId);
  if (result && result.error) {
    return res.status(400).json({ error: result.error });
  }

  // Tüm oyuncular ayrıldı — oda zaten silindi, başka bir şey yapmaya gerek yok
  if (result && result.allLeft) {
    return res.status(200).json({ success: true, allLeft: true });
  }

  // Diğer oyunculara anında çıkışı bildir
  if (result && result.players) {
    await broadcast(roomCode, 'player_left', {
      players: result.players,
      leftPlayerId: Number(playerId)
    });
  }

  // Eğer odada kalan çevrimiçi oyuncuların tamamı oy vermişse anında lobiye at
  if (result && result.shouldResetToLobby && result.lobbyData) {
    await broadcast(roomCode, 'back_to_lobby', result.lobbyData);
  } else if (result && result.room && result.room.state === 'end') {
    await broadcast(roomCode, 'play_again_update', {
      votes: result.validVotesCount || 0,
      total: result.activePlayersCount || 1
    });
  }

  return res.status(200).json({ success: true, ...result });

}
