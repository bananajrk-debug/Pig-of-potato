const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ゲーム設定
const MAP_WIDTH = 4000;
const MAP_HEIGHT = 3000;
const PLAYER_RADIUS = 20;
const PLAYER_SPEED = 4;

let gameState = 'PLAYING'; // 'PLAYING' | 'MEETING'
let players = {};
let bodies = [];
let emergencyButton = { x: 2000, y: 1400, radius: 40, active: true };
let meetingTimer = null;
let meetingSecondsLeft = 45;

// ==========================================
// マップ定義：11個の部屋と、完璧につながる直角の廊下・ドア隙間
// ==========================================
const walls = [
    // --- 外周壁 ---
    { x: 0, y: 0, w: MAP_WIDTH, h: 40 },
    { x: 0, y: MAP_HEIGHT - 40, w: MAP_WIDTH, h: 40 },
    { x: 0, y: 0, w: 40, h: MAP_HEIGHT },
    { x: MAP_WIDTH - 40, y: 0, w: 40, h: MAP_HEIGHT },

    // --- 1. カフェテリア (Cafeteria) [中央: x:1600-2400, y:1000-1800] ---
    // 上壁（中央に通路用の幅100pxのドア隙間を確保: x:1950〜2050を開ける）
    { x: 1600, y: 1000, w: 350, h: 40 }, { x: 2050, y: 1000, w: 350, h: 40 },
    // 下壁（ストレージへ続くドア隙間: x:1950〜2050）
    { x: 1600, y: 1800, w: 350, h: 40 }, { x: 2050, y: 1800, w: 350, h: 40 },
    // 左壁（メッドベイへ続くドア隙間: y:1350〜1450）
    { x: 1600, y: 1000, w: 40, h: 350 }, { x: 1600, y: 1450, w: 40, h: 350 },
    // 右壁（ナビゲーションへ続くドア隙間: y:1350〜1450）
    { x: 2360, y: 1000, w: 40, h: 350 }, { x: 2360, y: 1450, w: 40, h: 350 },

    // --- 2. ストレージ (Storage) [下部中央: x:1600-2400, y:2100-2700] ---
    // 上壁（カフェテリアからの通路と接続）
    { x: 1600, y: 2100, w: 350, h: 40 }, { x: 2050, y: 2100, w: 350, h: 40 },
    // 下壁
    { x: 1600, y: 2700, w: 800, h: 40 },
    // 左壁（エレクトリカル・ロワーエンジン方面への通路隙間: y:2350〜2450）
    { x: 1600, y: 2100, w: 40, h: 250 }, { x: 1600, y: 2450, w: 40, h: 250 },
    // 右壁（シールド方面への通路隙間: y:2350〜2450）
    { x: 2360, y: 2100, w: 40, h: 250 }, { x: 2360, y: 2450, w: 40, h: 250 },

    // --- 3. アッパーエンジン (Upper Engine) [左上: x:600-1200, y:400-1000] ---
    { x: 600, y: 400, w: 600, h: 40 },
    // 下壁（右側通路への接続隙間: x:950〜1050）
    { x: 600, y: 1000, w: 350, h: 40 }, { x: 1050, y: 1000, w: 150, h: 40 },
    { x: 600, y: 400, w: 40, h: 600 },
    { x: 1160, y: 400, w: 40, h: 600 },

    // --- 4. ロワーエンジン (Lower Engine) [左下: x:600-1200, y:2000-2600] ---
    // 上壁（メッドベイからの通路接続）
    { x: 600, y: 2000, w: 350, h: 40 }, { x: 1050, y: 2000, w: 150, h: 40 },
    { x: 600, y: 2600, w: 600, h: 40 },
    { x: 600, y: 2000, w: 40, h: 600 },
    { x: 1160, y: 2000, w: 40, h: 600 },

    // --- 5. メッドベイ (MedBay) [左中央: x:600-1200, y:1200-1800] ---
    // 上壁（アッパーエンジンからの縦通路と接続）
    { x: 600, y: 1200, w: 350, h: 40 }, { x: 1050, y: 1200, w: 150, h: 40 },
    // 下壁（ロワーエンジンへの通路接続）
    { x: 600, y: 1800, w: 350, h: 40 }, { x: 1050, y: 1800, w: 150, h: 40 },
    // 左壁（セキュリティへの通路接続: y:1450〜1550）
    { x: 600, y: 1200, w: 40, h: 250 }, { x: 600, y: 1550, w: 40, h: 250 },
    // 右壁（カフェテリアへの横廊下接続: y:1400〜1500）
    { x: 1160, y: 1200, w: 40, h: 200 }, { x: 1160, y: 1600, w: 40, h: 200 },

    // --- 6. セキュリティ (Security) [左端中央: x:200-550, y:1250-1750] ---
    { x: 200, y: 1250, w: 350, h: 40 },
    { x: 200, y: 1750, w: 350, h: 40 },
    { x: 200, y: 1250, w: 40, h: 500 },
    // 右壁（メッドベイへの通路接続: y:1450〜1550）
    { x: 510, y: 1250, w: 40, h: 200 }, { x: 510, y: 1550, w: 40, h: 200 },

    // --- 7. エレクトリカル (Electrical) [左最下: x:600-1200, y:2800-3200 (→マップ内収まるようy:2750-2960に変更)] ---
    { x: 600, y: 2750, w: 600, h: 40 },
    { x: 600, y: 2960, w: 600, h: 40 }, // 下端壁
    // 上壁（ロワーエンジンからの通路接続: x:850〜950）
    { x: 600, y: 2750, w: 250, h: 40 }, { x: 950, y: 2750, w: 250, h: 40 },
    { x: 600, y: 2750, w: 40, h: 210 },
    { x: 1160, y: 2750, w: 40, h: 210 },

    // --- 8. ナビゲーション (Navigation) [右端中央: x:3050-3750, y:1200-1800] ---
    { x: 3050, y: 1200, w: 700, h: 40 },
    { x: 3050, y: 1800, w: 700, h: 40 },
    // 左壁（カフェテリアへの横廊下接続: y:1400〜1500）
    { x: 3050, y: 1200, w: 40, h: 200 }, { x: 3050, y: 1600, w: 40, h: 200 },
    { x: 3710, y: 1200, w: 40, h: 600 },

    // --- 9. ウェポン (Weapons) [右上: x:2700-3300, y:400-1000] ---
    { x: 2700, y: 400, w: 600, h: 40 },
    // 下壁（コックピットへの接続など）
    { x: 2700, y: 1000, w: 600, h: 40 },
    { x: 2700, y: 400, w: 40, h: 600 },
    // 右壁（コックピットへの通路接続: y:650〜750）
    { x: 3260, y: 400, w: 40, h: 250 }, { x: 3260, y: 750, w: 40, h: 250 },

    // --- 10. コックピット (Cockpit) [最右上: x:3450-3900, y:400-900] ---
    { x: 3450, y: 400, w: 450, h: 40 },
    { x: 3450, y: 900, w: 450, h: 40 },
    // 左壁（ウェポンからの通路接続: y:650〜750）
    { x: 3450, y: 400, w: 40, h: 250 }, { x: 3450, y: 750, w: 40, h: 250 },
    { x: 3860, y: 400, w: 40, h: 500 },

    // --- 11. シールド (Shields) [右下: x:2700-3300, y:2000-2600] ---
    // 上壁（ストレージからの通路接続: x:2950〜3050）
    { x: 2700, y: 2000, w: 250, h: 40 }, { x: 3050, y: 2000, w: 250, h: 40 },
    { x: 2700, y: 2600, w: 600, h: 40 },
    { x: 2700, y: 2000, w: 40, h: 600 },
    { x: 3260, y: 2000, w: 40, h: 600 },

    // ==========================================
    // 廊下を形作る平行ガイド壁（幅約100pxの通路網）
    // ==========================================
    // カフェテリア ⇔ 上エリア（アッパーエンジン・ウェポン）を結ぶ縦廊下
    { x: 1900, y: 700, w: 40, h: 300 },
    { x: 2050, y: 700, w: 40, h: 300 },

    // カフェテリア ⇔ 下エリア（ストレージ）を結ぶ縦廊下
    { x: 1900, y: 1800, w: 40, h: 300 },
    { x: 2050, y: 1800, w: 40, h: 300 },

    // カフェテリア ⇔ メッドベイ・セキュリティを結ぶ横廊下
    { x: 1200, y: 1400, w: 400, h: 40 },
    { x: 1200, y: 1500, w: 400, h: 40 },

    // カフェテリア ⇔ ナビゲーションを結ぶ横廊下
    { x: 2360, y: 1400, w: 690, h: 40 },
    { x: 2360, y: 1500, w: 690, h: 40 },

    // メッドベイ ⇔ アッパーエンジン・ロワーエンジンを結ぶ縦廊下
    { x: 850, y: 1000, w: 40, h: 200 },
    { x: 950, y: 1000, w: 40, h: 200 },
    { x: 850, y: 1800, w: 40, h: 200 },
    { x: 950, y: 1800, w: 40, h: 200 },

    // ストレージ ⇔ シールドを結ぶ横廊下
    { x: 2360, y: 2300, w: 340, h: 40 },
    { x: 2360, y: 2400, w: 340, h: 40 }
];

