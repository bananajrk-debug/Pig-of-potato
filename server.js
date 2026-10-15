const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// publicフォルダを静的ファイルとして公開
app.use(express.static(path.join(__dirname, 'public')));

// プレイヤー管理
const players = {};
// 海に浮かぶじゃがいも（お宝）の管理
const potatoes = [
  { id: 1, x: 400, y: 300, collected: false },
  { id: 2, x: 1200, y: 800, collected: false },
  { id: 3, x: 800, y: 200, collected: false },
  { id: 4, x: 300, y: 900, collected: false },
  { id: 5, x: 1500, y: 400, collected: false }
];

io.on('connection', (socket) => {
  console.log(`プレイヤーが接続しました: ${socket.id}`);

  // 新しいプレイヤー（豚の船）の初期化
  players[socket.id] = {
    id: socket.id,
    x: Math.random() * 1400 + 300,
    y: Math.random() * 900 + 300,
    angle: 0,
    score: 0,
    name: `豚の船長_${Math.floor(Math.random() * 900 + 100)}`
  };

  // 現在のゲーム状態を参加者に送信
  socket.emit('currentPlayers', players);
  socket.emit('currentPotatoes', potatoes);

  // 他のプレイヤーに参加を通知
  socket.broadcast.emit('newPlayer', players[socket.id]);

  // プレイヤーの移動処理
  socket.on('playerMovement', (movementData) => {
    if (players[socket.id]) {
      players[socket.id].x = movementData.x;
      players[socket.id].y = movementData.y;
      players[socket.id].angle = movementData.angle;

      // 移動を他のプレイヤーに共有
      socket.broadcast.emit('playerMoved', players[socket.id]);
    }
  });

  // じゃがいも回収処理
  socket.on('collectPotato', (potatoId) => {
    const potato = potatoes.find(p => p.id === potatoId);
    if (potato && !potato.collected) {
      potato.collected = true;
      if (players[socket.id]) {
        players[socket.id].score += 1;
        io.emit('potatoCollected', { potatoId, playerId: socket.id, score: players[socket.id].score });

        // 5秒後に別の場所にじゃがいもを再出現させる
        setTimeout(() => {
          potato.x = Math.random() * 1800 + 100;
          potato.y = Math.random() * 1300 + 100;
          potato.collected = false;
          io.emit('potatoRespawned', potato);
        }, 5000);
      }
    }
  });

  // 切断時の処理
  socket.on('disconnect', () => {
    console.log(`プレイヤーが切断しました: ${socket.id}`);
    delete players[socket.id];
    io.emit('disconnectPlayer', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✨ Pig of Potato サーバーが起動しました: http://localhost:${PORT}`);
});
