// api/get-room-state.js
import { RoomManager } from '../src/rooms.js';
import { GameEngine } from '../src/game-engine.js';
import { supabase } from '../src/supabase-admin.js';

const rooms = new RoomManager();
const engine = new GameEngine();

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const body = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const { code = '', playerId } = body;
  const cleanCode = code.trim().toUpperCase();

  const room = await rooms.getRoom(cleanCode);
  if (!room) {
    return res.status(404).json({ error: 'Oda bulunamadı.' });
  }

  const players = await rooms.getPlayers(cleanCode);
  const playersInfo = rooms.getPlayersInfo(players, room.hostId);
  const activePlayers = playersInfo.filter(p => p.connected !== false);
  const totalPlayers = activePlayers.length || 1;

  let currentQuestion = null;
  let answers = [];
  let allAnswered = false;
  let qResults = null;

  if ((room.state === 'playing' || room.state === 'results') && room.questions && room.currentQuestionIndex >= 0 && room.currentQuestionIndex < room.questions.length) {
    const q = room.questions[room.currentQuestionIndex];
    currentQuestion = {
      id: q.id,
      text: q.text,
      index: room.currentQuestionIndex,
      total: room.questions.length
    };

    const { data: qAnswers } = await supabase
      .from('answers')
      .select('*')
      .eq('room_code', cleanCode)
      .eq('question_id', String(q.id));

    if (qAnswers && qAnswers.length > 0) {
      const uniqueMap = new Map();
      for (const a of qAnswers) {
        uniqueMap.set(Number(a.player_id), {
          playerId: Number(a.player_id),
          name: a.player_name || 'Anonim',
          color: a.player_color || '#666',
          answer: a.answer,
          questionId: a.question_id
        });
      }
      answers = Array.from(uniqueMap.values());
    }

    if ((room.state === 'results' || (answers.length >= totalPlayers && activePlayers.length > 0))) {
      allAnswered = true;
      qResults = await engine.getQuestionResults(cleanCode);
    }
  }

  let gameEndResults = null;
  if (room.state === 'end') {
    gameEndResults = await engine.getGameEndResults(cleanCode, room.questions);
  }

  return res.status(200).json({
    success: true,
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    settings: room.settings || { questionCount: 10 },
    playAgainVotes: room.playAgainVotes || [],
    players: playersInfo,
    currentQuestion,
    answers,
    allAnswered,
    qResults,
    gameEndResults
  });
}
