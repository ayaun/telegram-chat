const express = require('express');
const app = express();
const http = require('http').Server(app);
const io = require('socket.io')(http, { 
    maxHttpBufferSize: 1e8, 
    cors: { origin: "*" },
    allowEIO3: true // 增加兼容性
});
const fs = require('fs');
const path = require('path');

// 数据库初始化
const DB_FILE = '/tmp/db.json'; 
let db = { users: {}, allMsgs: [] };

if (fs.existsSync(DB_FILE)) {
    try {
        db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) { console.log("初始化数据库"); }
}

function saveDB() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (e) { console.error("保存失败"); }
}

app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

io.on('connection', (socket) => {
    console.log('用户已连接:', socket.id);

    // --- 注册逻辑 ---
    socket.on('register', (data) => {
        const u = data.user ? data.user.trim() : "";
        if (!u) return socket.emit('sys-msg', '用户名不能为空');
        if (db.users[u]) return socket.emit('sys-msg', '用户名已占用');
        
        db.users[u] = { pass: data.pass, friends: [], requests: [] };
        saveDB();
        console.log('新用户注册:', u);
        socket.emit('auth-result', { success: true, isReg: true, msg: '注册成功！请直接点击登录' });
    });

    // --- 登录逻辑 ---
    socket.on('login', (data) => {
        const u = data.user ? data.user.trim() : "";
        const userObj = db.users[u];
        
        console.log('尝试登录:', u);
        if (userObj && userObj.pass === data.pass) {
            socket.username = u;
            console.log('登录成功:', u);
            socket.emit('auth-result', { success: true, user: u, userData: userObj });
            // 发送最近的20条历史消息
            socket.emit('load-history', db.allMsgs.slice(-20));
        } else {
            const errorMsg = userObj ? '密码错误' : '用户不存在，请先注册';
            socket.emit('auth-result', { success: false, msg: errorMsg });
        }
    });

    // --- 消息分发 ---
    socket.on('send-msg', (data) => {
        if(!socket.username) return;
        const msg = { 
            from: socket.username, 
            text: data.text || "",
            time: new Date().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) 
        };
        db.allMsgs.push(msg);
        if (db.allMsgs.length > 100) db.allMsgs.shift();
        saveDB();
        io.emit('msg', msg); 
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log('服务已在端口', PORT, '启动'));
