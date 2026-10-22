const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// staticフォルダの設定
app.use(express.static(__dirname));

io.on('connection', (socket) => {
    console.log('プレイヤーが接続しました:', socket.id);

    socket.on('disconnect', () => {
        console.log('プレイヤーが切断しました:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
