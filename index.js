const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { 
    maxHttpBufferSize: 1e8, 
    cors: { origin: "*" } 
});
const path = require('path');

// --- 核心数据库 (内存版，确保部署即用) ---
let db = {
    users: {}, // { username: { pass, avatar, bio, friends, requests, groups } }
    groups: {}, // { gid: { name, members } }
    allMsgs: []
};

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

io.on('connection', (socket) => {
    // --- 认证：登录与注册合一逻辑 ---
    socket.on('auth', (data) => {
        const { user, pass, isReg } = data;
        if (!user || !pass) return socket.emit('sys-msg', '请填写完整信息');

        if (isReg) {
            if (db.users[user]) return socket.emit('sys-msg', '用户名已占用');
            db.users[user] = { pass, avatar: null, bio: 'Hello!', friends: [], requests: [], groups: [] };
            return socket.emit('auth-result', { success: true, isReg: true });
        } else {
            const u = db.users[user];
            if (u && u.pass === pass) {
                socket.username = user;
                u.socketId = socket.id;
                // 自动加入已有的群组
                if(u.groups) u.groups.forEach(gid => socket.join(gid));
                
                socket.emit('auth-result', { 
                    success: true, 
                    user, 
                    userData: u,
                    history: db.allMsgs.filter(m => m.from === user || m.to === user || (m.isGroup && u.groups.includes(m.to)))
                });
            } else {
                socket.emit('sys-msg', u ? '密码错误' : '用户不存在，请先注册');
            }
        }
    });

    // --- 消息处理 (支持图片/视频/GIF) ---
    socket.on('send-msg', (data) => {
        if(!socket.username) return;
        const msg = {
            id: Date.now(),
            from: socket.username,
            to: data.to,
            text: data.text || "",
            image: data.image || null,
            video: data.video || null,
            isGroup: data.isGroup,
            time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})
        };
        db.allMsgs.push(msg);
        if (db.allMsgs.length > 500) db.allMsgs.shift();

        if (data.isGroup) {
            io.to(data.to).emit('msg', msg);
        } else {
            if (db.users[data.to] && db.users[data.to].socketId) {
                io.to(db.users[data.to].socketId).emit('msg', msg);
            }
            socket.emit('msg', msg); // 发给自己
        }
    });

    // --- 资料更新 ---
    socket.on('update-profile', (d) => {
        if(db.users[socket.username]) {
            Object.assign(db.users[socket.username], d);
            socket.emit('sys-msg', '资料已更新');
        }
    });

    socket.on('disconnect', () => {
        if(socket.username && db.users[socket.username]) db.users[socket.username].socketId = null;
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('🚀 Telegram V7 Pro 上线'));
