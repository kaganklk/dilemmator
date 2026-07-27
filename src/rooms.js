// src/rooms.js — Supabase destekli Oda ve Oyuncu yönetimi
import { supabase, getSupabaseError, formatSupabaseError } from './supabase-admin.js';

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // I,O,0,1 hariç
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function generatePlayerId() {
  return Math.floor(10000000 + Math.random() * 90000000); // 8 haneli rastgele benzersiz ID
}

export class RoomManager {
  getPlayerColor(index) {
    const colors = [
      '#FF2D55', '#FF9F0A', '#30D158', '#5E5CE6',
      '#64D2FF', '#BF5AF2', '#FF6482', '#FFD60A',
      '#AC8E68', '#FF453A', '#32ADE6', '#63E6BE',
    ];
    return colors[index % colors.length];
  }

  async getRoom(code) {
    if (!code) return null;
    const { data, error } = await supabase
      .from('rooms')
      .select('*')
      .eq('code', code)
      .maybeSingle();

    if (error || !data) return null;

    return {
      code: data.code,
      hostId: Number(data.host_player_id),
      state: data.state,
      settings: data.settings || { questionCount: 10 },
      questions: data.questions || [],
      currentQuestionIndex: data.current_question_index,
      playAgainVotes: data.play_again_votes || [],
    };
  }

  async getPlayers(roomCode) {
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .eq('room_code', roomCode)
      .order('created_at', { ascending: true });

    if (error || !data) return [];

    return data.map(p => ({
      id: Number(p.id),
      name: p.name,
      color: p.color,
      connected: p.connected,
      roomCode: p.room_code,
    }));
  }

  getPlayersInfo(players, hostId) {
    return players.map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      isHost: p.id === hostId,
      connected: p.connected,
    }));
  }

  async createRoom(hostName) {
    const configErr = getSupabaseError();
    if (configErr) return { error: configErr };

    let code;
    let attempts = 0;
    while (attempts < 10) {
      code = generateCode();
      const existing = await this.getRoom(code);
      if (!existing) break;
      attempts++;
    }

    const hostId = generatePlayerId();
    const color = this.getPlayerColor(0);
    const hostNameStr = (hostName && hostName.trim()) ? hostName.trim() : 'Anonim';

    // Oda kaydı ekle
    const { error: roomErr } = await supabase.from('rooms').insert({
      code,
      host_player_id: hostId.toString(),
      state: 'lobby',
      settings: { questionCount: 10 },
      questions: [],
      current_question_index: -1,
      play_again_votes: [],
    });

    if (roomErr) {
      console.error('Oda oluşturma hatası:', roomErr);
      return { error: `Supabase Hata (rooms): ${formatSupabaseError(roomErr)}` };
    }

    // Oyuncuyu ekle
    const { error: playerErr } = await supabase.from('players').insert({
      id: hostId.toString(),
      room_code: code,
      name: hostNameStr,
      color,
      connected: true,
    });

    if (playerErr) {
      console.error('Host oyuncu ekleme hatası:', playerErr);
      return { error: `Supabase Hata (players): ${formatSupabaseError(playerErr)}` };
    }

    const playersInfo = [
      { id: hostId, name: hostNameStr, color, isHost: true, connected: true }
    ];

    return {
      roomCode: code,
      playerId: hostId,
      players: playersInfo,
      settings: { questionCount: 10 },
    };
  }

  async joinRoom(code, playerName) {
    const configErr = getSupabaseError();
    if (configErr) return { error: configErr };

    const room = await this.getRoom(code);
    if (!room) return { error: 'Oda bulunamadı veya kapandı.' };

    const existingPlayers = await this.getPlayers(code);
    if (existingPlayers.length >= 15) return { error: 'Oda dolu (maks 15 kişi).' };

    const playerId = generatePlayerId();
    const color = this.getPlayerColor(existingPlayers.length);
    const nameStr = (playerName && playerName.trim()) ? playerName.trim() : 'Anonim';

    const { error } = await supabase.from('players').insert({
      id: playerId.toString(),
      room_code: code,
      name: nameStr,
      color,
      connected: true,
    });

    if (error) {
      console.error('Odayaılma hatası:', error);
      return { error: `Odaya girilemedi: ${formatSupabaseError(error)}` };
    }

    const updatedPlayers = [...existingPlayers, { id: playerId, name: nameStr, color, connected: true }];
    const playersInfo = this.getPlayersInfo(updatedPlayers, room.hostId);

    return {
      roomCode: code,
      playerId,
      players: playersInfo,
      settings: room.settings,
      gameState: room.state,
      isHost: playerId === room.hostId,
    };
  }

  async rejoinRoom(code, playerName) {
    const configErr = getSupabaseError();
    if (configErr) return { error: configErr };

    const room = await this.getRoom(code);
    if (!room) return { error: 'Oda bulunamadı.' };

    const players = await this.getPlayers(code);
    const nameStr = (playerName && playerName.trim()) ? playerName.trim() : 'Anonim';

    const existing = players.find(p => p.name === nameStr);
    if (existing) {
      if (!existing.connected) {
        await supabase.from('players').update({ connected: true }).eq('id', existing.id.toString());
        existing.connected = true;
      }
      return {
        roomCode: code,
        playerId: existing.id,
        players: this.getPlayersInfo(players, room.hostId),
        settings: room.settings,
        gameState: room.state,
        isHost: existing.id === room.hostId,
        rejoined: true,
      };
    }

    return this.joinRoom(code, playerName);
  }

  async updateSettings(roomCode, playerId, newQuestionCount) {
    const room = await this.getRoom(roomCode);
    if (!room || Number(playerId) !== room.hostId) return null;

    const count = Math.max(3, Math.min(20, parseInt(newQuestionCount) || 10));
    const newSettings = { ...room.settings, questionCount: count };

    await supabase
      .from('rooms')
      .update({ settings: newSettings })
      .eq('code', roomCode);

    return newSettings;
  }
}
