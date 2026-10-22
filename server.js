const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// 静的ファイルの提供 (publicフォルダまたはカレントディレクトリのindex.html)
app.use(express.static(__dirname));

const players = {};

io.on('connection', (socket) => {
  console.log(`プレイヤーが接続しました: ${socket.id}`);

  // 新規プレイヤーの初期データ作成
  players[socket.id] = {
    x: 0,
    y: 1,
    z: 0,
    rotationY: 0
  };

  // 既存のプレイヤー情報を新参加者に送る
  socket.emit('currentPlayers', players);

  // 他のプレイヤーに新参加者を通知
  socket.broadcast.emit('newPlayer', {
    id: socket.id,
    player: players[socket.id]
  });

  // プレイヤーの移動・視点更新
  socket.emit('playerMovement', (movementData) => {
    if (players[socket.id]) {
      players[socket.id].x = movementData.x;
      players[socket.id].y = movementData.y;
      players[socket.id].z = movementData.z;
      players[socket.id].rotationY = movementData.rotationY;

      // 他のプレイヤーに位置をブロードキャスト
      socket.broadcast.emit('playerMoved', {
        id: socket.id,
        player: players[socket.id]
      });
    }
  });

  // 射撃アクションの同期
  socket.on('shoot', (data) => {
    socket.broadcast.emit('playerShot', {
      id: socket.id,
      origin: data.origin,
      direction: data.direction
    });
  });

  // 切断時
  socket.on('disconnect', () => {
    console.log(`プレイヤーが切断しました: ${socket.id}`);
    delete players[socket.id];
    io.emit('disconnectPlayer', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバーがポート ${PORT} で起動しました`);
});
