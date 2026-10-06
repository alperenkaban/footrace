import { io } from 'socket.io-client';

const URL = 'http://localhost:3000';

function createPlayer(userId, name) {
  const socket = io(URL, { query: { userId } });

  socket.on('connect', () => {
    console.log(`\n[${name}] Bağlandı! ID: ${socket.id}`);
    
    // Eşleştirmeye katıl
    console.log(`[${name}] Eşleştirme kuyruğuna giriyor...`);
    socket.emit('join_matchmaking', { gameModeId: 'quick_2' });
  });

  socket.on('matchmaking_status', (data) => {
    console.log(`[${name}] Eşleştirme durumu:`, data);
  });

  socket.on('match_found', (data) => {
    console.log(`[${name}] 🔥 Eşleşme bulundu! Odaya giriliyor: ${data.roomId}`);
    socket.emit('join_room', { roomId: data.roomId });
  });

  socket.on('game_countdown', (data) => {
    console.log(`\n=================================`);
    console.log(`[${name}] 🎮 MAÇ BULUNDU! Başlıyor... ${data.timeLeft} saniye`);
    console.log(`=================================\n`);
  });

  socket.on('question_started', (data) => {
    console.log(`\n[${name}] ❓ SORU: ${data.text}`);
    console.log(`[${name}] ⏱️ Süre: ${data.durationMs / 1000} saniye`);
    
    // Rastgele bir sürede cevap gönderelim
    const answerTime = Math.floor(Math.random() * 5000) + 1000;
    setTimeout(() => {
      // Biri doğru cevap (Arjantin), diğeri yanlış versin
      const answer = name === 'Oyuncu1' ? 'Arjantin' : 'Brezilya';
      console.log(`[${name}] 🎯 Cevap gönderiliyor: ${answer}`);
      socket.emit('submit_answer', {
        questionIndex: data.questionIndex,
        answer: answer
      });
    }, answerTime);
  });

  socket.on('answer_ack', (data) => {
    console.log(`[${name}] ✅ Sunucu cevabı kabul etti:`, data);
  });

  socket.on('question_ended', (data) => {
    console.log(`\n[${name}] 🛑 Soru Bitti! Doğru Cevap: ${data.correctAnswer}`);
    console.table(data.playerResults);
  });

  socket.on('score_updated', (data) => {
    console.log(`[${name}] 📊 LİDERLİK TABLOSU:`);
    console.table(data.leaderboard);
  });

  socket.on('game_finished', (data) => {
    console.log(`\n🎉🎉🎉 OYUN BİTTİ! 🎉🎉🎉`);
    console.log(`[${name}] KAZANAN: ${data.winnerId}`);
    socket.disconnect();
  });
}

console.log('Test oyuncuları başlatılıyor...');
createPlayer('user_1', 'Oyuncu1');
createPlayer('user_2', 'Oyuncu2');
