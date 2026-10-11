const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 静的ファイルの提供
app.use(express.static(path.join(__dirname, 'public')));

// ゲームの状態管理
const players = {};
const tasks = [
  { id: 1, x: 200, y: 200, completed: false },
  { id: 2, x: 600, y: 200, completed: false },
  { id: 3, x: 400, y: 500, completed: false }
];

io.on('connection', (socket) => {
  console.log(`プレイヤー接続: ${socket.id}`);

  // 新規プレイヤーの初期化
  players[socket.id] = {
    x: Math.random() * 400 + 200,
    y: Math.random() * 300 + 150,
    role: Object.keys(players).length === 0 ? 'wolf' : 'citizen', // 最初の人を人狼に（簡易的）
    isAlive: true,
    color: '#' + Math.floor(Math.random()*16777215).toString(16)
  };

  // プレイヤー情報の同期
  io.emit('updatePlayers', players);
  socket.emit('initTasks', tasks);

  // 移動の受信
  socket.on('playerMove', (data) => {
    if (players[socket.id] && players[socket.id].isAlive) {
      players[socket.id].x = data.x;
      players[socket.id].y = data.y;
    }
  });

  // アクションキー (K) が押された時の処理
  socket.on('action', () => {
    const player = players[socket.id];
    if (!player || !player.isAlive) return;

    if (player.role === 'wolf') {
      // 人狼の場合：近くの市民をキル
      for (const id in players) {
        if (id !== socket.id && players[id].isAlive && players[id].role === 'citizen') {
          const target = players[id];
          const dist = Math.hypot(player.x - target.x, player.y - target.y);
          if (dist < 40) {
            target.isAlive = false;
            io.emit('message', { text: '誰かがキルされました！' });
            break;
          }
        }
      }
    } else {
      // 市民の場合：近くのタスクを修理
      tasks.forEach((task) => {
        if (!task.completed) {
          const dist = Math.hypot(player.x - task.x, player.y - task.y);
          if (dist < 50) {
            task.completed = true;
            io.emit('updateTasks', tasks);
            io.emit('message', { text: '飛行機のパーツが修理されました！' });
          }
        }
      });
    }
    io.emit('updatePlayers', players);
  });

  // 切断時
  socket.on('disconnect', () => {
    console.log(`プレイヤー切断: ${socket.id}`);
    delete players[socket.id];
    io.emit('updatePlayers', players);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバー起動中: http://localhost:${PORT}`);
});