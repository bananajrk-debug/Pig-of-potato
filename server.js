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

// カフェテリアの中心にある非常招集ボタン
const emergencyButton = { x: 1200, y: 500 };

// Skeld風の複雑なマップ壁データ (マップサイズ: 2400 x 2000)
const walls = [
    // --- 外枠 ---
    { x: 100, y: 100, width: 2200, height: 30 }, // 上壁
    { x: 100, y: 1800, width: 2200, height: 30 }, // 下壁
    { x: 100, y: 100, width: 30, height: 1730 }, // 左壁
    { x: 2270, y: 100, width: 30, height: 1730 }, // 右壁

    // --- カフェテリア周辺 (中央) ---
    { x: 900, y: 300, width: 600, height: 30 },
    { x: 900, y: 700, width: 600, height: 30 },
    { x: 900, y: 300, width: 30, height: 150 },
    { x: 1470, y: 300, width: 30, height: 150 },
    { x: 900, y: 600, width: 30, height: 100 },
    { x: 1470, y: 600, width: 30, height: 100 },

    // --- アッパーエンジン & ロワーエンジン & リアクター (左側) ---
    { x: 200, y: 400, width: 400, height: 30 },
    { x: 200, y: 850, width: 400, height: 30 },
    { x: 570, y: 400, width: 30, height: 480 },
    { x: 200, y: 1100, width: 400, height: 30 },
    { x: 200, y: 1550, width: 400, height: 30 },
    { x: 570, y: 1100, width: 30, height: 480 },
    { x: 100, y: 800, width: 150, height: 30 },
    { x: 100, y: 1150, width: 150, height: 30 },
    { x: 220, y: 800, width: 30, height: 380 },

    // --- メッドベイ & セキュリティ & エレクトリカル (中央左) ---
    { x: 650, y: 750, width: 200, height: 30 },
    { x: 650, y: 1150, width: 200, height: 30 },
    { x: 650, y: 750, width: 30, height: 430 },
    { x: 820, y: 900, width: 30, height: 150 },
    { x: 650, y: 1350, width: 300, height: 30 },
    { x: 920, y: 1200, width: 30, height: 180 },

    // --- ストレージ & コミュニケーション (下部) ---
    { x: 1000, y: 1450, width: 500, height: 30 },
    { x: 1000, y: 1770, width: 500, height: 30 },
    { x: 1000, y: 1450, width: 30, height: 350 },
    { x: 1500, y: 1450, width: 30, height: 350 },
    { x: 1300, y: 1200, width: 250, height: 30 },
    { x: 1550, y: 1200, width: 30, height: 280 },

    // --- アドミン & O2 & シールド (中央右・下右) ---
    { x: 1600, y: 750, width: 300, height: 30 },
    { x: 1600, y: 1100, width: 300, height: 30 },
    { x: 1600, y: 750, width: 30, height: 380 },
    { x: 1870, y: 750, width: 30, height: 380 },
    { x: 1700, y: 1300, width: 300, height: 30 },
    { x: 1700, y: 1650, width: 300, height: 30 },
    { x: 1700, y: 1300, width: 30, height: 380 },
    { x: 1970, y: 1300, width: 30, height: 380 },

    // --- ウェポン & ナビゲーション (右側) ---
    { x: 1950, y: 300, width: 300, height: 30 },
    { x: 1950, y: 700, width: 300, height: 30 },
    { x: 1950, y: 300, width: 30, height: 430 },
    { x: 2000, y: 900, width: 270, height: 30 },
    { x: 2000, y: 1300, width: 270, height: 30 },
    { x: 2000, y: 900, width: 30, height: 430 }
];

// マップ各所に配置されたタスク
let tasks = [
    { id: 1, x: 300, y: 450, name: 'エンジン配線', completed: false },
    { id: 2, x: 250, y: 1400, name: '燃料補給', completed: false },
    { id: 3, x: 150, y: 950, name: 'リアクター起動', completed: false },
    { id: 4, x: 750, y: 800, name: 'メッドベイ診断', completed: false },
    { id: 5, x: 750, y: 1250, name: 'エレクトロニクス修理', completed: false },
    { id: 6, x: 1200, y: 400, name: 'カフェテリア清掃', completed: false },
    { id: 7, x: 1250, y: 1600, name: 'ストレージ整理', completed: false },
    { id: 8, x: 1750, y: 900, name: 'アドミンデータ入力', completed: false },
    { id: 9, x: 2100, y: 500, name: 'ウェポン調整', completed: false },
    { id: 10, x: 2150, y: 1100, name: 'ナビゲーション設定', completed: false },
    { id: 11, x: 1850, y: 1450, name: 'シールド充填', completed: false }
];

io.on('connection', (socket) => {
    console.log(`プレイヤー接続: ${socket.id}`);

    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ff9ff3'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    players[socket.id] = {
        id: socket.id,
        x: 1200 + Math.random() * 50,
        y: 600 + Math.random() * 50,
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
