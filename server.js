const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const WORLD_WIDTH = 4000;
const WORLD_HEIGHT = 3000;
const players = {};
const tasks = [
  { id: 1, x: 500, y: 500, completed: false },
  { id: 2, x: 2000, y: 600, completed: false },
  { id: 3, x: 3500, y: 800, completed: false },
  { id: 4, x: 1000, y: 2200, completed: false },
  { id: 5, x: 3000, y: 2400, completed: false }
];

io.on('connection', (socket) => {
  console.log(`プレイヤー接続: ${socket.id}`);

  // 新規プレイヤー
  players[socket.id] = {
    x: Math.random() * 2000 + 1000,
    y: Math.random() * 1500 + 750,
    role: Object.keys(players).length === 1 ? 'wolf' : 'citizen',
    isAlive: true,
    color: '#' + Math.floor(Math.random()*16777215).toString(16)
  };

  io.emit('updatePlayers', players);
  socket.emit('initTasks', tasks);

  // 移動データを受信してそのまま全クライアントへ即座に反映
  socket.on('playerMove', (data) => {
    if (players[socket.id] && players[socket.id].isAlive) {
      players[socket.id].x = Math.max(20, Math.min(WORLD_WIDTH - 20, data.x));
      players[socket.id].y = Math.max(20, Math.min(WORLD_HEIGHT - 20, data.y));
      io.emit('updatePlayers', players);
    }
  });

  // アクション (Kキー)
  socket.on('action', () => {
    const player = players[socket.id];
    if (!player || !player.isAlive) return;

    if (player.role === 'wolf') {
      for (const id in players) {
        if (id !== socket.id && players[id].isAlive && players[id].role === 'citizen') {
          const target = players[id];
          const dist = Math.hypot(player.x - target.x, player.y - target.y);
          if (dist < 60) {
            target.isAlive = false;
            io.emit('message', { text: '市民がキルされました！' });
            break;
          }
        }
      }
    } else {
      tasks.forEach((task) => {
        if (!task.completed) {
          const dist = Math.hypot(player.x - task.x, player.y - task.y);
          if (dist < 70) {
            task.completed = true;
            io.emit('updateTasks', tasks);
            io.emit('message', { text: '飛行機のパーツが修理されました！' });
          }
        }
      });
    }
    io.emit('updatePlayers', players);
  });

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
