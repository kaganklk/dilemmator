// src/game-engine.js — Supabase destekli Stateless Oyun mantığı + kişilik analizi
import { createRequire } from 'module';
import { supabase } from './supabase-admin.js';

const require = createRequire(import.meta.url);
const allDilemmas = require('./dilemmas.json');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export class GameEngine {
  async startGame(roomCode, questionCount) {
    const count = Math.min(questionCount || 10, allDilemmas.length);
    const selectedQuestions = shuffle(allDilemmas).slice(0, count);

    // Eski cevapları sil
    await supabase.from('answers').delete().eq('room_code', roomCode);

    // Odayı oynanıyor durumuna getir
    await supabase.from('rooms').update({
      state: 'playing',
      questions: selectedQuestions,
      current_question_index: 0,
      play_again_votes: []
    }).eq('code', roomCode);

    const firstQ = selectedQuestions[0];
    return {
      id: firstQ.id,
      text: firstQ.text,
      index: 0,
      total: selectedQuestions.length,
    };
  }

  async getCurrentQuestion(roomCode) {
    const { data: room } = await supabase.from('rooms').select('questions, current_question_index').eq('code', roomCode).maybeSingle();
    if (!room || room.current_question_index < 0 || !room.questions || room.current_question_index >= room.questions.length) {
      return null;
    }
    const q = room.questions[room.current_question_index];
    return {
      id: q.id,
      text: q.text,
      index: room.current_question_index,
      total: room.questions.length,
    };
  }

  async submitAnswer(roomCode, playerId, answer) {
    // Mevcut odayı ve soruyu al
    const { data: room } = await supabase
      .from('rooms')
      .select('state, questions, current_question_index')
      .eq('code', roomCode)
      .maybeSingle();

    if (!room || room.state !== 'playing' || !room.questions || room.current_question_index < 0) {
      return null;
    }

    const currentQ = room.questions[room.current_question_index];
    if (!currentQ) return null;

    // Oyuncu bilgilerini al (isim, renk)
    const { data: player } = await supabase
      .from('players')
      .select('name, color')
      .eq('room_code', roomCode)
      .eq('id', playerId.toString())
      .maybeSingle();

    // Cevabı ekle
    const { error: insertErr } = await supabase.from('answers').upsert({
      room_code: roomCode,
      question_id: currentQ.id.toString(),
      player_id: playerId.toString(),
      answer,
      player_name: player?.name || 'Anonim',
      player_color: player?.color || '#666',
    });

    if (insertErr) {
      console.error('Cevap kaydetme hatası:', insertErr);
      return null;
    }

    // Ovadaki toplam oyuncuları ve cevaplayanları say
    const { count: totalPlayers } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true })
      .eq('room_code', roomCode);

    const { data: answeredRows } = await supabase
      .from('answers')
      .select('player_id')
      .eq('room_code', roomCode)
      .eq('question_id', currentQ.id.toString());

    const totalAnswered = answeredRows ? answeredRows.length : 0;
    const allAnswered = totalAnswered >= (totalPlayers || 1);

    // Eğer herkes cevapladıysa odayı results durumuna geçir
    if (allAnswered) {
      await supabase.from('rooms').update({ state: 'results' }).eq('code', roomCode);
    }

    return {
      playerId: Number(playerId),
      name: player?.name || 'Anonim',
      color: player?.color || '#666',
      answer,
      totalAnswered,
      totalPlayers: totalPlayers || 1,
      allAnswered,
    };
  }

  async getQuestionResults(roomCode) {
    const { data: room } = await supabase
      .from('rooms')
      .select('questions, current_question_index')
      .eq('code', roomCode)
      .maybeSingle();

    if (!room || !room.questions || room.current_question_index < 0) return null;
    const q = room.questions[room.current_question_index];

    const { data: qAnswers } = await supabase
      .from('answers')
      .select('*')
      .eq('room_code', roomCode)
      .eq('question_id', q.id.toString());

    let yapardim = 0;
    let yapmazdim = 0;
    const playerAnswers = [];

    if (qAnswers) {
      for (const ans of qAnswers) {
        if (ans.answer === 'yapardim') yapardim++;
        else yapmazdim++;

        playerAnswers.push({
          playerId: Number(ans.player_id),
          name: ans.player_name || 'Anonim',
          color: ans.player_color || '#666',
          answer: ans.answer,
        });
      }
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

  async nextQuestion(roomCode) {
    const { data: room } = await supabase
      .from('rooms')
      .select('questions, current_question_index')
      .eq('code', roomCode)
      .maybeSingle();

    if (!room || !room.questions) return { gameOver: true };

    const nextIndex = room.current_question_index + 1;
    if (nextIndex >= room.questions.length) {
      // Oyun bitti
      await supabase.from('rooms').update({ state: 'ended' }).eq('code', roomCode);
      const results = await this.getGameResults(roomCode, room.questions);
      return { gameOver: true, results };
    }

    await supabase.from('rooms').update({
      state: 'playing',
      current_question_index: nextIndex
    }).eq('code', roomCode);

    const nextQ = room.questions[nextIndex];
    return {
      gameOver: false,
      question: {
        id: nextQ.id,
        text: nextQ.text,
        index: nextIndex,
        total: room.questions.length,
      }
    };
  }

  async getGameResults(roomCode, questionsList = null) {
    let questions = questionsList;
    if (!questions) {
      const { data: room } = await supabase.from('rooms').select('questions').eq('code', roomCode).maybeSingle();
      questions = room?.questions || [];
    }

    const { data: players } = await supabase.from('players').select('*').eq('room_code', roomCode);
    const { data: allAnswers } = await supabase.from('answers').select('*').eq('room_code', roomCode);

    const playerScores = new Map();
    if (players) {
      for (const p of players) {
        playerScores.set(p.id, {
          playerId: Number(p.id),
          name: p.name,
          color: p.color,
          cani: 0,
          paragoz: 0,
          bencil: 0,
          totalYapardim: 0,
          totalQuestions: questions.length || 1,
        });
      }
    }

    if (allAnswers && questions.length > 0) {
      const questionMap = new Map();
      for (const q of questions) {
        questionMap.set(q.id.toString(), q);
      }

      for (const ans of allAnswers) {
        const score = playerScores.get(ans.player_id.toString());
        const q = questionMap.get(ans.question_id.toString());
        if (!score || !q) continue;

        if (ans.answer === 'yapardim') {
          score.totalYapardim++;
          const tags = q.tags || [];
          if (tags.includes('cani')) score.cani++;
          if (tags.includes('paragoz')) score.paragoz++;
          if (tags.includes('bencil')) score.bencil++;
        }
      }
    }

    const scores = [...playerScores.values()];
    const enCani = scores.length > 0 ? scores.reduce((a, b) => a.cani > b.cani ? a : b, scores[0]) : null;
    const enParagoz = scores.length > 0 ? scores.reduce((a, b) => a.paragoz > b.paragoz ? a : b, scores[0]) : null;
    const enBencil = scores.length > 0 ? scores.reduce((a, b) => a.bencil > b.bencil ? a : b, scores[0]) : null;

    scores.sort((a, b) => (b.totalYapardim / b.totalQuestions) - (a.totalYapardim / a.totalQuestions));

    return {
      players: scores.map(s => ({
        ...s,
        canililkYuzdesi: Math.round((s.totalYapardim / (s.totalQuestions || 1)) * 100),
      })),
      awards: {
        enCani: enCani && enCani.cani > 0 ? { name: enCani.name, color: enCani.color, score: enCani.cani, playerId: enCani.playerId } : null,
        enParagoz: enParagoz && enParagoz.paragoz > 0 ? { name: enParagoz.name, color: enParagoz.color, score: enParagoz.paragoz, playerId: enParagoz.playerId } : null,
        enBencil: enBencil && enBencil.bencil > 0 ? { name: enBencil.name, color: enBencil.color, score: enBencil.bencil, playerId: enBencil.playerId } : null,
      },
    };
  }

  async resetGame(roomCode) {
    await supabase.from('answers').delete().eq('room_code', roomCode);
    await supabase.from('rooms').update({
      state: 'lobby',
      current_question_index: -1,
      questions: [],
      play_again_votes: [],
    }).eq('code', roomCode);
  }

  async playAgain(roomCode, playerId) {
    const { data: room } = await supabase.from('rooms').select('play_again_votes, settings, host_player_id').eq('code', roomCode).maybeSingle();
    if (!room) return null;

    const votes = new Set((room.play_again_votes || []).map(Number));
    votes.add(Number(playerId));

    const { count: totalPlayers } = await supabase.from('players').select('*', { count: 'exact', head: true }).eq('room_code', roomCode);
    const total = totalPlayers || 1;

    if (votes.size >= total) {
      await this.resetGame(roomCode);
      return { reset: true, total };
    } else {
      const votesArr = Array.from(votes);
      await supabase.from('rooms').update({ play_again_votes: votesArr }).eq('code', roomCode);
      return { reset: false, votes: votes.size, total };
    }
  }
}
