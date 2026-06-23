const express = require('express');
const Database = require('better-sqlite3');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = new Database('shop.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    points INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    points_earned INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES members(id)
  );

  CREATE TABLE IF NOT EXISTS gifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    points_required INTEGER NOT NULL,
    description TEXT,
    stock INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS redemptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    gift_id INTEGER NOT NULL,
    points_deducted INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES members(id),
    FOREIGN KEY (gift_id) REFERENCES gifts(id)
  );
`);

const initGifts = db.prepare('SELECT COUNT(*) as count FROM gifts');
if (initGifts.get().count === 0) {
  const insertGift = db.prepare(
    'INSERT INTO gifts (name, points_required, description, stock) VALUES (?, ?, ?, ?)'
  );
  insertGift.run('新鲜苹果礼盒', 500, '5斤装红富士苹果', 50);
  insertGift.run('进口橙子一箱', 800, '新西兰进口橙子10斤', 30);
  insertGift.run('精品水果篮', 1200, '时令水果组合篮', 20);
  insertGift.run('VIP尊享卡', 2000, '全场9折优惠卡（永久）', 10);
}

app.get('/api/members', (req, res) => {
  const { keyword } = req.query;
  let members;
  if (keyword) {
    const stmt = db.prepare(
      'SELECT * FROM members WHERE phone LIKE ? OR name LIKE ? ORDER BY created_at DESC'
    );
    members = stmt.all(`%${keyword}%`, `%${keyword}%`);
  } else {
    members = db.prepare('SELECT * FROM members ORDER BY created_at DESC').all();
  }
  res.json(members);
});

app.get('/api/members/:id', (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) {
    return res.status(404).json({ error: '会员不存在' });
  }
  res.json(member);
});

app.post('/api/members', (req, res) => {
  const { phone, name } = req.body;
  if (!phone || !name) {
    return res.status(400).json({ error: '手机号和姓名不能为空' });
  }
  try {
    const stmt = db.prepare('INSERT INTO members (phone, name) VALUES (?, ?)');
    const result = stmt.run(phone, name);
    const member = db.prepare('SELECT * FROM members WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(member);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: '该手机号已注册' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/members/:id', (req, res) => {
  const { phone, name } = req.body;
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) {
    return res.status(404).json({ error: '会员不存在' });
  }
  try {
    const stmt = db.prepare('UPDATE members SET phone = ?, name = ? WHERE id = ?');
    stmt.run(phone || member.phone, name || member.name, req.params.id);
    const updated = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: '该手机号已被其他会员使用' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/members/:id', (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) {
    return res.status(404).json({ error: '会员不存在' });
  }
  db.prepare('DELETE FROM transactions WHERE member_id = ?').run(req.params.id);
  db.prepare('DELETE FROM redemptions WHERE member_id = ?').run(req.params.id);
  db.prepare('DELETE FROM members WHERE id = ?').run(req.params.id);
  res.json({ message: '删除成功' });
});

app.get('/api/transactions', (req, res) => {
  const { member_id, start_date, end_date } = req.query;
  let query = `
    SELECT t.*, m.name as member_name, m.phone as member_phone
    FROM transactions t
    LEFT JOIN members m ON t.member_id = m.id
    WHERE 1=1
  `;
  const params = [];
  if (member_id) {
    query += ' AND t.member_id = ?';
    params.push(member_id);
  }
  if (start_date) {
    query += ' AND DATE(t.created_at) >= DATE(?)';
    params.push(start_date);
  }
  if (end_date) {
    query += ' AND DATE(t.created_at) <= DATE(?)';
    params.push(end_date);
  }
  query += ' ORDER BY t.created_at DESC';
  const transactions = db.prepare(query).all(...params);
  res.json(transactions);
});

app.post('/api/transactions', (req, res) => {
  const { member_id, amount } = req.body;
  if (!member_id || !amount) {
    return res.status(400).json({ error: '会员ID和消费金额不能为空' });
  }
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(member_id);
  if (!member) {
    return res.status(404).json({ error: '会员不存在' });
  }
  const points_earned = Math.floor(amount);
  const tx = db.transaction(() => {
    const stmt = db.prepare(
      'INSERT INTO transactions (member_id, amount, points_earned) VALUES (?, ?, ?)'
    );
    const result = stmt.run(member_id, amount, points_earned);
    db.prepare('UPDATE members SET points = points + ? WHERE id = ?').run(
      points_earned,
      member_id
    );
    return result.lastInsertRowid;
  });
  const id = tx();
  const transaction = db.prepare(`
    SELECT t.*, m.name as member_name, m.phone as member_phone, m.points as current_points
    FROM transactions t
    LEFT JOIN members m ON t.member_id = m.id
    WHERE t.id = ?
  `).get(id);
  res.status(201).json(transaction);
});

app.get('/api/gifts', (req, res) => {
  const gifts = db.prepare('SELECT * FROM gifts ORDER BY points_required ASC').all();
  res.json(gifts);
});

app.post('/api/gifts', (req, res) => {
  const { name, points_required, description, stock } = req.body;
  if (!name || !points_required) {
    return res.status(400).json({ error: '礼品名称和所需积分不能为空' });
  }
  const stmt = db.prepare(
    'INSERT INTO gifts (name, points_required, description, stock) VALUES (?, ?, ?, ?)'
  );
  const result = stmt.run(name, points_required, description || '', stock || 0);
  const gift = db.prepare('SELECT * FROM gifts WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(gift);
});

app.get('/api/redemptions', (req, res) => {
  const { member_id } = req.query;
  let query = `
    SELECT r.*, m.name as member_name, m.phone as member_phone, g.name as gift_name
    FROM redemptions r
    LEFT JOIN members m ON r.member_id = m.id
    LEFT JOIN gifts g ON r.gift_id = g.id
    WHERE 1=1
  `;
  const params = [];
  if (member_id) {
    query += ' AND r.member_id = ?';
    params.push(member_id);
  }
  query += ' ORDER BY r.created_at DESC';
  const redemptions = db.prepare(query).all(...params);
  res.json(redemptions);
});

app.post('/api/redemptions', (req, res) => {
  const { member_id, gift_id } = req.body;
  if (!member_id || !gift_id) {
    return res.status(400).json({ error: '会员ID和礼品ID不能为空' });
  }
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(member_id);
  if (!member) {
    return res.status(404).json({ error: '会员不存在' });
  }
  const gift = db.prepare('SELECT * FROM gifts WHERE id = ?').get(gift_id);
  if (!gift) {
    return res.status(404).json({ error: '礼品不存在' });
  }
  if (member.points < gift.points_required) {
    return res.status(400).json({
      error: `积分不足，当前积分 ${member.points}，需要 ${gift.points_required} 积分`
    });
  }
  if (gift.stock <= 0) {
    return res.status(400).json({ error: '礼品库存不足' });
  }
  const tx = db.transaction(() => {
    const stmt = db.prepare(
      'INSERT INTO redemptions (member_id, gift_id, points_deducted) VALUES (?, ?, ?)'
    );
    const result = stmt.run(member_id, gift_id, gift.points_required);
    db.prepare('UPDATE members SET points = points - ? WHERE id = ?').run(
      gift.points_required,
      member_id
    );
    db.prepare('UPDATE gifts SET stock = stock - 1 WHERE id = ?').run(gift_id);
    return result.lastInsertRowid;
  });
  const id = tx();
  const redemption = db.prepare(`
    SELECT r.*, m.name as member_name, m.phone as member_phone, m.points as current_points,
           g.name as gift_name
    FROM redemptions r
    LEFT JOIN members m ON r.member_id = m.id
    LEFT JOIN gifts g ON r.gift_id = g.id
    WHERE r.id = ?
  `).get(id);
  res.status(201).json(redemption);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`会员积分系统已启动: http://localhost:${PORT}`);
});
