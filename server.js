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

// マップサイズを3倍（2400 x 1800）に変更
const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 1800;

const players = {};
const tasks = [
  { id: 1, x: 400, y: 400, completed: false },
  { id: 2, x: 1200, y: 500, completed: false },
  { id: 3, x: 2000, y: 400, completed: false },
  { id: 4, x: 600, y: 1400, completed: false },
  { id: 5, x: 1800, y: 1400, completed: false }
];

io.on('connection', (socket) => {
  console.log(`プレイヤー接続: ${socket.id}`);

  players[socket.id] = {
    x: Math.random() * 1000 + 700,
    y: Math.random() * 800 + 500,
    role: Object.keys(players).length === 1 ? 'wolf' : 'citizen',
    isAlive: true,
    color: '#' + Math.floor(Math.random()*16777215).toString(16)
  };

  io.emit('updatePlayers', players);
  socket.emit('initTasks', tasks);

  socket.on('playerMove', (data) => {
    if (players[socket.id] && players[socket.id].isAlive) {
      players[socket.id].x = Math.max(20, Math.min(WORLD_WIDTH - 20, data.x));
      players[socket.id].y = Math.max(20, Math.min(WORLD_HEIGHT - 20, data.y));
      // 自分以外のプレイヤーに位置をブロードキャストするため、全体へ送信
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
          if (dist < 50) {
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
