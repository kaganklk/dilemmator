// server.js — Express + WebSocket sunucusu
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { RoomManager } from './src/rooms.js';
import { GameEngine } from './src/game-engine.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new RoomManager();
const engine = new GameEngine();

// Statik dosya sunumu
app.use(express.static(join(__dirname, 'public')));

// Gizlilik politikası sayfası
app.get('/gizlilik', (req, res) => {
  res.sendFile(join(__dirname, 'public', 'gizlilik.html'));
});

// API: istatistikler
app.get('/api/stats', (req, res) => {
  res.json({
    players: rooms.getPlayerCount(),
    rooms: rooms.getRoomCount(),
  });
});

// WebSocket → client bağlantıları yönetimi
const clientInfo = new WeakMap();
const disconnectTimers = new Map(); // "roomCode:playerId" → timerId

function broadcast(room, message, excludePlayerId = null) {
  const data = JSON.stringify(message);
  for (const [pid, player] of room.players) {
    if (pid !== excludePlayerId && player.ws && player.ws.readyState === 1) {
      player.ws.send(data);
    }
  }
}

function send(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

function advanceQuestion(room) {
  const nextQ = engine.nextQuestion(room);
  if (!nextQ) {
    // Oyun bitti
    room.state = 'ended';
    const gameResults = engine.getGameResults(room);
    broadcast(room, { type: 'game_ended', ...gameResults });
  } else {
    broadcast(room, { type: 'new_question', ...nextQ });
  }
}

wss.on('connection', (ws) => {
  clientInfo.set(ws, { playerId: null, roomCode: null });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const info = clientInfo.get(ws);

    switch (msg.type) {

      case 'create_room': {
        const { room, playerId } = rooms.createRoom(msg.name);
        const player = room.players.get(playerId);
        player.ws = ws;
        info.playerId = playerId;
        info.roomCode = room.code;

        send(ws, {
          type: 'room_created',
          roomCode: room.code,
          playerId,
          players: rooms.getPlayersInfo(room),
          settings: room.settings,
        });
        break;
      }

      case 'join_room': {
        const code = (msg.code || '').toUpperCase();
        const result = rooms.joinRoom(code, msg.name);

        if (result.error) {
          send(ws, { type: 'error', message: result.error });
          break;
        }

        const { room, playerId } = result;
        const player = room.players.get(playerId);
        player.ws = ws;
        info.playerId = playerId;
        info.roomCode = room.code;

        send(ws, {
          type: 'room_joined',
          roomCode: room.code,
          playerId,
          players: rooms.getPlayersInfo(room),
          settings: room.settings,
          gameState: room.state, // lobide mi, oyunda mı?
          isHost: playerId === room.hostId,
        });

        // Diğer oyunculara bildir
        broadcast(room, {
          type: 'player_joined',
          players: rooms.getPlayersInfo(room),
        }, playerId);

        // Eğer oyun devam ediyorsa, yeni oyuncuya mevcut soruyu gönder
        if (room.state === 'playing' || room.state === 'results') {
          const currentQ = engine.getCurrentQuestion(room);
          if (currentQ) {
            send(ws, { type: 'game_started', question: currentQ });
          }
        }
        break;
      }

      case 'rejoin_room': {
        const code = (msg.code || '').toUpperCase();
        const result = rooms.rejoinRoom(code, msg.name);

        if (result.error) {
          send(ws, { type: 'error', message: result.error });
          break;
        }

        const { room, playerId } = result;
        const player = room.players.get(playerId);
        player.ws = ws;
        info.playerId = playerId;
        info.roomCode = room.code;

        // Grace period timer'ı iptal et
        const graceKey = `${code}:${playerId}`;
        if (disconnectTimers.has(graceKey)) {
          clearTimeout(disconnectTimers.get(graceKey));
          disconnectTimers.delete(graceKey);
        }

        send(ws, {
          type: 'room_joined',
          roomCode: room.code,
          playerId,
          players: rooms.getPlayersInfo(room),
          settings: room.settings,
          isHost: playerId === room.hostId,
          gameState: room.state,
        });

        // Diğer oyunculara bildir
        broadcast(room, {
          type: 'player_joined',
          players: rooms.getPlayersInfo(room),
        }, playerId);

        // Eğer oyun devam ediyorsa, yeni oyuncuya mevcut soruyu gönder
        if (room.state === 'playing' || room.state === 'results') {
          const currentQ = engine.getCurrentQuestion(room);
          if (currentQ) {
            send(ws, { type: 'game_started', question: currentQ });
          }
        }
        break;
      }

      case 'update_settings': {
        const room = rooms.getRoom(info.roomCode);
        if (!room || info.playerId !== room.hostId) break;

        if (msg.questionCount) {
          room.settings.questionCount = Math.max(3, Math.min(20, parseInt(msg.questionCount) || 10));
        }

        broadcast(room, {
          type: 'settings_updated',
          settings: room.settings,
        });
        break;
      }

      case 'start_game': {
        const room = rooms.getRoom(info.roomCode);
        if (!room || info.playerId !== room.hostId) break;

        const question = engine.startGame(room);
        broadcast(room, { type: 'game_started', question });
        break;
      }

      case 'submit_answer': {
        const room = rooms.getRoom(info.roomCode);
        if (!room || room.state !== 'playing') break;

        const result = engine.submitAnswer(room, info.playerId, msg.answer);
        if (!result) break;

        // Herkes anında görsün
        const player = room.players.get(info.playerId);
        broadcast(room, {
          type: 'player_answered',
          playerId: info.playerId,
          name: player?.name || 'Anonim',
          color: player?.color || '#666',
          answer: msg.answer,
          totalAnswered: result.totalAnswered,
          totalPlayers: result.totalPlayers,
        });

        // Herkes cevapladıysa sonuçları göster
        if (result.allAnswered) {
          room.state = 'results';
          const results = engine.getQuestionResults(room);
          broadcast(room, { type: 'question_results', ...results });
        }
        break;
      }

      case 'next_question': {
        const room = rooms.getRoom(info.roomCode);
        if (!room || info.playerId !== room.hostId) break;
        if (room.state !== 'results') break;

        advanceQuestion(room);
        break;
      }

      case 'play_again': {
        const room = rooms.getRoom(info.roomCode);
        if (!room) break;

        if (!room.playAgainVotes) room.playAgainVotes = new Set();
        room.playAgainVotes.add(info.playerId);

        let connectedCount = 0;
        for (const [id, p] of room.players) {
          if (p.ws) connectedCount++;
        }

        if (room.playAgainVotes.size >= connectedCount) {
          engine.resetGame(room);
          room.playAgainVotes.clear();
          broadcast(room, {
            type: 'back_to_lobby',
            players: rooms.getPlayersInfo(room),
            settings: room.settings,
          });
        } else {
          broadcast(room, {
            type: 'play_again_update',
            votes: room.playAgainVotes.size,
            total: connectedCount
          });
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    const info = clientInfo.get(ws);
    if (!info || !info.roomCode) return;

    const room = rooms.getRoom(info.roomCode);
    if (room) {
      const player = room.players.get(info.playerId);
      if (player && player.ws === ws) {
        player.ws = null; // Hemen koptu olarak işaretle

        // Eğer oylama devam ediyorsa koptuğu için sayıyı yeniden hesapla
        if (room.playAgainVotes) {
          room.playAgainVotes.delete(info.playerId); // Kopan kişinin oyunu sil
          
          let connectedCount = 0;
          for (const [id, p] of room.players) {
            if (p.ws) connectedCount++;
          }
          
          if (connectedCount > 0 && room.playAgainVotes.size >= connectedCount) {
            engine.resetGame(room);
            room.playAgainVotes.clear();
            broadcast(room, {
              type: 'back_to_lobby',
              players: rooms.getPlayersInfo(room),
              settings: room.settings,
            });
          } else if (connectedCount > 0) {
            broadcast(room, {
              type: 'play_again_update',
              votes: room.playAgainVotes.size,
              total: connectedCount
            });
          }
        }
      }
    }

    // Grace period: 5sn bekle, bu sürede rejoin olmazsa sil
    const graceKey = `${info.roomCode}:${info.playerId}`;
    const timerId = setTimeout(() => {
      disconnectTimers.delete(graceKey);
      const roomToRemove = rooms.removePlayer(info.roomCode, info.playerId);
      if (roomToRemove) {
        broadcast(roomToRemove, {
          type: 'player_left',
          playerId: info.playerId,
          players: rooms.getPlayersInfo(roomToRemove),
          newHostId: roomToRemove.hostId,
        });
      }
    }, 5000);
    disconnectTimers.set(graceKey, timerId);
  });

  // Heartbeat
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// Heartbeat interval
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Dilemmator sunucusu çalışıyor: http://localhost:${PORT}`);
});
