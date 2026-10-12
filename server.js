const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let gameState = 'PLAYING';
let players = {};
let bodies = [];
let meetingTimer = null;
let votes = {};

// 非常招集ボタン（カフェテリア中央）
const emergencyButton = { x: 1200, y: 400 };

// 部屋と通路をしっかりとつないだSkeld風のレイアウト（壁データ）
const walls = [
    // --- 外周の壁 ---
    { x: 200, y: 100, width: 2000, height: 30 }, // 上
    { x: 200, y: 1700, width: 2000, height: 30 }, // 下
    { x: 200, y: 100, width: 30, height: 1630 }, // 左
    { x: 2200, y: 100, width: 30, height: 1630 }, // 右

    // --- カフェテリア（中央上・広場）の壁 ---
    { x: 900, y: 250, width: 600, height: 30 },
    { x: 900, y: 650, width: 600, height: 30 },
    { x: 900, y: 250, width: 30, height: 120 },
    { x: 1470, y: 250, width: 30, height: 120 },
    { x: 900, y: 530, width: 30, height: 120 },
    { x: 1470, y: 530, width: 30, height: 120 },

    // --- 左側エリア（リアクター、エンジン） ---
    // リアクター
    { x: 300, y: 700, width: 250, height: 30 },
    { x: 300, y: 1100, width: 250, height: 30 },
    { x: 300, y: 700, width: 30, height: 430 },
    // アッパーエンジン
    { x: 600, y: 350, width: 250, height: 30 },
    { x: 600, y: 700, width: 250, height: 30 },
    { x: 600, y: 350, width: 30, height: 380 },
    // ロワーエンジン
    { x: 600, y: 1100, width: 250, height: 30 },
    { x: 600, y: 1450, width: 250, height: 30 },
    { x: 600, y: 1100, width: 30, height: 380 },

    // --- 中央エリア（メッドベイ、セキュリティ、エレクトリカル） ---
    { x: 950, y: 750, width: 200, height: 30 },
    { x: 950, y: 1100, width: 200, height: 30 },
    { x: 950, y: 750, width: 30, height: 380 },
    { x: 1250, y: 900, width: 250, height: 30 },
    { x: 1250, y: 1300, width: 250, height: 30 },
    { x: 1250, y: 900, width: 30, height: 430 },

    // --- 下部エリア（ストレージ、コミニュケーション） ---
    { x: 950, y: 1400, width: 400, height: 30 },
    { x: 950, y: 1700, width: 400, height: 30 }, // 下壁に接続
    { x: 1550, y: 1350, width: 300, height: 30 },
    { x: 1550, y: 1650, width: 300, height: 30 },
    { x: 1550, y: 1350, width: 30, height: 330 },

    // --- 右側エリア（アドミン、O2、シールド、ウェポン、ナビゲーション） ---
    { x: 1650, y: 700, width: 250, height: 30 },
    { x: 1650, y: 1100, width: 250, height: 30 },
    { x: 1650, y: 700, width: 30, height: 430 },
    { x: 1950, y: 350, width: 200, height: 30 },
    { x: 1950, y: 750, width: 200, height: 30 },
    { x: 1950, y: 350, width: 30, height: 430 },
    { x: 1950, y: 1050, width: 200, height: 30 },
    { x: 1950, y: 1450, width: 200, height: 30 },
    { x: 1950, y: 1050, width: 30, height: 430 }
];

// マップ各所のタスク
let tasks = [
    { id: 1, x: 350, y: 900, name: 'リアクター調整', completed: false },
    { id: 2, x: 700, y: 500, name: 'アッパーエンジン点検', completed: false },
    { id: 3, x: 700, y: 1300, name: 'ロワーエンジン点検', completed: false },
    { id: 4, x: 1200, y: 350, name: 'カフェテリア配線', completed: false },
    { id: 5, x: 1050, y: 900, name: 'メッドベイ診断', completed: false },
    { id: 6, x: 1350, y: 1100, name: 'エレクトリカル修理', completed: false },
    { id: 7, x: 1100, y: 1550, name: 'ストレージ燃料補給', completed: false },
    { id: 8, x: 1750, y: 900, name: 'アドミンデータ入力', completed: false },
    { id: 9, x: 2050, y: 550, name: 'ウェポンシステム調整', completed: false },
    { id: 10, x: 2050, y: 1250, name: 'ナビゲーション設定', completed: false }
];

