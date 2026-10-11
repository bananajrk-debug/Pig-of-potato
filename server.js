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

const WORLD_WIDTH = 2600;
const WORLD_HEIGHT = 1800;

// 壁に重ならない安全なスポーン地点の候補
const spawnPoints = [
  { x: 150, y: 150 },
  { x: 1300, y: 150 },
  { x: 2400, y: 150 },
  { x: 1300, y: 900 },
  { x: 150, y: 1650 },
  { x: 1300, y: 1650 },
  { x: 2400, y: 1650 }
];

const players = {};
// 壁に埋まらない、通路や部屋の開けた場所に配置したタスク
const tasks = [
  { id: 1, x: 200, y: 500, completed: false },
  { id: 2, x: 900, y: 150, completed: false },
  { id: 3, x: 1800, y: 200, completed: false },
  { id: 4, x: 1300, y: 900, completed: false },
  { id: 5, x: 400, y: 1550, completed: false },
  { id: 6, x: 2200, y: 1550, completed: false }
];

io.on('connection', (socket) => {
  console.log(`プレイヤー接続: ${socket.id}`);

  // 安全なスポーン地点からランダムに選択
  const sp = spawnPoints[Math.floor(Math.random() * spawnPoints.length)];

  players[socket.id] = {
    x: sp.x,
    y: sp.y,
    role: Object.keys(players).length === 1 ? 'wolf' : 'citizen',
    isAlive: true,
    color: ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22'][Math.floor(Math.random() * 6)]
  };

  io.emit('updatePlayers', players);
  socket.emit('initTasks', tasks);

  socket.on('playerMove', (data) => {
    if (players[socket.id] && players[socket.id].isAlive) {
      players[socket.id].x = Math.max(30, Math.min(WORLD_WIDTH - 30, data.x));
      players[socket.id].y = Math.max(30, Math.min(WORLD_HEIGHT - 30, data.y));
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
          if (dist < 55) {
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
          if (dist < 60) {
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
