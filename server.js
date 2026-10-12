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

// 非常招集ボタン（カフェテリアの中央）
const emergencyButton = { x: 1400, y: 950 };

// 「島（部屋）と橋（通路）」構造の壁データ (マップサイズ: 3000 x 2200)
// 部屋の四方を壁で囲み、出入り口（通路につながる隙間）だけを空けています。
const walls = [
    // --- 【中央島：カフェテリア】 (x: 1100〜1700, y: 700〜1200) ---
    // 上壁（左右に隙間）
    { x: 1100, y: 700, width: 220, height: 25 },
    { x: 1480, y: 700, width: 220, height: 25 },
    // 下壁（左右に隙間）
    { x: 1100, y: 1200, width: 220, height: 25 },
    { x: 1480, y: 1200, width: 220, height: 25 },
    // 左壁（上下に隙間）
    { x: 1100, y: 700, width: 25, height: 180 },
    { x: 1100, y: 1020, width: 25, height: 180 },
    // 右壁（上下に隙間）
    { x: 1675, y: 700, width: 25, height: 180 },
    { x: 1675, y: 1020, width: 25, height: 180 },


    // --- 【左上島：コックピット】 (x: 400〜800, y: 500〜850) ---
    { x: 400, y: 500, width: 400, height: 25 },
    { x: 400, y: 850, width: 160, height: 25 }, // 下壁（右側通路へ隙間）
    { x: 680, y: 850, width: 120, height: 25 },
    { x: 400, y: 500, width: 25, height: 350 },
    { x: 775, y: 500, width: 25, height: 350 },


    // --- 【左下島：エンジンルーム】 (x: 400〜800, y: 1050〜1400) ---
    { x: 400, y: 1050, width: 160, height: 25 }, // 上壁（右側通路へ隙間）
    { x: 680, y: 1050, width: 120, height: 25 },
    { x: 400, y: 1400, width: 400, height: 25 },
    { x: 400, y: 1050, width: 25, height: 350 },
    { x: 775, y: 1050, width: 25, height: 350 },


    // --- 【右上島：ウェポンルーム】 (x: 2000〜2400, y: 500〜850) ---
    { x: 2000, y: 500, width: 400, height: 25 },
    { x: 2000, y: 850, width: 120, height: 25 }, // 下壁（左側通路へ隙間）
    { x: 2240, y: 850, width: 160, height: 25 },
    { x: 2000, y: 500, width: 25, height: 350 },
    { x: 2375, y: 500, width: 25, height: 350 },


    // --- 【右下島：ナビゲーションルーム】 (x: 2000〜2400, y: 1050〜1400) ---
    { x: 2000, y: 1050, width: 120, height: 25 }, // 上壁（左側通路へ隙間）
    { x: 2240, y: 1050, width: 160, height: 25 },
    { x: 2000, y: 1400, width: 400, height: 25 },
    { x: 2000, y: 1050, width: 25, height: 350 },
    { x: 2375, y: 1050, width: 25, height: 350 },


    // --- 【島と島をつなぐ「橋（通路）」の壁】（上下または左右の平行な壁で道を作る） ---
    // カフェテリア左側から左エリアへ延びる通路の壁
    { x: 800, y: 820, width: 300, height: 25 },   // 通路上の壁
    { x: 800, y: 1080, width: 300, height: 25 },  // 通路下の壁

    // カフェテリア右側から右エリアへ延びる通路の壁
    { x: 1700, y: 820, width: 300, height: 25 },  // 通路上の壁
    { x: 1700, y: 1080, width: 300, height: 25 }, // 通路下の壁
];

// 各島の部屋の中に配置されたタスク
let tasks = [
    { id: 1, x: 600, y: 675, name: 'コックピット調整', completed: false },
    { id: 2, x: 600, y: 1225, name: 'エンジン燃料補給', completed: false },
    { id: 3, x: 1400, y: 800, name: 'カフェテリア配線', completed: false },
    { id: 4, x: 1400, y: 1100, name: 'テーブル清掃', completed: false },
    { id: 5, x: 2200, y: 675, name: 'ウェポンシステム確認', completed: false },
    { id: 6, x: 2200, y: 1225, name: 'ナビゲーション設定', completed: false }
];

io.on('connection', (socket) => {
    console.log(`プレイヤー接続: ${socket.id}`);

    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ff6b81'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    players[socket.id] = {
        id: socket.id,
        x: 1400 + Math.random() * 30,
        y: 950 + Math.random() * 30,
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
