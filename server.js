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

// 非常招集ボタン（大部屋：カフェテリアの中央）
const emergencyButton = { x: 1900, y: 1350 };

// 【11個の部屋と通路の壁データ】 (マップサイズ: 4000 x 3000)
// 大部屋1個、中部屋1個、小部屋9個を廊下で網の目のように接続
const walls = [
    // --- 【外周の壁】 ---
    { x: 200, y: 200, width: 3600, height: 30 }, // 上
    { x: 200, y: 2700, width: 3600, height: 30 }, // 下
    { x: 200, y: 200, width: 30, height: 2530 }, // 左
    { x: 3780, y: 200, width: 30, height: 2530 }, // 右

    // ==========================================
    // 1. 【大部屋 1個】 カフェテリア (中央)
    // ==========================================
    { x: 1550, y: 1100, width: 250, height: 25 }, // 上壁左
    { x: 2000, y: 1100, width: 250, height: 25 }, // 上壁右 (中央に出入り口)
    { x: 1550, y: 1600, width: 250, height: 25 }, // 下壁左
    { x: 2000, y: 1600, width: 250, height: 25 }, // 下壁右
    { x: 1550, y: 1100, width: 25, height: 180 },  // 左壁上
    { x: 1550, y: 1420, width: 25, height: 180 },  // 左壁下 (中央に出入り口)
    { x: 2225, y: 1100, width: 25, height: 180 },  // 右壁上
    { x: 2225, y: 1420, width: 25, height: 180 },  // 右壁下

    // ==========================================
    // 2. 【中部屋 1個】 ストレージ (下部中央)
    // ==========================================
    { x: 1650, y: 1950, width: 180, height: 25 }, // 上壁左
    { x: 1970, y: 1950, width: 180, height: 25 }, // 上壁右 (出入り口)
    { x: 1650, y: 2350, width: 500, height: 25 }, // 下壁
    { x: 1650, y: 1950, width: 25, height: 425 },  // 左壁
    { x: 2125, y: 1950, width: 25, height: 425 },  // 右壁

    // ==========================================
    // 3. 【小部屋 9個】
    // ==========================================
    // ① コックピット (左上)
    { x: 500, y: 450, width: 350, height: 25 }, { x: 500, y: 800, width: 350, height: 25 },
    { x: 500, y: 450, width: 25, height: 140 }, { x: 500, y: 685, width: 25, height: 140 }, { x: 825, y: 450, width: 25, height: 375 },

    // ② アッパーエンジン (左中上)
    { x: 500, y: 1000, width: 350, height: 25 }, { x: 500, y: 1350, width: 350, height: 25 },
    { x: 500, y: 1000, width: 25, height: 140 }, { x: 500, y: 1235, width: 25, height: 140 }, { x: 825, y: 1000, width: 25, height: 375 },

    // ③ ロワーエンジン (左下)
    { x: 500, y: 1550, width: 350, height: 25 }, { x: 500, y: 1900, width: 350, height: 25 },
    { x: 500, y: 1550, width: 25, height: 140 }, { x: 500, y: 1785, width: 25, height: 140 }, { x: 825, y: 1550, width: 25, height: 375 },

    // ④ メッドベイ (中左上)
    { x: 1100, y: 650, width: 300, height: 25 }, { x: 1100, y: 950, width: 300, height: 25 },
    { x: 1100, y: 650, width: 25, height: 110 }, { x: 1100, y: 855, width: 25, height: 110 }, { x: 3975 - 2650, y: 650, width: 25, height: 325 }, // 1375

    // ⑤ セキュリティ (中左下)
    { x: 1100, y: 1150, width: 280, height: 25 }, { x: 1100, y: 1450, width: 280, height: 25 },
    { x: 1100, y: 1150, width: 25, height: 110 }, { x: 1100, y: 1355, width: 25, height: 110 }, { x: 1355, y: 1150, width: 25, height: 325 },

    // ⑥ エレクトリカル (中央左下)
    { x: 1100, y: 1750, width: 300, height: 25 }, { x: 1100, y: 2050, width: 300, height: 25 },
    { x: 1100, y: 1750, width: 25, height: 110 }, { x: 1100, y: 1955, width: 25, height: 110 }, { x: 1375, y: 1750, width: 25, height: 325 },

    // ⑦ ウェポン (右上)
    { x: 2450, y: 450, width: 350, height: 25 }, { x: 2450, y: 800, width: 350, height: 25 },
    { x: 2450, y: 450, width: 25, height: 375 }, { x: 2775, y: 450, width: 25, height: 140 }, { x: 2775, y: 685, width: 25, height: 140 },

    // ⑧ ナビゲーション (右中)
    { x: 2850, y: 1100, width: 350, height: 25 }, { x: 2850, y: 1450, width: 350, height: 25 },
    { x: 2850, y: 1100, width: 25, height: 375 }, { x: 3175, y: 1100, width: 25, height: 140 }, { x: 3175, y: 1335, width: 25, height: 140 },

    // ⑨ シールド (右下)
    { x: 2500, y: 1850, width: 350, height: 25 }, { x: 2500, y: 2200, width: 350, height: 25 },
    { x: 2500, y: 1850, width: 25, height: 375 }, { x: 2825, y: 1850, width: 25, height: 140 }, { x: 2825, y: 2085, width: 25, height: 140 },

    // ==========================================
    // 4. 【部屋同士をつなぐ本格的な「廊下（通路）」】
    // ==========================================
    // カフェテリア左側の水平廊下
    { x: 1375, y: 1100, width: 180, height: 25 }, { x: 1375, y: 1225, width: 180, height: 25 },
    // カフェテリア右側の水平廊下
    { x: 2225, y: 1100, width: 635, height: 25 }, { x: 2225, y: 1225, width: 635, height: 25 },
    // コックピット〜メッドベイ間の廊下
    { x: 825, y: 650, width: 280, height: 25 }, { x: 825, y: 775, width: 280, height: 25 },
    // メッドベイ〜カフェテリアへの縦廊下
    { x: 1375, y: 950, width: 25, height: 160 }, { x: 1500, y: 950, width: 25, height: 160 },
    // エレクトリカル〜ストレージ間の廊下
    { x: 1375, y: 1950, width: 295, height: 25 }, { x: 1375, y: 2075, width: 295, height: 25 },
    // ストレージ〜シールド間の廊下
    { x: 2125, y: 2050, width: 385, height: 25 }, { x: 2125, y: 2175, width: 385, height: 25 },
];

