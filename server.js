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

// 非常招集ボタン（大部屋：カフェテリア中央）
const emergencyButton = { x: 2000, y: 1300 };

// 【11部屋（大1、中1、小9）と90度通路の壁データ】 (マップサイズ: 4000 x 3000)
const walls = [
    // --- 【外周の壁】 ---
    { x: 200, y: 200, width: 3600, height: 30 }, // 上
    { x: 200, y: 2800, width: 3600, height: 30 }, // 下
    { x: 200, y: 200, width: 30, height: 2630 }, // 左
    { x: 3800, y: 200, width: 30, height: 2630 }, // 右

    // ==========================================
    // 1. 【大部屋】 カフェテリア (中央: x1700〜2300, y1100〜1500)
    // ==========================================
    { x: 1700, y: 1100, width: 250, height: 25 }, // 上壁左
    { x: 2050, y: 1100, width: 250, height: 25 }, // 上壁右 (出入り口)
    { x: 1700, y: 1500, width: 250, height: 25 }, // 下壁左
    { x: 2050, y: 1500, width: 250, height: 25 }, // 下壁右 (出入り口)
    { x: 1700, y: 1100, width: 25, height: 160 },  // 左壁上
    { x: 1700, y: 1340, width: 25, height: 160 },  // 左壁下 (出入り口)
    { x: 2275, y: 1100, width: 25, height: 160 },  // 右壁上
    { x: 2275, y: 1340, width: 25, height: 160 },  // 右壁下 (出入り口)

    // ==========================================
    // 2. 【中部屋】 ストレージ (下部: x1750〜2250, y1900〜2300)
    // ==========================================
    { x: 1750, y: 1900, width: 180, height: 25 }, // 上壁左
    { x: 2070, y: 1900, width: 180, height: 25 }, // 上壁右 (出入り口)
    { x: 1750, y: 2300, width: 500, height: 25 }, // 下壁
    { x: 1750, y: 1900, width: 25, height: 415 },  // 左壁
    { x: 2225, y: 1900, width: 25, height: 415 },  // 右壁

    // ==========================================
    // 3. 【小部屋 9個】 （バラバラに配置）
    // ==========================================
    // ① コックピット (左上)
    { x: 450, y: 400, width: 300, height: 25 }, { x: 450, y: 750, width: 300, height: 25 },
    { x: 450, y: 400, width: 25, height: 130 }, { x: 450, y: 620, width: 25, height: 130 }, { x: 725, y: 400, width: 25, height: 365 },

    // ② アッパーエンジン (左中)
    { x: 400, y: 1050, width: 300, height: 25 }, { x: 400, y: 1400, width: 300, height: 25 },
    { x: 400, y: 1050, width: 25, height: 130 }, { x: 400, y: 1270, width: 25, height: 130 }, { x: 675, y: 1050, width: 25, height: 365 },

    // ③ ロワーエンジン (左下)
    { x: 500, y: 1850, width: 300, height: 25 }, { x: 500, y: 2200, width: 300, height: 25 },
    { x: 500, y: 1850, width: 25, height: 130 }, { x: 500, y: 2070, width: 25, height: 130 }, { x: 775, y: 1850, width: 25, height: 365 },

    // ④ メッドベイ (中左上)
    { x: 1100, y: 550, width: 300, height: 25 }, { x: 1100, y: 900, width: 300, height: 25 },
    { x: 1100, y: 550, width: 25, height: 130 }, { x: 1100, y: 770, width: 25, height: 130 }, { x: 1375, y: 550, width: 25, height: 365 },

    // ⑤ セキュリティ (中左下)
    { x: 1100, y: 1700, width: 300, height: 25 }, { x: 1100, y: 2050, width: 300, height: 25 },
    { x: 1100, y: 1700, width: 25, height: 130 }, { x: 1100, y: 1920, width: 25, height: 130 }, { x: 1375, y: 1700, width: 25, height: 365 },

    // ⑥ エレクトリカル (中央左)
    { x: 1250, y: 1150, width: 250, height: 25 }, { x: 1250, y: 1450, width: 250, height: 25 },
    { x: 1250, y: 1150, width: 25, height: 110 }, { x: 1250, y: 1335, width: 25, height: 110 }, { x: 1475, y: 1150, width: 25, height: 315 },

    // ⑦ ウェポン (右上)
    { x: 2800, y: 400, width: 300, height: 25 }, { x: 2800, y: 750, width: 300, height: 25 },
    { x: 2800, y: 400, width: 25, height: 130 }, { x: 2800, y: 620, width: 25, height: 130 }, { x: 3075, y: 400, width: 25, height: 365 },

    // ⑧ ナビゲーション (右中)
    { x: 3050, y: 1100, width: 300, height: 25 }, { x: 3050, y: 1450, width: 300, height: 25 },
    { x: 3050, y: 1100, width: 25, height: 130 }, { x: 3050, y: 1320, width: 25, height: 130 }, { x: 3325, y: 1100, width: 25, height: 365 },

    // ⑨ シールド (右下)
    { x: 2750, y: 1950, width: 300, height: 25 }, { x: 2750, y: 2300, width: 300, height: 25 },
    { x: 2750, y: 1950, width: 25, height: 130 }, { x: 2750, y: 2170, width: 25, height: 130 }, { x: 3025, y: 1950, width: 25, height: 365 },

    // ==========================================
    // 4. 【90度に曲がる本格的な廊下（通路）ネットワーク】
    // ==========================================
    // カフェテリア左 ⇔ エレクトリカル
    { x: 1475, y: 1150, width: 225, height: 25 }, { x: 1475, y: 1275, width: 225, height: 25 },
    // カフェテリア右 ⇔ ナビゲーション（L字に90度曲がる通路）
    { x: 2275, y: 1150, width: 775, height: 25 }, { x: 2275, y: 1275, width: 550, height: 25 },
    { x: 2800, y: 1275, width: 25, height: 185 },  // 90度縦通路
    { x: 2925, y: 1275, width: 25, height: 185 },  // 90度縦通路の反対側

    // カフェテリア上 ⇔ メッドベイ（L字曲がり）
    { x: 2050, y: 850, width: 25, height: 250 },  
    { x: 2175, y: 850, width: 25, height: 250 },  
    { x: 1375, y: 850, width: 700, height: 25 }, 
    { x: 1375, y: 975, width: 700, height: 25 }, 

    // カフェテリア下 ⇔ ストレージ
    { x: 2050, y: 1500, width: 25, height: 400 },  
    { x: 2175, y: 1500, width: 25, height: 400 },  

    // コックピット ⇔ メッドベイ (水平通路)
    { x: 725, y: 650, width: 375, height: 25 }, { x: 725, y: 775, width: 375, height: 25 },

    // アッパーエンジン ⇔ エレクトリカル (L字曲がり)
    { x: 675, y: 1250, width: 575, height: 25 }, { x: 675, y: 1375, width: 450, height: 25 },

    // ロワーエンジン ⇔ セキュリティ (L字曲がり)
    { x: 775, y: 1950, width: 325, height: 25 }, { x: 775, y: 2075, width: 325, height: 25 },
    { x: 1100, y: 1450, width: 25, height: 525 }, { x: 1225, y: 1450, width: 25, height: 650 },

    // ストレージ ⇔ シールド (水平通路)
    { x: 2225, y: 2050, width: 525, height: 25 }, { x: 2225, y: 2175, width: 525, height: 25 },

    // ウェポン ⇔ ナビゲーション (縦通路)
    { x: 3075, y: 750, width: 25, height: 350 }, { x: 3200, y: 750, width: 25, height: 350 },
];

