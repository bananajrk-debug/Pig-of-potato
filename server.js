const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// publicフォルダ内の静的ファイルを提供
app.use(express.static('public'));

// 接続中のプレイヤーを管理するオブジェクト
const players = {};

io.on('connection', (socket) => {
  console.log(`ユーザーが接続しました: ${socket.id}`);

  // 新規プレイヤーの初期データ作成
  players[socket.id] = {
    x: 100,
    y: 100,
    color: '#' + Math.floor(Math.random() * 16777215).toString(16), // ランダムカラー
    tasksCompleted: 0
  };

  // 現在いる全員のプレイヤー情報を新しい人に送る
  socket.emit('currentPlayers', players);

  // 新しいプレイヤーが入ってきたことを他の人に知らせる
  socket.broadcast.emit('newPlayer', {
    id: socket.id,
    player: players[socket.id]
  });

  // プレイヤーが移動したとき
  socket.on('playerMovement', (movementData) => {
    if (players[socket.id]) {
      players[socket.id].x = movementData.x;
      players[socket.id].y = movementData.y;
      // 他のプレイヤーに位置をブロードキャスト
      socket.broadcast.emit('playerMoved', {
        id: socket.id,
        x: players[socket.id].x,
        y: players[socket.id].y
      });
    }
  });

  // タスクを完了したとき
  socket.on('completeTask', () => {
    if (players[socket.id]) {
      players[socket.id].tasksCompleted += 1;
      io.emit('taskUpdate', { id: socket.id, tasksCompleted: players[socket.id].tasksCompleted });
    }
  });

  // 切断されたとき
  socket.on('disconnect', () => {
    console.log(`ユーザーが切断しました: ${socket.id}`);
    delete players[socket.id];
    io.emit('disconnectPlayer', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`サーバーが起動しました: http://localhost:${PORT}`);
});
