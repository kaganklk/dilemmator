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
      isHost: Number(p.id) === Number(hostId),
      connected: p.connected,
    }));
  }

  async createRoom(hostName) {
    const configErr = getSupabaseError();
    if (configErr) return { error: configErr };

    const code = generateCode();
    const hostId = generatePlayerId();
    const color = this.getPlayerColor(0);
    const hostNameStr = (hostName && hostName.trim()) ? hostName.trim() : 'Anonim';

    // Oda kaydını ÖNCE ekle (Veritabanı foreign key zorunluluğu nedeniyle önce odanın kaydolması şart!)
    const { error: roomErr } = await supabase.from('rooms').insert({
      code,
      host_player_id: hostId.toString(),
      state: 'lobby',
      settings: { questionCount: 10, usedQuestions: [] },
      questions: [],
      current_question_index: -1,
      play_again_votes: [],
    });

    if (roomErr) {
      console.error('Oda oluşturma hatası:', roomErr);
      return { error: `Supabase Hata (rooms): ${formatSupabaseError(roomErr)}` };
    }

    // Oda veritabanına girdiği milianda hemen kurucu (host) oyuncusunu ekle
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

  async joinRoom(code, playerName, existingRoom = null, existingPlayers = null) {
    const configErr = getSupabaseError();
    if (configErr) return { error: configErr };

    // Eğer rejoinRoom üzerinden geldiysek tekrar veritabanını sorgulama! Yoksa paralel sorgula
    let room = existingRoom;
    let currentPlayers = existingPlayers;

    if (!room || !currentPlayers) {
      const [roomData, playersData] = await Promise.all([
        this.getRoom(code),
        this.getPlayers(code)
      ]);
      room = roomData;
      currentPlayers = playersData || [];
    }

    if (!room) return { error: 'Oda bulunamadı veya kapandı.' };
    if (currentPlayers.length >= 15) return { error: 'Oda dolu (maks 15 kişi).' };

    const nameStr = (playerName && playerName.trim()) ? playerName.trim() : 'Anonim';
    const existing = currentPlayers.find(p => p.name.toLowerCase().trim() === nameStr.toLowerCase().trim());
    if (existing) {
      if (!existing.connected) {
        await supabase.from('players').update({ connected: true }).eq('id', existing.id.toString());
        existing.connected = true;
      }
      return {
        roomCode: code,
        playerId: existing.id,
        players: this.getPlayersInfo(currentPlayers, room.hostId),
        settings: room.settings,
        gameState: room.state,
        isHost: Number(existing.id) === Number(room.hostId),
        rejoined: true,
      };
    }

    const playerId = generatePlayerId();
    const color = this.getPlayerColor(currentPlayers.length);

    const { error } = await supabase.from('players').insert({
      id: playerId.toString(),
      room_code: code,
      name: nameStr,
      color,
      connected: true,
    });

    if (error) {
      console.error('Odaya katılma hatası:', error);
      return { error: `Odaya girilemedi: ${formatSupabaseError(error)}` };
    }

    const updatedPlayers = [...currentPlayers, { id: playerId, name: nameStr, color, connected: true }];
    const playersInfo = this.getPlayersInfo(updatedPlayers, room.hostId);

    return {
      roomCode: code,
      playerId,
      players: playersInfo,
      settings: room.settings,
      gameState: room.state,
      isHost: Number(playerId) === Number(room.hostId),
    };
  }

  async rejoinRoom(code, playerId, playerName) {
    const configErr = getSupabaseError();
    if (configErr) return { error: configErr };

    // Oda ve oyuncuları tek bir seferde paralel olarak çek
    const [room, players] = await Promise.all([
      this.getRoom(code),
      this.getPlayers(code)
    ]);

    if (!room) return { error: 'Oda bulunamadı.' };

    let existing = null;
    if (playerId && !isNaN(Number(playerId))) {
      existing = (players || []).find(p => Number(p.id) === Number(playerId));
    }
    if (!existing) {
      const nameStr = (playerName && playerName.trim()) ? playerName.trim() : 'Anonim';
      existing = (players || []).find(p => p.name.toLowerCase().trim() === nameStr.toLowerCase().trim());
    }

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
        isHost: Number(existing.id) === Number(room.hostId),
        rejoined: true,
      };
    }

    // İlk kez giriliyorsa önbelleğe alınan room ve players parametrelerini ilet (Gecikme %60 atıldı!)
    return this.joinRoom(code, playerName, room, players);
  }

  async updateSettings(roomCode, playerId, newQuestionCount) {
    const room = await this.getRoom(roomCode);
    if (!room || Number(playerId) !== room.hostId) return null;

    const count = Math.max(1, Math.min(10, parseInt(newQuestionCount) || 10));
    const newSettings = { ...room.settings, questionCount: count };

    await supabase
      .from('rooms')
      .update({ settings: newSettings })
      .eq('code', roomCode);

    return newSettings;
  }

  async leaveRoom(code, playerId) {
    const configErr = getSupabaseError();
    if (configErr) return { error: configErr };
    if (!code || !playerId) return { error: 'Geçersiz parametre' };

    await supabase.from('players').update({ connected: false }).eq('id', playerId.toString()).eq('room_code', code);

    const [room, players] = await Promise.all([
      this.getRoom(code),
      this.getPlayers(code)
    ]);

    if (!room) return { error: 'Oda bulunamadı' };

    // Tüm oyuncular disconnect olduysa ve oyun bitmişse (veya lobideyse) odayı sil
    // NOT: Oyun oynanırken (playing/results) silme — sayfa yenileme gibi geçici kopukluklar oda silmemeli
    const activePlayers = (players || []).filter(p => p.connected !== false);
    if (activePlayers.length === 0 && (room.state === 'end' || room.state === 'lobby')) {
      await this.deleteRoom(code);
      return {
        room,
        players: [],
        activePlayersCount: 0,
        validVotesCount: 0,
        shouldResetToLobby: false,
        lobbyData: null,
        allLeft: true,
      };
    }


    // Eğer oda sahibi çıkmışsa ve odada halen biri varsa host haklarını devret!
    if (Number(room.hostId) === Number(playerId) && activePlayers.length > 0) {
      const newHostId = Number(activePlayers[0].id);
      room.hostId = newHostId;
      await supabase.from('rooms').update({ host_player_id: newHostId.toString() }).eq('code', code);
    }

    const playersInfo = this.getPlayersInfo(players || [], room.hostId);
    const activeCount = activePlayers.length;
    let shouldResetToLobby = false;
    let lobbyData = null;
    let validVotesCount = 0;

    if (room.state === 'end' && Array.isArray(room.playAgainVotes)) {
      const activeIds = activePlayers.map(p => p.id.toString());
      const validVotes = room.playAgainVotes.filter(v => activeIds.includes(v.toString()));
      validVotesCount = validVotes.length;

      if (activeCount > 0 && validVotesCount >= activeCount) {
        // ÖNCE tüm cevapları sil, SONRA odayı güncelle (yarış koşulu engeli)
        await supabase.from('answers').delete().eq('room_code', code);
        await supabase.from('rooms').update({
            state: 'lobby',
            play_again_votes: [],
            current_question_index: 0
          }).eq('code', code);
        shouldResetToLobby = true;
        lobbyData = {
          players: playersInfo,
          settings: room.settings || { questionCount: 10 }
        };
      }
    }

    return {
      room,
      players: playersInfo,
      activePlayersCount: activeCount,
      validVotesCount,
      shouldResetToLobby,
      lobbyData,
      allLeft: false,
    };
  }

  async deleteRoom(code) {
    if (!code) return;
    // Sırayla sil: önce bağımlı tablolar (answers, players), sonra rooms
    await supabase.from('answers').delete().eq('room_code', code);
    await supabase.from('players').delete().eq('room_code', code);
    await supabase.from('rooms').delete().eq('code', code);
    console.log(`[RoomManager] Oda silindi: ${code}`);
  }
}