// 11個の部屋に対応するタスク
let tasks = [
    { id: 1, x: 575, y: 575, name: 'コックピット調整', completed: false },
    { id: 2, x: 525, y: 1225, name: 'アッパーエンジン点検', completed: false },
    { id: 3, x: 625, y: 2025, name: 'ロワーエンジン点検', completed: false },
    { id: 4, x: 1225, y: 725, name: 'メッドベイ診断', completed: false },
    { id: 5, x: 1225, y: 1875, name: 'セキュリティ確認', completed: false },
    { id: 6, x: 1350, y: 1300, name: 'エレクトリカル修理', completed: false },
    { id: 7, x: 2000, y: 1300, name: 'カフェテリア配線', completed: false },
    { id: 8, x: 2000, y: 2100, name: 'ストレージ燃料補給', completed: false },
    { id: 9, x: 2925, y: 575, name: 'ウェポンシステム確認', completed: false },
    { id: 10, x: 3175, y: 1275, name: 'ナビゲーション設定', completed: false },
    { id: 11, x: 2875, y: 2125, name: 'シールド充填', completed: false }
];

io.on('connection', (socket) => {
    console.log(`プレイヤー接続: ${socket.id}`);

    const colors = ['#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#ff6b81'];
    const randomColor = colors[Math.floor(Math.random() * colors.length)];
    
    players[socket.id] = {
        id: socket.id,
        x: 2000 + Math.random() * 30,
        y: 1300 + Math.random() * 30,
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