// タスク定義（各部屋の内部に綺麗に配置）
const tasksData = [
    { id: 't1', x: 800, y: 700, name: '配線修理 (アッパーエンジン)', type: 'WIRING' },
    { id: 't2', x: 800, y: 2300, name: 'データダウンロード (ロワーエンジン)', type: 'DOWNLOAD' },
    { id: 't3', x: 800, y: 1500, name: 'エンジン点検 (メッドベイ)', type: 'ENGINE' },
    { id: 't4', x: 350, y: 1500, name: '配線修理 (セキュリティ)', type: 'WIRING' },
    { id: 't5', x: 900, y: 2850, name: 'データダウンロード (エレクトリカル)', type: 'DOWNLOAD' },
    { id: 't6', x: 2000, y: 2400, name: 'エンジン点検 (ストレージ)', type: 'ENGINE' },
    { id: 't7', x: 3000, y: 700, name: '配線修理 (ウェポン)', type: 'WIRING' },
    { id: 't8', x: 3350, y: 1500, name: 'データダウンロード (ナビゲーション)', type: 'DOWNLOAD' },
    { id: 't9', x: 3000, y: 2300, name: 'エンジン点検 (シールド)', type: 'ENGINE' }
];

// 当たり判定チェック
function checkCollision(x, y, r) {
    if (x - r < 0 || x + r > MAP_WIDTH || y - r < 0 || y + r > MAP_HEIGHT) return true;
    for (let wall of walls) {
        if (
            x + r > wall.x &&
            x - r < wall.x + wall.w &&
            y + r > wall.y &&
            y - r < wall.y + wall.h
        ) {
            return true;
        }
    }
    return false;
}

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    socket.on('join-game', (playerName) => {
        const isFirst = Object.keys(players).length === 0;
        players[socket.id] = {
            id: socket.id,
            name: playerName || `Player_${socket.id.substr(0,4)}`,
            x: 2000 + (Math.random() * 100 - 50),
            y: 1400 + (Math.random() * 100 - 50),
            role: isFirst ? 'wolf' : 'crew',
            isAlive: true,
            color: isFirst ? '#ff4444' : '#4488ff',
            tasks: tasksData.map(t => ({ ...t, completed: false })),
            vote: null
        };

        socket.emit('init', { id: socket.id, players, bodies, emergencyButton, tasks: tasksData, walls });
    });

    socket.on('player-move', (data) => {
        if (gameState !== 'PLAYING') return;
        let p = players[socket.id];
        if (!p || !p.isAlive) return;

        let newX = p.x + data.vx * PLAYER_SPEED;
        let newY = p.y + data.vy * PLAYER_SPEED;

        if (!checkCollision(newX, p.y, PLAYER_RADIUS)) p.x = newX;
        if (!checkCollision(p.x, newY, PLAYER_RADIUS)) p.y = newY;
    });

    socket.on('player-kill', (targetId) => {
        let killer = players[socket.id];
        let target = players[targetId];
        if (killer && killer.role === 'wolf' && killer.isAlive && target && target.isAlive) {
            let dist = Math.hypot(killer.x - target.x, killer.y - target.y);
            if (dist < 100) {
                target.isAlive = false;
                bodies.push({ id: target.id, name: target.name, x: target.x, y: target.y, color: target.color });
                io.emit('notification', `${target.name} が殺害されました！`);
            }
        }
    });

    socket.on('report-body', (bodyId) => {
        if (gameState !== 'PLAYING') return;
        startMeeting('死体が発見されました！');
    });

    socket.on('emergency-meeting', () => {
        if (gameState !== 'PLAYING') return;
        let p = players[socket.id];
        if (!p || !p.isAlive) return;
        let dist = Math.hypot(p.x - emergencyButton.x, p.y - emergencyButton.y);
        if (dist < emergencyButton.radius + PLAYER_RADIUS) {
            startMeeting('緊急会議が招集されました！');
        }
    });

    socket.on('cast-vote', (targetId) => {
        if (gameState !== 'MEETING') return;
        let p = players[socket.id];
        if (!p || !p.isAlive) return;
        p.vote = targetId;
        
        let alivePlayers = Object.values(players).filter(pl => pl.isAlive);
        if (alivePlayers.every(pl => pl.vote !== undefined)) {
            resolveMeeting();
        }
    });

    socket.on('complete-task', (taskId) => {
        let p = players[socket.id];
        if (!p || !p.isAlive) return;
        let task = p.tasks.find(t => t.id === taskId);
        if (task && !task.completed) {
            let dist = Math.hypot(p.x - task.x, p.y - task.y);
            if (dist < 80) {
                task.completed = true;
                let allCompleted = Object.values(players)
                    .filter(pl => pl.role === 'crew')
                    .every(pl => pl.tasks.every(t => t.completed));
                if (allCompleted) {
                    io.emit('game-over', '市民のタスク勝利！');
                    gameState = 'GAMEOVER';
                }
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
        if (players[socket.id]) {
            delete players[socket.id];
        }
        if (Object.keys(players).length === 0) {
            gameState = 'PLAYING';
            bodies = [];
        }
    });
});

