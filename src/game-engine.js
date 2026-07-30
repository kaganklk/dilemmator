import fs from 'fs';
import { supabase } from './supabase-admin.js';

const dilemmasPath = new URL('./dilemmas.json', import.meta.url);
const allDilemmas = JSON.parse(fs.readFileSync(dilemmasPath, 'utf-8'));

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

    // Odanın mevcut ayarlarını (kullanılmış sorular listesini) çek
    const { data: room } = await supabase.from('rooms').select('settings').eq('code', roomCode).single();
    let settings = room?.settings || { questionCount: 10, usedQuestions: [] };
    let usedIds = settings.usedQuestions || [];

    // Kullanılmamış soruları filtrele
    let availableQuestions = allDilemmas.filter(q => !usedIds.includes(q.id));

    // Eğer yeterli soru kalmadıysa, o odanın listesini sıfırla
    if (availableQuestions.length < count) {
      usedIds = [];
      availableQuestions = [...allDilemmas];
    }

    const selectedQuestions = shuffle(availableQuestions).slice(0, count);

    // İlk soru gösterildiği için, o sorunun ID'sini listeye ekle
    const firstQ = selectedQuestions[0];
    if (firstQ && !usedIds.includes(firstQ.id)) {
      usedIds.push(firstQ.id);
    }
    settings.usedQuestions = usedIds;

    // ÖNCE eski cevapleri kesin olarak sil, yarış koşulunu engelle!
    await supabase.from('answers').delete().eq('room_code', roomCode);

    // SONRA oda durumunu güncelle
    await supabase.from('rooms').update({
      state: 'playing',
      questions: selectedQuestions,
      current_question_index: 0,
      play_again_votes: [],
      settings: settings
    }).eq('code', roomCode);

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
    // Mevcut oda ve oyuncuyu AYNI ANDA paralel olarak al (300ms kazanım!)
    const [roomRes, playerRes] = await Promise.all([
      supabase.from('rooms').select('state, questions, current_question_index').eq('code', roomCode).maybeSingle(),
      supabase.from('players').select('name, color').eq('room_code', roomCode).eq('id', playerId.toString()).maybeSingle()
    ]);

    const room = roomRes.data;
    const player = playerRes.data;

    if (!room || room.state !== 'playing' || !room.questions || room.current_question_index < 0) {
      return null;
    }

    const currentQ = room.questions[room.current_question_index];
    if (!currentQ) return null;

    // Cevabı kaydet — önce mevcut cevabı kontrol et, varsa güncelle, yoksa ekle
    // (upsert yerine delete+insert kullanarak unique constraint sorununu aşıyoruz)
    await supabase.from('answers').delete()
      .eq('room_code', roomCode)
      .eq('question_id', currentQ.id.toString())
      .eq('player_id', playerId.toString());
    
    await supabase.from('answers').insert({
      room_code: roomCode,
      question_id: currentQ.id.toString(),
      player_id: playerId.toString(),
      answer,
      player_name: player?.name || 'Anonim',
      player_color: player?.color || '#666',
    });

    // Odadaki toplam oyuncuları ve cevaplayanları paralel say
    const [playersRes, answersRes] = await Promise.all([
      supabase.from('players').select('*', { count: 'exact', head: true }).eq('room_code', roomCode).eq('connected', true),
      supabase.from('answers').select('player_id').eq('room_code', roomCode).eq('question_id', currentQ.id.toString())
    ]);

    const totalPlayers = playersRes.count || 1;
    let totalAnswered = 0;
    if (answersRes.data) {
      const uniquePlayers = new Set(answersRes.data.map(a => Number(a.player_id)));
      totalAnswered = uniquePlayers.size;
    }
    const allAnswered = totalAnswered >= totalPlayers;

    if (allAnswered) {
      await supabase.from('rooms').update({ state: 'results' }).eq('code', roomCode);
    }

    return {
      playerId: Number(playerId),
      name: player?.name || 'Anonim',
      color: player?.color || '#666',
      answer,
      questionId: currentQ.id.toString(),
      totalAnswered,
      totalPlayers,
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
      // Bir oyuncunun cevabı iki kez sayılmasın diye Map kullanıyoruz
      const uniqueAnswersMap = new Map();
      
      for (const ans of qAnswers) {
        uniqueAnswersMap.set(Number(ans.player_id), ans);
      }

      for (const ans of uniqueAnswersMap.values()) {
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
    // Cevap yoksa null dön (50/50 sahte veri yayınlama)
    if (total === 0) return null;
    const yapardimPercent = Math.round((yapardim / total) * 100);
    const yapmazdimPercent = 100 - yapardimPercent;

    return {
      questionId: q.id,
      question: q.text,
      yapardimPercent,
      yapmazdimPercent,
      playerAnswers,
      isLastQuestion: room.current_question_index >= room.questions.length - 1,
    };
  }

  async nextQuestion(roomCode, preloadedRoom = null) {
    let room;
    if (preloadedRoom) {
      // next-question.js zaten room'u getirdi, tekrar SELECT yapma
      room = preloadedRoom;
    } else {
      const { data } = await supabase
        .from('rooms')
        .select('questions, current_question_index, settings')
        .eq('code', roomCode)
        .maybeSingle();
      room = data;
    }

    if (!room || !room.questions) return { error: 'Oda bulunamadı' };

    const nextIndex = room.current_question_index + 1;
    if (nextIndex < room.questions.length) {
      const nextQ = room.questions[nextIndex];
      
      // Gösterilen sorunun ID'sini kullanılmış sorulara ekle
      let settings = room.settings || { questionCount: 10, usedQuestions: [] };
      let usedIds = settings.usedQuestions || [];
      if (!usedIds.includes(nextQ.id)) {
        usedIds.push(nextQ.id);
        settings.usedQuestions = usedIds;
      }

      // NOT: Cevaplar ARASINDA silinmiyor — getGameEndResults tüm soruların cevaplarına ihtiyaç duyar.
      // getQuestionResults ve allAnswered zaten question_id'ye göre filtreler, eski cevaplar onları etkilemez.
      // Cevaplar sadece yeni oyun başlarken (startGame) silinir.

      const { data: updateResult, error: updateError } = await supabase.from('rooms').update({ 
        current_question_index: nextIndex, 
        state: 'playing',
        settings: settings
      })
      .eq('code', roomCode)
      .eq('current_question_index', room.current_question_index)
      .select('code');

      if (updateError || !updateResult || updateResult.length === 0) {
        return { error: 'Bu soru zaten değiştirilmiş (yarış koşulu)' };
      }
      
      return {
        gameOver: false,
        question: {
          id: nextQ.id,
          text: nextQ.text,
          index: nextIndex,
          total: room.questions.length,
        },
      };
    } else {
      const { data: updateResult, error: updateError } = await supabase.from('rooms').update({ state: 'end' })
        .eq('code', roomCode)
        .eq('current_question_index', room.current_question_index)
        .select('code');

      if (updateError || !updateResult || updateResult.length === 0) {
        return { error: 'Oyun zaten sonlandırılmış (yarış koşulu)' };
      }
      const results = await this.getGameEndResults(roomCode, room.questions);
      return {
        gameOver: true,
        results,
      };
    }
  }

  async getGameEndResults(roomCode, questions) {
    // Tüm oyuncular ve tüm cevaplar tek hamlede paralel alınır
    const [playersRes, answersRes] = await Promise.all([
      supabase.from('players').select('*').eq('room_code', roomCode),
      supabase.from('answers').select('*').eq('room_code', roomCode)
    ]);

    const players = playersRes.data || [];
    const allAnswers = answersRes.data || [];

    const playersList = players.map(p => ({
      id: Number(p.id),
      name: p.name || 'Anonim',
      color: p.color || '#666',
      canililkYuzdesi: 0,
    }));

    const totalQuestions = questions ? questions.length : 10;
    const stats = {};
    for (const p of playersList) {
      stats[p.id] = { yapardimCount: 0, cani: 0, paragoz: 0, bencil: 0 };
    }

    if (allAnswers && allAnswers.length > 0) {
      // Dedup: aynı oyuncu+soru kombinasyonu birden fazla kez sayılmasın
      const uniqueAnswersMap = new Map();
      for (const ans of allAnswers) {
        uniqueAnswersMap.set(`${ans.player_id}_${ans.question_id}`, ans);
      }
      const deduplicatedAnswers = Array.from(uniqueAnswersMap.values());

      for (const ans of deduplicatedAnswers) {
        const pid = Number(ans.player_id);
        if (!stats[pid]) stats[pid] = { yapardimCount: 0, cani: 0, paragoz: 0, bencil: 0 };
        if (ans.answer === 'yapardim') {
          stats[pid].yapardimCount++;
          const qObj = (questions || []).find(q => String(q.id) === String(ans.question_id)) || allDilemmas.find(q => String(q.id) === String(ans.question_id));
          if (qObj && Array.isArray(qObj.tags)) {
            if (qObj.tags.includes('cani')) stats[pid].cani++;
            if (qObj.tags.includes('paragoz')) stats[pid].paragoz++;
            if (qObj.tags.includes('bencil')) stats[pid].bencil++;
          }
        }
      }
    }

    for (const p of playersList) {
      const st = stats[p.id] || { yapardimCount: 0, cani: 0, paragoz: 0, bencil: 0 };
      p.canililkYuzdesi = Math.round((st.yapardimCount / Math.max(1, totalQuestions)) * 100);
    }

    playersList.sort((a, b) => b.canililkYuzdesi - a.canililkYuzdesi);

    const buildAward = (categoryKey) => {
      let maxScore = 0;
      playersList.forEach(p => {
        const score = stats[p.id]?.[categoryKey] || 0;
        if (score > maxScore) maxScore = score;
      });
      if (maxScore <= 0) return undefined;

      const winners = playersList.filter(p => (stats[p.id]?.[categoryKey] || 0) === maxScore);
      const nameText = winners.map(w => w.name || 'Anonim').join(winners.length === 2 ? ' & ' : ', ');
      return {
        name: nameText,
        score: maxScore,
        color: winners[0]?.color || '#FF2D55',
      };
    };

    const awards = {};
    const caniAward = buildAward('cani');
    if (caniAward) awards.enCani = caniAward;
    const paragozAward = buildAward('paragoz');
    if (paragozAward) awards.enParagoz = paragozAward;
    const bencilAward = buildAward('bencil');
    if (bencilAward) awards.enBencil = bencilAward;

    return {
      players: playersList,
      awards,
    };
  }

  async playAgain(roomCode, playerId) {
    const { data: room } = await supabase
      .from('rooms')
      .select('play_again_votes, state, settings')
      .eq('code', roomCode)
      .maybeSingle();

    if (!room) return null;

    let votes = room.play_again_votes || [];
    const pidStr = playerId.toString();
    if (!votes.includes(pidStr)) {
      votes.push(pidStr);
    }

    // Odadaki aktif (çevrimiçi) oyuncu listesini bul
    const { data: activePlayers } = await supabase
      .from('players')
      .select('id')
      .eq('room_code', roomCode)
      .eq('connected', true);

    const activeIds = (activePlayers || []).map(p => p.id.toString());
    const total = activeIds.length || 1;

    // Oy kaydedilmeden ÖNCE allVoted kontrolü (önceki state'e göre)
    const validVotes = votes.filter(v => activeIds.includes(v.toString()));

    if (validVotes.length >= total) {
      // Herkes oyladı (veya odada tek kişi var), önce state'i temizle ve listeyi sıfırla
      let currentSettings = room.settings || { questionCount: 10, usedQuestions: [] };
      currentSettings.usedQuestions = [];

      // Sadece play_again_votes ve settings (sıfırlanmış) güncelleniyor.
      await supabase.from('rooms').update({
        play_again_votes: [],
        settings: currentSettings
      }).eq('code', roomCode);

      // Yeni oyun başlamadan ÖNCE tüm eski cevapları kesin olarak sil
      await supabase.from('answers').delete().eq('room_code', roomCode);

      // Sonra yeni oyunu başlat (startGame içinde de silme var ama bu ek güvenlik katmanı)
      const firstQ = await this.startGame(roomCode, currentSettings.questionCount);

      return {
        reset: true,
        votes: validVotes.length,
        total,
        firstQ
      };
    } else {
      // Henüz herkes basmadı, oy sayısını kaydet
      await supabase
        .from('rooms')
        .update({ play_again_votes: votes })
        .eq('code', roomCode);

      // Yarış koşulu düzeltmesi: yazdıktan hemen sonra DB'yi tekrar oku.
      // Eşzamanlı yazma nedeniyle bizim oyumuz üzerine yazılmış olabilir.
      // Taze durumu ve bizim bildiğimiz oyu birleştirerek allVoted'ı doğru hesapla.
      const { data: freshRoom } = await supabase
        .from('rooms')
        .select('play_again_votes')
        .eq('code', roomCode)
        .maybeSingle();

      const freshVotes = freshRoom?.play_again_votes || votes;
      // Birleştir: DB'deki oylar + bizim oyumuz (eğer ezildiyse de dahil et)
      const mergedIds = [...new Set([...freshVotes.map(String), pidStr])];
      const mergedValidVotes = mergedIds.filter(v => activeIds.includes(v));

      if (mergedValidVotes.length >= total) {
        // Yarış koşulu: diğer oyuncu da oy kullandı ama üstüne yazdık, biz de tetikliyoruz
        let currentSettings = room.settings || { questionCount: 10, usedQuestions: [] };
        currentSettings.usedQuestions = [];

        await supabase.from('rooms').update({
          play_again_votes: [],
          settings: currentSettings
        }).eq('code', roomCode);

        await supabase.from('answers').delete().eq('room_code', roomCode);
        const firstQ = await this.startGame(roomCode, currentSettings.questionCount);

        return {
          reset: true,
          votes: mergedValidVotes.length,
          total,
          firstQ
        };
      }

      return {
        reset: false,
        votes: freshVotes.filter(v => activeIds.includes(v.toString())).length,
        total
      };
    }
  }
}

