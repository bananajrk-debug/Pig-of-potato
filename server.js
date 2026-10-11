const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// ゲームの状態管理
let gameState = 'PLAYING'; // 'PLAYING' or 'MEETING'
let players = {}; // 各プレイヤーの情報
let bodies = [];  // 発生した死体のリスト [{ x, y, name, color }]
let meetingTimer = null;
let votes = {};   // 投票データ { socketId: targetSocketId or 'skip' }

// 非常招集ボタンの位置（マップの中心付近）
const emergencyButton = { x: 1000, y: 1000 };

// マップの壁データ（簡易的な障害物）
const walls = [
    { x: 400, y: 200, width: 200, height: 50 },
    { x: 800, y: 500, width: 100, height: 300 },
    { x: 200, y: 800, width: 300, height: 100 }
];

io.on('connection', (socket) => {
    console.log(`プレイヤー接続: ${socket.id}`);

    // 初期プレイヤーデータの作成
    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    players[socket.id] = {
        id: socket.id,
        x: 300 + Math.random() * 100,
        y: 300 + Math.random() * 100,
        role: Object.keys(players).length === 0 ? 'wolf' : 'crew', // 最初の人を人狼に（テスト用）
        isDead: false,
        color: randomColor,
        name: 'Crew_' + socket.id.substr(0, 4),
        tasksCompleted: 0
    };

    // クライアントへ初期情報送信
    socket.emit('init', { id: socket.id, players, walls, emergencyButton });

    // プレイヤーの移動処理
    socket.on('playerMove', (data) => {
        if (gameState !== 'PLAYING') return;
        const player = players[socket.id];
        if (!player || player.isDead) return;

        player.x = data.x;
        player.y = data.y;
    });

    // 人狼によるキル処理
    socket.on('killPlayer', (targetId) => {
        if (gameState !== 'PLAYING') return;
        const killer = players[socket.id];
        const target = players[targetId];

        if (!killer || killer.role !== 'wolf' || killer.isDead) return;
        if (!target || target.isDead) return;

        // 距離チェック（近くにいるか）
        const dist = Math.hypot(killer.x - target.x, killer.y - target.y);
        if (dist < 80) {
            target.isDead = true;
            // 死体を生成
            bodies.push({
                x: target.x,
                y: target.y,
                name: target.name,
                color: target.color
            });
            io.emit('updateGameState', { players, bodies });
            checkWinCondition();
        }
    });

    // 死体通報 (Rキー)
    socket.on('reportBody', () => {
        if (gameState !== 'PLAYING') return;
        const player = players[socket.id];
        if (!player || player.isDead) return;

        // 死体の近くにいるかチェック (120px以内)または死体が存在すれば通報可能
        const nearBody = bodies.find(body => Math.hypot(body.x - player.x, body.y - player.y) < 150);
        if (nearBody || bodies.length > 0) {
            startMeeting('body', player.name);
        }
    });

    // 非常招集ボタンの使用
    socket.on('emergencyMeeting', () => {
        if (gameState !== 'PLAYING') return;
        const player = players[socket.id];
        if (!player || player.isDead) return;

        const dist = Math.hypot(emergencyButton.x - player.x, emergencyButton.y - player.y);
        if (dist < 80) {
            startMeeting('emergency', player.name);
        }
    });

    // チャットメッセージ
    socket.on('chatMessage', (msg) => {
        if (gameState !== 'MEETING') return;
        const player = players[socket.id];
        if (!player) return;

        io.emit('chatMessage', {
            name: player.name,
            text: msg,
            isDead: player.isDead
        });
    });

    // 投票処理
    socket.on('vote', (targetId) => {
        if (gameState !== 'MEETING') return;
        const player = players[socket.id];
        if (!player || player.isDead) return;

        votes[socket.id] = targetId;

        // 全生存者が投票したかチェック
        const activePlayers = Object.values(players).filter(p => !p.isDead);
        if (Object.keys(votes).length >= activePlayers.length) {
            clearTimeout(meetingTimer);
            endMeeting();
        }
    });

    // 切断時
    socket.on('disconnect', () => {
        console.log(`プレイヤー切断: ${socket.id}`);
        delete players[socket.id];
        delete votes[socket.id];
        io.emit('updateGameState', { players, bodies });
        checkWinCondition();
    });
});

// 会議開始関数
function startMeeting(reason, reporterName) {
    gameState = 'MEETING';
    votes = {};
    io.emit('startMeeting', { reason, reporterName });

    // 45秒後に自動終了
    meetingTimer = setTimeout(() => {
        endMeeting();
    }, 45000);
}

// 会議終了・投票集計関数
function endMeeting() {
    if (gameState !== 'MEETING') return;

    const tally = {};
    Object.values(votes).forEach(targetId => {
        if (targetId && targetId !== 'skip') {
            tally[targetId] = (tally[targetId] || 0) + 1;
        }
    });

    let exiledId = null;
    let maxVotes = 0;
    let isTie = false;

    for (const [id, count] of Object.entries(tally)) {
        if (count > maxVotes) {
            maxVotes = count;
            exiledId = id;
            isTie = false;
        } else if (count === maxVotes) {
            isTie = true;
        }
    }

    let exiledName = null;
    if (exiledId && !isTie && players[exiledId]) {
        players[exiledId].isDead = true;
        exiledName = players[exiledId].name;
    }

    gameState = 'PLAYING';
    votes = {};
    bodies = []; // 会議が終わったら死体は消去

    io.emit('endMeeting', { exiledName, players });
    checkWinCondition();
}

// 勝敗判定
function checkWinCondition() {
    const activePlayers = Object.values(players).filter(p => !p.isDead);
    const activeWolves = activePlayers.filter(p => p.role === 'wolf');
    const activeCrew = activePlayers.filter(p => p.role === 'crew');

    if (activeWolves.length === 0) {
        io.emit('gameOver', { winner: 'crew', message: '市民の勝利！人狼をすべて排除しました。' });
    } else if (activeWolves.length >= activeCrew.length) {
        io.emit('gameOver', { winner: 'wolf', message: '人狼の勝利！市民が人狼の数と同数以下になりました。' });
    }
}

// 定期的なゲーム状態ブロードキャスト (30fps相当)
setInterval(() => {
    if (gameState === 'PLAYING') {
        io.emit('gameStateUpdate', { players, bodies });
    }
}, 33);

server.listen(3000, () => {
    console.log('サーバーが起動しました: http://localhost:3000');
});
