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

// Among Us風マップのサイズ
const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 1600;

// 中央通路の完全に安全なスポーン地点（壁に絶対重ならない場所）
const spawnPoints = [
  { x: 1200, y: 800 },
  { x: 1300, y: 800 },
  { x: 1100, y: 800 }
];

const players = {};
// 部屋の中や通路の開けた場所に配置したタスク
const tasks = [
  { id: 1, x: 300,  y: 300, completed: false }, // コックピット
  { id: 2, x: 2100, y: 300, completed: false }, // 右エンジン
  { id: 3, x: 300,  y: 1300, completed: false }, // 左エンジン
  { id: 4, x: 2100, y: 1300, completed: false }, // 通信室
  { id: 5, x: 1200, y: 800, completed: false }  // 中央ホール
];

io.on('connection', (socket) => {
  console.log(`プレイヤー接続: ${socket.id}`);

  const sp = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];

  players[socket.id] = {
    x: sp.x,
    y: sp.y,
    role: Object.keys(players).length === 1 ? 'wolf' : 'citizen',
    isAlive: true,
    color: ['#ff3333', '#3366ff', '#33cc33', '#ffcc00', '#cc33cc', '#ff9900'][Math.floor(Math.random() * 6)]
  };

  io.emit('updatePlayers', players);
  socket.emit('initTasks', tasks);

  socket.on('playerMove', (data) => {
    if (players[socket.id] && players[socket.id].isAlive) {
      players[socket.id].x = Math.max(40, Math.min(WORLD_WIDTH - 40, data.x));
      players[socket.id].y = Math.max(40, Math.min(WORLD_HEIGHT - 40, data.y));
      socket.broadcast.emit('updatePlayers', players);
    }
  });

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
            io.emit('message', { text: '市民が襲撃されました！' });
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
