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

const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 1600;

// 飛行機の通路や部屋の中にある、絶対に壁に埋まらない安全なスポーン地点
const spawnPoints = [
  { x: 1500, y: 350 }, // コックピット中央通路
  { x: 1100, y: 750 }, // 客室A
  { x: 1900, y: 750 }, // 客室B
  { x: 1500, y: 1200 } // 後部ラウンジ
];

const players = {};
// 飛行機内の通路や開けた場所に配置したタスク
const tasks = [
  { id: 1, x: 1500, y: 250, completed: false }, // 操縦席
  { id: 2, x: 850,  y: 750, completed: false }, // 左翼・客室通路
  { id: 3, x: 2150, y: 750, completed: false }, // 右翼・客室通路
  { id: 4, x: 1500, y: 750, completed: false }, // 中央通路
  { id: 5, x: 1100, y: 1300, completed: false },// 後部貨物スペース
  { id: 6, x: 1900, y: 1300, completed: false } // エンジン整備エリア
];

io.on('connection', (socket) => {
  console.log(`プレイヤー接続: ${socket.id}`);

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
      players[socket.id].x = Math.max(50, Math.min(WORLD_WIDTH - 50, data.x));
      players[socket.id].y = Math.max(50, Math.min(WORLD_HEIGHT - 50, data.y));
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
