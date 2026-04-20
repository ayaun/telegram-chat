const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { 
    maxHttpBufferSize: 1e8, 
    cors: { origin: "*" } 
});
const fs = require('fs');
const path = require('path');

// 数据库路径适配
const DB_FILE = path.join(process.cwd(), 'db.json');
let db = { users: {}, groups: {}, allMsgs: [] };

if (fs.existsSync(DB_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) { console.log("初始化数据库"); }
}

function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

io.on('connection', (socket) => {
    // --- 注册逻辑 ---
    socket.on('register', (data) => {
        const u = data.user ? data.user.trim() : "";
        if (!u || db.users[u]) return socket.emit('sys-msg', '用户名已占用或为空');
        
        db.users[u] = { 
            pass: data.pass, avatar: null, bio: 'Hello!', 
            friends: [], requests: [], groups: [] 
        };
        saveDB();
        socket.emit('auth-result', { success: true, isReg: true, msg: '注册成功，请切换到登录模式' });
    });

    // --- 登录逻辑 ---
    socket.on('login', (data) => {
        const u = data.user ? data.user.trim() : "";
        const userObj = db.users[u];
        
        if (userObj && userObj.pass === data.pass) {
            socket.username = u;
            userObj.socketId = socket.id;
            userObj.groups = userObj.groups || [];
            userObj.groups.forEach(gid => socket.join(gid));
            
            const groupList = userObj.groups.filter(id => db.groups[id]).map(id => ({ id, name: db.groups[id].name }));
            socket.emit('auth-result', { success: true, user: u, userData: userObj, allGroups: groupList });
            
            const history = db.allMsgs.filter(m => m.from === u || m.to === u || (m.isGroup && userObj.groups.includes(m.to)));
            socket.emit('load-history', history);
        } else {
            socket.emit('auth-result', { success: false, msg: userObj ? '密码错误' : '用户不存在，请先注册' });
        }
    });

    // --- 消息分发 ---
    socket.on('send-msg', (data) => {
        if(!socket.username) return;
        const msg = { 
            id: Date.now() + Math.random(),
            from: socket.username, to: data.to, text: data.text || "",
            avatar: db.users[socket.username].avatar,
            image: data.image || null, video: data.video || null,
            isGroup: data.isGroup,
            time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) 
        };
        db.allMsgs.push(msg); 
        if (db.allMsgs.length > 500) db.allMsgs.shift();
        saveDB();
        if (data.isGroup) io.to(data.to).emit('msg', msg);
        else {
            if (db.users[data.to] && db.users[data.to].socketId) io.to(db.users[data.to].socketId).emit('msg', msg);
            socket.emit('msg', msg);
        }
    });

    socket.on('get-user-info', n => {
        const u = db.users;
        if(u) socket.emit('user-info-card', { user: n, avatar: u.avatar, bio: u.bio });
    });

    socket.on('update-profile', d => {
        if(db.users[socket.username]) {
            Object.assign(db.users[socket.username], d);
            saveDB();
            socket.emit('update-data', { userData: db.users[socket.username] });
        }
    });

    socket.on('disconnect', () => { if(socket.username) db.users[socket.username].socketId = null; });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`🚀 Server running`));