io.on('connection', (socket) => {
    console.log(`プレイヤー接続: ${socket.id}`);

    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ff6b81'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    players[socket.id] = {
        id: socket.id,
        x: 1200 + Math.random() * 40,
        y: 500 + Math.random() * 40,
        role: Object.keys(players).length === 1 ? 'wolf' : 'crew',
        isDead: false,
        color: randomColor,
        name: 'クルー_' + socket.id.substr(0, 3),
        taskProgress: 0
    };

    socket.emit('init', { id: socket.id, players, walls, emergencyButton, tasks });

    socket.on('playerMove', (data) => {
        if (gameState !== 'PLAYING') return;
        const player = players[socket.id];
        if (!player || player.isDead) return;
        player.x = data.x;
        player.y = data.y;
    });

    socket.on('completeTask', (taskId) => {
        if (gameState !== 'PLAYING') return;
        const player = players[socket.id];
        if (!player || player.isDead || player.role === 'wolf') return;

        const task = tasks.find(t => t.id === taskId);
        if (task && !task.completed) {
            if (Math.hypot(player.x - task.x, player.y - task.y) < 80) {
                task.completed = true;
                player.taskProgress += 1;
                io.emit('updateTasks', tasks);
                checkCrewWinCondition();
            }
        }
    });

    socket.on('killPlayer', (targetId) => {
        if (gameState !== 'PLAYING') return;
        const killer = players[socket.id];
        const target = players[targetId];

        if (!killer || killer.role !== 'wolf' || killer.isDead) return;
        if (!target || target.isDead) return;

        if (Math.hypot(killer.x - target.x, killer.y - target.y) < 80) {
            target.isDead = true;
            bodies.push({ x: target.x, y: target.y, name: target.name, color: target.color });
            io.emit('updateGameState', { players, bodies });
            checkWinCondition();
        }
    });

    socket.on('reportBody', () => {
        if (gameState !== 'PLAYING') return;
        const player = players[socket.id];
        if (!player || player.isDead) return;
        if (bodies.length > 0) startMeeting('body', player.name);
    });

    socket.on('emergencyMeeting', () => {
        if (gameState !== 'PLAYING') return;
        const player = players[socket.id];
        if (!player || player.isDead) return;
        if (Math.hypot(emergencyButton.x - player.x, emergencyButton.y - player.y) < 80) {
            startMeeting('emergency', player.name);
        }
    });

    socket.on('chatMessage', (msg) => {
        if (gameState !== 'MEETING') return;
        const player = players[socket.id];
        if (!player) return;
        io.emit('chatMessage', { name: player.name, text: msg, isDead: player.isDead });
    });

    socket.on('vote', (targetId) => {
        if (gameState !== 'MEETING') return;
        const player = players[socket.id];
        if (!player || player.isDead) return;
        votes[socket.id] = targetId;

        const activePlayers = Object.values(players).filter(p => !p.isDead);
        if (Object.keys(votes).length >= activePlayers.length) {
            clearTimeout(meetingTimer);
            endMeeting();
        }
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
        delete votes[socket.id];
        io.emit('updateGameState', { players, bodies });
        checkWinCondition();
    });
});

function startMeeting(reason, reporterName) {
    gameState = 'MEETING';
    votes = {};
    io.emit('startMeeting', { reason, reporterName });
    meetingTimer = setTimeout(() => { endMeeting(); }, 45000);
}

function endMeeting() {
    if (gameState !== 'MEETING') return;
    const tally = {};
    Object.values(votes).forEach(targetId => {
        if (targetId && targetId !== 'skip') tally[targetId] = (tally[targetId] || 0) + 1;
    });

    let exiledId = null, maxVotes = 0, isTie = false;
    for (const [id, count] of Object.entries(tally)) {
        if (count > maxVotes) { maxVotes = count; exiledId = id; isTie = false; }
        else if (count === maxVotes) { isTie = true; }
    }

    let exiledName = null;
    if (exiledId && !isTie && players[exiledId]) {
        players[exiledId].isDead = true;
        exiledName = players[exiledId].name;
    }

    gameState = 'PLAYING';
    votes = {};
    bodies = [];
    io.emit('endMeeting', { exiledName, players });
    checkWinCondition();
}

function checkCrewWinCondition() {
    const allCompleted = tasks.every(t => t.completed);
    if (allCompleted) {
        io.emit('gameOver', { winner: 'crew', message: '市民の勝利！すべてのタスクが完了しました！' });
    }
}

function checkWinCondition() {
    const activePlayers = Object.values(players).filter(p => !p.isDead);
    const activeWolves = activePlayers.filter(p => p.role === 'wolf');
    const activeCrew = activePlayers.filter(p => p.role === 'crew');

    if (activeWolves.length === 0) {
        io.emit('gameOver', { winner: 'crew', message: '市民の勝利！人狼が全員追放されました！' });
    } else if (activeWolves.length >= activeCrew.length) {
        io.emit('gameOver', { winner: 'wolf', message: '人狼の勝利！市民の数が人狼と同数以下になりました！' });
    }
}

setInterval(() => {
    if (gameState === 'PLAYING') io.emit('gameStateUpdate', { players, bodies });
}, 33);

server.listen(3000, () => {
    console.log('サーバー起動: http://localhost:3000');
});
