const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// publicフォルダを静的ファイルの配信元に設定
app.use(express.static(path.join(__dirname, 'public')));

// 接続中のプレイヤー管理
const players = {};

io.on('connection', (socket) => {
    console.log(`プレイヤーが接続しました: ${socket.id}`);

    // 新しいプレイヤーの初期位置と所持金を設定
    players[socket.id] = {
        x: 400,
        y: 350,
        coins: 0,
        name: `プレイヤー_${socket.id.substr(0, 4)}`
    };

    // 接続した本人に現在のプレイヤー一覧を送信
    socket.emit('currentPlayers', players);
    // 他のプレイヤーに新しい参加者を通知
    socket.broadcast.emit('newPlayer', { id: socket.id, player: players[socket.id] });

    // プレイヤーの移動処理
    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            socket.broadcast.emit('playerMoved', { id: socket.id, x: players[socket.id].x, y: players[socket.id].y });
        }
    });

    // 釣り実行時（イノコイン獲得）
    socket.on('fishCaught', () => {
        if (players[socket.id]) {
            const earnedCoins = Math.floor(Math.random() * 50) + 10; // 10〜60イノコインを獲得
            players[socket.id].coins += earnedCoins;
            socket.emit('coinUpdate', players[socket.id].coins);
        }
    });

    // 切断時
    socket.on('disconnect', () => {
        console.log(`プレイヤーが切断しました: ${socket.id}`);
        delete players[socket.id];
        io.emit('disconnectPlayer', socket.id);
    });
});

const PORT = 3000;
server.listen(PORT, () => {
    console.log(`サーバーが起動しました: http://localhost:${PORT}`);
});
