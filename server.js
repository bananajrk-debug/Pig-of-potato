const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let gameState = 'PLAYING';
let players = {};
let bodies = {};
let meetingTimer = null;
let votes = {};

// 非常招集ボタン（大部屋：カフェテリア中央）
const emergencyButton = { x: 2000, y: 1300 };

// 【11部屋と、正確につながる90度通路の壁データ】 (マップサイズ: 4000 x 3000)
// すべての部屋のドア位置と廊下の端がぴったり一致するように設計しています。
const walls = [
    // --- 【外周の壁】 ---
    { x: 200, y: 200, width: 3600, height: 30 }, // 上
    { x: 200, y: 2800, width: 3600, height: 30 }, // 下
    { x: 200, y: 200, width: 30, height: 2630 }, // 左
    { x: 3800, y: 200, width: 30, height: 2630 }, // 右

    // ==========================================
    // 1. 【大部屋】 カフェテリア (中央: x1700〜2300, y1100〜1500)
    // ==========================================
    { x: 1700, y: 1100, width: 280, height: 25 }, // 上壁左
    { x: 2120, y: 1100, width: 180, height: 25 }, // 上壁右 (上通路へ接続)
    { x: 1700, y: 1500, width: 280, height: 25 }, // 下壁左
    { x: 2120, y: 1500, width: 180, height: 25 }, // 下壁右 (下通路へ接続)
    { x: 1700, y: 1100, width: 25, height: 160 },  // 左壁上
    { x: 1700, y: 1340, width: 25, height: 160 },  // 左壁下 (左通路へ接続)
    { x: 2275, y: 1100, width: 25, height: 160 },  // 右壁上
    { x: 2275, y: 1340, width: 25, height: 160 },  // 右壁下 (右通路へ接続)

    // ==========================================
    // 2. 【中部屋】 ストレージ (下部中央: x1750〜2250, y1950〜2350)
    // ==========================================
    { x: 1750, y: 1950, width: 170, height: 25 }, // 上壁左
    { x: 2080, y: 1950, width: 170, height: 25 }, // 上壁右 (上通路へ接続)
    { x: 1750, y: 2350, width: 500, height: 25 }, // 下壁
    { x: 1750, y: 1950, width: 25, height: 415 },  // 左壁
    { x: 2225, y: 1950, width: 25, height: 415 },  // 右壁

    // ==========================================
    // 3. 【小部屋 9個】
    // ==========================================
    // ① コックピット (左上)
    { x: 450, y: 400, width: 300, height: 25 }, { x: 450, y: 750, width: 300, height: 25 },
    { x: 450, y: 400, width: 25, height: 350 }, { x: 725, y: 400, width: 25, height: 140 }, { x: 725, y: 610, width: 25, height: 140 }, // 右側に出入り口

    // ② アッパーエンジン (左中)
    { x: 400, y: 1000, width: 300, height: 25 }, { x: 400, y: 1350, width: 300, height: 25 },
    { x: 400, y: 1000, width: 25, height: 350 }, { x: 675, y: 1000, width: 25, height: 140 }, { x: 675, y: 1210, width: 25, height: 140 }, // 右側に出入り口

    // ③ ロワーエンジン (左下)
    { x: 500, y: 1800, width: 300, height: 25 }, { x: 500, y: 2150, width: 300, height: 25 },
    { x: 500, y: 1800, width: 25, height: 350 }, { x: 775, y: 1800, width: 25, height: 140 }, { x: 775, y: 2010, width: 25, height: 140 }, // 右側に出入り口

    // ④ メッドベイ (中左上)
    { x: 1050, y: 500, width: 300, height: 25 }, { x: 1050, y: 850, width: 300, height: 25 },
    { x: 1050, y: 500, width: 25, height: 140 }, { x: 1050, y: 710, width: 25, height: 140 }, { x: 1325, y: 500, width: 25, height: 350 }, // 左側に出入り口

    // ⑤ セキュリティ (中左下)
    { x: 1050, y: 1650, width: 300, height: 25 }, { x: 1050, y: 2000, width: 300, height: 25 },
    { x: 1050, y: 1650, width: 25, height: 140 }, { x: 1050, y: 1860, width: 25, height: 140 }, { x: 1325, y: 1650, width: 25, height: 350 }, // 左側に出入り口

    // ⑥ エレクトリカル (中央左)
    { x: 1200, y: 1100, width: 250, height: 25 }, { x: 1200, y: 1450, width: 250, height: 25 },
    { x: 1200, y: 1100, width: 25, height: 130 }, { x: 1200, y: 1295, width: 25, height: 130 }, { x: 1425, y: 1100, width: 25, height: 350 }, // 左側に出入り口

    // ⑦ ウェポン (右上)
    { x: 2800, y: 400, width: 300, height: 25 }, { x: 2800, y: 750, width: 300, height: 25 },
    { x: 2800, y: 400, width: 25, height: 140 }, { x: 2800, y: 610, width: 25, height: 140 }, { x: 3075, y: 400, width: 25, height: 350 }, // 右側に出入り口

    // ⑧ ナビゲーション (右中)
    { x: 3050, y: 1050, width: 300, height: 25 }, { x: 3050, y: 1400, width: 300, height: 25 },
    { x: 3050, y: 1050, width: 25, height: 140 }, { x: 3050, y: 1260, width: 25, height: 140 }, { x: 3325, y: 1050, width: 25, height: 350 }, // 右側に出入り口

    // ⑨ シールド (右下)
    { x: 2750, y: 1900, width: 300, height: 25 }, { x: 2750, y: 2250, width: 300, height: 25 },
    { x: 2750, y: 1900, width: 25, height: 140 }, { x: 2750, y: 2110, width: 25, height: 140 }, { x: 3025, y: 1900, width: 25, height: 350 }, // 右側に出入り口

    // ==========================================
    // 4. 【完全に接続された90度直角の廊下ネットワーク】
    // ==========================================
    // カフェテリア左 ⇔ エレクトリカル (水平通路)
    { x: 1425, y: 1240, width: 295, height: 25 }, { x: 1425, y: 1360, width: 295, height: 25 },

    // カフェテリア右 ⇔ ナビゲーション (水平通路)
    { x: 2275, y: 1240, width: 795, height: 25 }, { x: 2275, y: 1360, width: 795, height: 25 },

    // カフェテリア上 ⇔ メッドベイ (L字通路)
    { x: 2000, y: 720, width: 25, height: 405 }, { x: 2120, y: 720, width: 25, height: 405 },
    { x: 1325, y: 720, width: 695, height: 25 }, { x: 1325, y: 840, width: 695, height: 25 },

    // カフェテリア下 ⇔ ストレージ (垂直通路)
    { x: 2000, y: 1500, width: 25, height: 460 }, { x: 2120, y: 1500, width: 25, height: 460 },

    // コックピット ⇔ メッドベイ (水平通路)
    { x: 725, y: 590, width: 325, height: 25 }, { x: 725, y: 710, width: 325, height: 25 },

    // アッパーエンジン ⇔ エレクトリカル (水平通路)
    { x: 675, y: 1200, width: 525, height: 25 }, { x: 675, y: 1320, width: 525, height: 25 },

    // ロワーエンジン ⇔ セキュリティ (L字通路)
    { x: 775, y: 1990, width: 275, height: 25 }, { x: 775, y: 2110, width: 275, height: 25 },
    { x: 1050, y: 1360, width: 25, height: 655 }, { x: 1170, y: 1360, width: 25, height: 655 },

    // ストレージ ⇔ シールド (水平通路)
    { x: 2225, y: 2010, width: 525, height: 25 }, { x: 2225, y: 2130, width: 525, height: 25 },

    // ウェポン ⇔ ナビゲーション (垂直通路)
    { x: 3075, y: 750, width: 25, height: 320 }, { x: 3195, y: 750, width: 25, height: 320 },
];

