const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const players = {};

// 役職を割り振る関数
function assignRoles() {
  const ids = Object.keys(players);
  if (ids.length === 0) return;

  // 全員を一度クルーメイト（市民）にする
  for (let id of ids) {
    players[id].role = 'crewmate';
  }

  // ランダムに1人をインポスター（人狼）にする
  const imposterIndex = Math.floor(Math.random() * ids.length);
  const imposterId = ids[imposterIndex];
  players[imposterId].role = 'imposter';

  // 全員に現在のプレイヤー情報（役職含む）を送信
  io.emit('currentPlayers', players);
}

io.on('connection', (socket) => {
  console.log(`ユーザーが接続しました: ${socket.id}`);

  players[socket.id] = {
    x: 100 + Math.random() * 200,
    y: 100 + Math.random() * 200,
    color: '#' + Math.floor(Math.random() * 16777215).toString(16),
    tasksCompleted: 0,
    role: 'crewmate',
    isDead: false
  };

  // 誰かが入ってきたら役職を再割り当てして全員に通知
  assignRoles();

  socket.on('playerMovement', (movementData) => {
    if (players[socket.id] && !players[socket.id].isDead) {
      players[socket.id].x = movementData.x;
      players[socket.id].y = movementData.y;
      socket.broadcast.emit('playerMoved', {
        id: socket.id,
        x: players[socket.id].x,
        y: players[socket.id].y
      });
    }
  });

  socket.on('completeTask', () => {
    if (players[socket.id] && !players[socket.id].isDead) {
      players[socket.id].tasksCompleted += 1;
      io.emit('taskUpdate', { id: socket.id, tasksCompleted: players[socket.id].tasksCompleted });
    }
  });

  // キル処理
  socket.on('killPlayer', (targetId) => {
    const killer = players[socket.id];
    const target = players[targetId];

    // 自分が人狼で生存しており、ターゲットが存在して生存している場合
    if (killer && killer.role === 'imposter' && !killer.isDead && target && !target.isDead) {
      target.isDead = true;
      io.emit('playerKilled', { targetId: targetId });
    }
  });

  socket.on('disconnect', () => {
    console.log(`ユーザーが切断しました: ${socket.id}`);
    delete players[socket.id];
    assignRoles(); // 抜けたら役職を再割り当て
    io.emit('disconnectPlayer', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバーが起動しました: http://localhost:${PORT}`);
});