// 各部屋に対応するタスク (11個)
let tasks = [
    { id: 1, x: 675, y: 625, name: 'コックピット調整', completed: false },
    { id: 2, x: 675, y: 1175, name: 'アッパーエンジン点検', completed: false },
    { id: 3, x: 675, y: 1725, name: 'ロワーエンジン点検', completed: false },
    { id: 4, x: 1250, y: 800, name: 'メッドベイ診断', completed: false },
    { id: 5, x: 1250, y: 1300, name: 'セキュリティ確認', completed: false },
    { id: 6, x: 1250, y: 1900, name: 'エレクトリカル修理', completed: false },
    { id: 7, x: 1900, y: 1350, name: 'カフェテリア配線', completed: false },
    { id: 8, x: 1900, y: 2150, name: 'ストレージ燃料補給', completed: false },
    { id: 9, x: 2600, y: 625, name: 'ウェポンシステム確認', completed: false },
    { id: 10, x: 3000, y: 1275, name: 'ナビゲーション設定', completed: false },
    { id: 11, x: 2650, y: 2025, name: 'シールド充填', completed: false }
];

io.on('connection', (socket) => {
    console.log(`プレイヤー接続: ${socket.id}`);

    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ff6b81'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    players[socket.id] = {
        id: socket.id,
        x: 1900 + Math.random() * 30,
        y: 1350 + Math.random() * 30,
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