function startMeeting(reason) {
    gameState = 'MEETING';
    meetingSecondsLeft = 45;
    Object.values(players).forEach(p => p.vote = undefined);
    io.emit('start-meeting', { reason, players });

    if (meetingTimer) clearInterval(meetingTimer);
    meetingTimer = setInterval(() => {
        meetingSecondsLeft--;
        io.emit('meeting-timer', meetingSecondsLeft);
        if (meetingSecondsLeft <= 0) {
            clearInterval(meetingTimer);
            resolveMeeting();
        }
    }, 1000);
}

function resolveMeeting() {
    if (gameState !== 'MEETING') return;
    if (meetingTimer) clearInterval(meetingTimer);

    let voteCounts = {};
    Object.values(players).forEach(p => {
        if (p.vote) {
            voteCounts[p.vote] = (voteCounts[p.vote] || 0) + 1;
        }
    });

    let exiledId = null;
    let maxVotes = 0;
    for (let id in voteCounts) {
        if (voteCounts[id] > maxVotes) {
            maxVotes = voteCounts[id];
            exiledId = id;
        }
    }

    if (exiledId && players[exiledId]) {
        players[exiledId].isAlive = false;
        io.emit('notification', `${players[exiledId].name} は投票により追放されました。`);
    } else {
        io.emit('notification', '誰も追放されませんでした。');
    }

    bodies = [];
    gameState = 'PLAYING';

    let wolvesAlive = Object.values(players).filter(p => p.role === 'wolf' && p.isAlive).length;
    let crewsAlive = Object.values(players).filter(p => p.role === 'crew' && p.isAlive).length;
    if (wolvesAlive === 0) {
        io.emit('game-over', '市民の勝利（人狼全滅）！');
        gameState = 'GAMEOVER';
    } else if (wolvesAlive >= crewsAlive) {
        io.emit('game-over', '人狼の勝利！');
        gameState = 'GAMEOVER';
    }

    io.emit('end-meeting', players);
}

setInterval(() => {
    if (gameState === 'PLAYING') {
        io.emit('game-state', { players, bodies });
    }
}, 1000 / 30);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
