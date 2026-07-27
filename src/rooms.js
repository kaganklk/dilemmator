// src/rooms.js — Oda yönetimi

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // karışabilecek harfler çıkarıldı (I,O,0,1)
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

let playerIdCounter = 0;

export class RoomManager {
  constructor() {
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
  }

  createRoom(hostName) {
    let code;
    do { code = generateCode(); } while (this.rooms.has(code));

    const hostId = ++playerIdCounter;
    const room = {
      code,
      hostId,
      players: new Map(),
      settings: { questionCount: 10 },
      state: 'lobby', // lobby | playing | results | ended
      currentQuestionIndex: -1,
      questions: [],
      answers: new Map(), // Map<questionId, Map<playerId, answer>>
    };

    room.players.set(hostId, {
      id: hostId,
      name: hostName || 'Anonim',
      ws: null,
      connected: true,
      color: this.getPlayerColor(0),
    });

    this.rooms.set(code, room);
    return { room, playerId: hostId };
  }

  joinRoom(code, playerName) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'Oda bulunamadı.' };
    if (room.players.size >= 15) return { error: 'Oda dolu (maks 15 kişi).' };

    const playerId = ++playerIdCounter;
    room.players.set(playerId, {
      id: playerId,
      name: playerName || 'Anonim',
      ws: null,
      connected: true,
      color: this.getPlayerColor(room.players.size),
    });

    return { room, playerId };
  }

  rejoinRoom(code, playerName) {
    const room = this.rooms.get(code);
    if (!room) return { error: 'Oda bulunamadı.' };

    // İsme göre mevcut oyuncuyu bul
    for (const [pid, player] of room.players) {
      if (player.name === (playerName || 'Anonim')) {
        player.connected = true;
        return { room, playerId: pid, rejoined: true };
      }
    }

    // Bulunamadıysa yeni oyuncu olarak ekle
    return this.joinRoom(code, playerName);
  }

  removePlayer(code, playerId) {
    const room = this.rooms.get(code);
    if (!room) return null;

    room.players.delete(playerId);

    // Oda boşsa sil
    if (room.players.size === 0) {
      this.rooms.delete(code);
      return null;
    }

    // Host ayrıldıysa yeni host ata
    if (playerId === room.hostId) {
      const firstPlayer = room.players.keys().next().value;
      room.hostId = firstPlayer;
    }

    return room;
  }

  getRoom(code) {
    return this.rooms.get(code) || null;
  }

  getPlayerColor(index) {
    const colors = [
      '#FF2D55', '#FF9F0A', '#30D158', '#5E5CE6',
      '#64D2FF', '#BF5AF2', '#FF6482', '#FFD60A',
      '#AC8E68', '#FF453A', '#32ADE6', '#63E6BE',
    ];
    return colors[index % colors.length];
  }

  getPlayersInfo(room) {
    const players = [];
    for (const [id, p] of room.players) {
      players.push({
        id,
        name: p.name,
        color: p.color,
        isHost: id === room.hostId,
        connected: p.connected,
      });
    }
    return players;
  }

  getRoomCount() {
    return this.rooms.size;
  }

  getPlayerCount() {
    let count = 0;
    for (const room of this.rooms.values()) {
      count += room.players.size;
    }
    return count;
  }
}
