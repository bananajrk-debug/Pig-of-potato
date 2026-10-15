const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const players = {};

io.on('connection', (socket) => {
    console.log(`プレイヤーが接続しました: ${socket.id}`);

    players[socket.id] = {
        x: 400,
        y: 350,
        coins: 0,
        name: `プレイヤー_${socket.id.substr(0, 4)}`,
        isFishing: false
    };

    socket.emit('currentPlayers', players);
    socket.broadcast.emit('newPlayer', { id: socket.id, player: players[socket.id] });

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            players[socket.id].x = movementData.x;
            players[socket.id].y = movementData.y;
            socket.broadcast.emit('playerMoved', { id: socket.id, x: players[socket.id].x, y: players[socket.id].y });
        }
    });

    // 釣り実行時
    socket.on('fishCaught', () => {
        if (players[socket.id] && players[socket.id].y < 200) {
            const earnedCoins = Math.floor(Math.random() * 50) + 10; // 10〜60イノコイン
            players[socket.id].coins += earnedCoins;
            // 所持金と、今回いくら稼いだかを送信
            socket.emit('fishResult', { coins: players[socket.id].coins, earned: earnedCoins });
        }
    });

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
