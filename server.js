const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const players = {};

function updatePlayerSpawnPositions() {
  const ids = Object.keys(players);
  const total = ids.length;
  if (total === 0) return;

  // 新マップの上部中央にある大部屋（会議室）の中心座標
  const centerX = 19 * 36; 
  const centerY = 7 * 36;  
  const radius = 60;         

  ids.forEach((id, index) => {
    const angle = (index / total) * Math.PI * 2;
    players[id].x = centerX + Math.cos(angle) * radius;
    players[id].y = centerY + Math.sin(angle) * radius;
  });
}

function assignRoles() {
  const ids = Object.keys(players);
  if (ids.length === 0) return;

  for (let id of ids) {
    players[id].role = 'crewmate';
  }

  const imposterIndex = Math.floor(Math.random() * ids.length);
  const imposterId = ids[imposterIndex];
  players[imposterId].role = 'imposter';

  updatePlayerSpawnPositions();
  io.emit('currentPlayers', players);
}

io.on('connection', (socket) => {
  console.log(`ユーザーが接続しました: ${socket.id}`);

  players[socket.id] = {
    x: 0,
    y: 0,
    color: '#' + Math.floor(Math.random() * 16777215).toString(16),
    tasksCompleted: 0,
    role: 'crewmate',
    isDead: false
  };

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

  socket.on('killPlayer', (targetId) => {
    const killer = players[socket.id];
    const target = players[targetId];

    if (killer && killer.role === 'imposter' && !killer.isDead && target && !target.isDead) {
      target.isDead = true;
      io.emit('playerKilled', { targetId: targetId });
    }
  });

  socket.on('startMeeting', (data) => {
    io.emit('startMeeting', { reporterId: data.reporterId, reason: data.reason });
  });

  socket.on('chatMessage', (data) => {
    io.emit('chatMessage', {
      id: socket.id,
      name: socket.id.substring(0, 4),
      message: data.message
    });
  });

  socket.on('disconnect', () => {
    console.log(`ユーザーが切断しました: ${socket.id}`);
    delete players[socket.id];
    assignRoles();
    io.emit('disconnectPlayer', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバーが起動しました: http://localhost:${PORT}`);
});