// タスク位置 (11個)
let tasks = [
    { id: 1, x: 575, y: 575, name: 'コックピット調整', completed: false },
    { id: 2, x: 550, y: 1175, name: 'アッパーエンジン点検', completed: false },
    { id: 3, x: 650, y: 1975, name: 'ロワーエンジン点検', completed: false },
    { id: 4, x: 1200, y: 675, name: 'メッドベイ診断', completed: false },
    { id: 5, x: 1200, y: 1825, name: 'セキュリティ確認', completed: false },
    { id: 6, x: 1325, y: 1275, name: 'エレクトリカル修理', completed: false },
    { id: 7, x: 2000, y: 1300, name: 'カフェテリア配線', completed: false },
    { id: 8, x: 2000, y: 2150, name: 'ストレージ燃料補給', completed: false },
    { id: 9, x: 2950, y: 575, name: 'ウェポンシステム確認', completed: false },
    { id: 10, x: 3200, y: 1225, name: 'ナビゲーション設定', completed: false },
    { id: 11, x: 2900, y: 2075, name: 'シールド充填', completed: false }
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
            bodies[socket.id] = { x: target.x, y: target.y, name: target.name, color: target.color };
            io.emit('updateGameState', { players, bodies });
            checkWinCondition();
        }
    });

    socket.on('reportBody', () => {
        if (gameState !== 'PLAYING') return;
        const player = players[socket.id];
        if (!player || player.isDead) return;
        if (Object.keys(bodies).length > 0) startMeeting('body', player.name);
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
    bodies = {};
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
