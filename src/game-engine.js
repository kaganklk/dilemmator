// src/game-engine.js — Oyun mantığı + kişilik analizi
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const allDilemmas = JSON.parse(readFileSync(join(__dirname, 'dilemmas.json'), 'utf-8'));

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class GameEngine {

  startGame(room) {
    const count = Math.min(room.settings.questionCount, allDilemmas.length);
    room.questions = shuffle(allDilemmas).slice(0, count);
    room.currentQuestionIndex = 0;
    room.answers = new Map();
    room.state = 'playing';

    // Her soru için boş cevap haritası
    for (const q of room.questions) {
      room.answers.set(q.id, new Map());
    }

    return this.getCurrentQuestion(room);
  }

  getCurrentQuestion(room) {
    if (room.currentQuestionIndex < 0 || room.currentQuestionIndex >= room.questions.length) {
      return null;
    }
    const q = room.questions[room.currentQuestionIndex];
    return {
      id: q.id,
      text: q.text,
      index: room.currentQuestionIndex,
      total: room.questions.length,
    };
  }

  submitAnswer(room, playerId, answer) {
    const q = room.questions[room.currentQuestionIndex];
    if (!q) return null;

    const qAnswers = room.answers.get(q.id);
    if (qAnswers.has(playerId)) return null; // zaten cevapladı

    qAnswers.set(playerId, answer); // 'yapardim' veya 'yapmazdim'

    return {
      playerId,
      answer,
      totalAnswered: qAnswers.size,
      totalPlayers: room.players.size,
      allAnswered: qAnswers.size >= room.players.size,
    };
  }

  getQuestionResults(room) {
    const q = room.questions[room.currentQuestionIndex];
    const qAnswers = room.answers.get(q.id);

    let yapardim = 0;
    let yapmazdim = 0;
    const playerAnswers = [];

    for (const [pid, answer] of qAnswers) {
      const player = room.players.get(pid);
      if (answer === 'yapardim') yapardim++;
      else yapmazdim++;

      playerAnswers.push({
        playerId: pid,
        name: player?.name || 'Anonim',
        color: player?.color || '#666',
        answer,
      });
    }

    const total = yapardim + yapmazdim;
    return {
      question: q.text,
      yapardim,
      yapmazdim,
      yapardimPercent: total > 0 ? Math.round((yapardim / total) * 100) : 0,
      yapmazdimPercent: total > 0 ? Math.round((yapmazdim / total) * 100) : 0,
      playerAnswers,
    };
  }

  nextQuestion(room) {
    room.currentQuestionIndex++;
    if (room.currentQuestionIndex >= room.questions.length) {
      room.state = 'ended';
      return null;
    }
    room.state = 'playing';
    return this.getCurrentQuestion(room);
  }

  isGameOver(room) {
    return room.currentQuestionIndex >= room.questions.length;
  }

  getGameResults(room) {
    // Her oyuncunun canilik/paragözlük/bencillik puanını hesapla
    const playerScores = new Map();

    for (const [pid, player] of room.players) {
      playerScores.set(pid, {
        playerId: pid,
        name: player.name,
        color: player.color,
        cani: 0,
        paragoz: 0,
        bencil: 0,
        totalYapardim: 0,
        totalQuestions: room.questions.length,
      });
    }

    // Her sorunun cevaplarını tara
    for (const q of room.questions) {
      const qAnswers = room.answers.get(q.id);
      if (!qAnswers) continue;

      for (const [pid, answer] of qAnswers) {
        const score = playerScores.get(pid);
        if (!score) continue;

        if (answer === 'yapardim') {
          score.totalYapardim++;
          // Etiketlere puan ekle
          if (q.tags.includes('cani')) score.cani++;
          if (q.tags.includes('paragoz')) score.paragoz++;
          if (q.tags.includes('bencil')) score.bencil++;
        }
      }
    }

    // Sonuçları diziye çevir
    const scores = [...playerScores.values()];

    // Her kategori için en yüksek puanlıyı bul
    const enCani = scores.length > 0 ? scores.reduce((a, b) => a.cani > b.cani ? a : b) : null;
    const enParagoz = scores.length > 0 ? scores.reduce((a, b) => a.paragoz > b.paragoz ? a : b) : null;
    const enBencil = scores.length > 0 ? scores.reduce((a, b) => a.bencil > b.bencil ? a : b) : null;

    // Canilik seviyesine göre sırala (yapardım yüzdesi)
    scores.sort((a, b) => (b.totalYapardim / b.totalQuestions) - (a.totalYapardim / a.totalQuestions));

    return {
      players: scores.map(s => ({
        ...s,
        canililkYuzdesi: Math.round((s.totalYapardim / s.totalQuestions) * 100),
      })),
      awards: {
        enCani: enCani && enCani.cani > 0 ? { name: enCani.name, color: enCani.color, score: enCani.cani, playerId: enCani.playerId } : null,
        enParagoz: enParagoz && enParagoz.paragoz > 0 ? { name: enParagoz.name, color: enParagoz.color, score: enParagoz.paragoz, playerId: enParagoz.playerId } : null,
        enBencil: enBencil && enBencil.bencil > 0 ? { name: enBencil.name, color: enBencil.color, score: enBencil.bencil, playerId: enBencil.playerId } : null,
      },
    };
  }

  resetGame(room) {
    room.state = 'lobby';
    room.currentQuestionIndex = -1;
    room.questions = [];
    room.answers = new Map();
  }
}
