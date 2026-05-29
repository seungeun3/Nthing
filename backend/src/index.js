import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import { getDb, STANDARD_LOCATIONS, CATEGORIES } from './db.js';
import crypto from 'crypto';

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function createNotification(db, userId, title, content, type) {
  const notificationId = `notif_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  await db.run(
    `INSERT INTO notifications (id, userId, title, content, type, read, createdAt)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
    [notificationId, userId, title, content, type, Date.now()]
  );
  return notificationId;
}

async function dispatchConfirmationNotifications(db, postId) {
  try {
    const post = await db.get("SELECT * FROM posts WHERE id = ?", [postId]);
    if (!post) return;

    // Get all orders in this post
    const orders = await db.all("SELECT * FROM orders WHERE postId = ?", [postId]);

    // Group by userId to calculate personal costs
    const userTotals = {};
    for (const o of orders) {
      if (!userTotals[o.userId]) {
        userTotals[o.userId] = 0;
      }
      userTotals[o.userId] += o.itemPrice * o.quantity;
    }

    const participantCount = Object.keys(userTotals).length;
    const totalAccumulated = Object.values(userTotals).reduce((sum, v) => sum + v, 0);
    const isFreeShipping = totalAccumulated >= post.targetPrice;
    const splitFee = isFreeShipping ? 0 : Math.round(post.baseFee / participantCount);

    for (const userId of Object.keys(userTotals)) {
      const itemsCost = userTotals[userId];
      const personalTotal = itemsCost + splitFee;

      const title = `[공구 확정] ${post.title}`;
      const content = `공동구매 매칭이 확정되었습니다!\n• 호스트 예금주: ${post.hostMaskedName}\n• 송금 계좌: ${post.bankAccount}\n• 나의 입금액: ${personalTotal.toLocaleString()}원 (상품금액 ${itemsCost.toLocaleString()}원 + 1/N 배송비 ${splitFee.toLocaleString()}원)`;

      await createNotification(db, userId, title, content, 'CONFIRMED');
    }
  } catch (err) {
    console.error("dispatchConfirmationNotifications Error:", err);
  }
}

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = 'dding-hackathon-super-secret-key-12345';

app.use(cors());
app.use(express.json());

// JWT Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing JWT Token' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Forbidden: Invalid or expired JWT Token' });
    }
    req.user = user;
    next();
  });
}

// Security Middleware: Prevent suspended or banned users from posting/joining/modifying nicknames
async function checkSuspension(req, res, next) {
  const userId = req.user.id;
  try {
    const db = await getDb();
    const user = await db.get("SELECT status, suspendedUntil FROM users WHERE id = ?", [userId]);

    if (user) {
      if (user.status === 'BANNED') {
        return res.status(403).json({
          error: "🚫 BANNED: 정산 약정 불이행으로 인해 계정이 영구 정지되었습니다."
        });
      }
      if (user.suspendedUntil && Date.now() < user.suspendedUntil) {
        const remainingHours = Math.ceil((user.suspendedUntil - Date.now()) / (1000 * 60 * 60));
        return res.status(403).json({
          error: `🚫 SUSPENDED: 정산 연체 벌점 누적으로 이용이 정지되었습니다. (정지 해제까지 약 ${remainingHours}시간 남음)`
        });
      }
    }
    next();
  } catch (err) {
    next();
  }
}

// Helper: Masking function for host name
function maskName(name) {
  if (!name) return "";
  const len = name.length;
  if (len <= 2) {
    return name[0] + "*";
  }
  const mid = Math.floor(len / 2);
  return name.substring(0, mid) + "*" + name.substring(mid + 1);
}

// ----------------------------------------------------
// 1. Auth & User Routes
// ----------------------------------------------------

// POST /api/v1/auth/signup -> Register User with credentials
app.post('/api/v1/auth/signup', async (req, res) => {
  const { username, password, nickname, refundAccount } = req.body;

  if (!username || !password || !nickname) {
    return res.status(400).json({ error: 'Username, password and nickname are required.' });
  }

  try {
    const db = await getDb();

    // Check duplication
    const existingUser = await db.get("SELECT id FROM users WHERE id = ?", [username]);
    if (existingUser) {
      return res.status(409).json({ error: 'Username is already taken.' });
    }

    const existingNick = await db.get("SELECT id FROM users WHERE nickname = ?", [nickname]);
    if (existingNick) {
      return res.status(409).json({ error: 'Nickname is already taken.' });
    }

    const passwordHash = hashPassword(password);

    await db.run(
      `INSERT INTO users (id, password, nickname, provider, penaltyCount, status, suspendedUntil, refundAccount, penaltyFlag, createdAt)
       VALUES (?, ?, ?, 'local', 0, 'ACTIVE', 0, ?, 0, ?)`,
      [username, passwordHash, nickname, refundAccount || '', Date.now()]
    );

    const user = { id: username, nickname, provider: 'local', penaltyCount: 0, status: 'ACTIVE', refundAccount };
    const token = jwt.sign({ id: user.id, nickname: user.nickname }, JWT_SECRET, { expiresIn: '7d' });

    return res.status(201).json({
      message: 'Signup successful',
      token,
      user
    });
  } catch (error) {
    console.error("Signup Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/v1/auth/login -> User Login with credentials
app.post('/api/v1/auth/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  try {
    const db = await getDb();
    const user = await db.get("SELECT * FROM users WHERE id = ?", [username]);

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const passwordHash = hashPassword(password);
    if (user.password !== passwordHash) {
      return res.status(401).json({ error: 'Invalid username or password.' });
    }

    const token = jwt.sign({ id: user.id, nickname: user.nickname }, JWT_SECRET, { expiresIn: '7d' });

    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        nickname: user.nickname,
        provider: user.provider,
        penaltyCount: user.penaltyCount,
        status: user.status,
        suspendedUntil: user.suspendedUntil,
        refundAccount: user.refundAccount
      }
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// POST /api/v1/auth/login/{provider} -> Social Login Fallback (For simulator/compat)
app.post('/api/v1/auth/login/:provider', async (req, res) => {
  const { provider } = req.params;
  const { userId, nickname } = req.body;

  if (!['kakao', 'naver', 'google'].includes(provider)) {
    return res.status(400).json({ error: 'Invalid provider. Must be: kakao, naver, or google' });
  }

  if (!userId || !nickname) {
    return res.status(400).json({ error: 'userId and nickname are required in body' });
  }

  try {
    const db = await getDb();

    // Check if user already exists
    let user = await db.get("SELECT * FROM users WHERE id = ?", [userId]);

    if (!user) {
      const defaultPw = hashPassword("1234");
      const mockRefund = `카카오뱅크 3333-${Math.floor(10 + Math.random() * 90)}-${Math.floor(100000 + Math.random() * 900000)}`;
      // Create new user in database
      await db.run(
        `INSERT INTO users (id, password, nickname, provider, penaltyCount, status, suspendedUntil, refundAccount, penaltyFlag, createdAt) 
         VALUES (?, ?, ?, ?, 0, 'ACTIVE', 0, ?, 0, ?)`,
        [userId, defaultPw, nickname, provider, mockRefund, Date.now()]
      );
      user = { id: userId, nickname, provider, penaltyCount: 0, status: 'ACTIVE', refundAccount: mockRefund };
    }

    // Sign JWT token
    const token = jwt.sign({ id: user.id, nickname: user.nickname }, JWT_SECRET, { expiresIn: '7d' });

    return res.json({
      message: `${provider.toUpperCase()} Login successful`,
      token,
      user: {
        id: user.id,
        nickname: user.nickname,
        provider: user.provider,
        penaltyCount: user.penaltyCount || 0,
        status: user.status || 'ACTIVE',
        suspendedUntil: user.suspendedUntil || 0,
        refundAccount: user.refundAccount
      }
    });
  } catch (error) {
    console.error("Login Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/v1/users/me -> Fetch profile
app.get('/api/v1/users/me', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const user = await db.get("SELECT * FROM users WHERE id = ?", [req.user.id]);
    if (!user) return res.status(404).json({ error: "User not found" });
    return res.json(user);
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /api/v1/users/nickname -> Set/change nickname
app.patch('/api/v1/users/nickname', authenticateToken, checkSuspension, async (req, res) => {
  const { nickname } = req.body;
  const userId = req.user.id;

  if (!nickname || nickname.trim().length === 0) {
    return res.status(400).json({ error: 'Nickname cannot be empty' });
  }

  try {
    const db = await getDb();

    // Check duplicate
    const duplicate = await db.get("SELECT * FROM users WHERE nickname = ? AND id != ?", [nickname, userId]);
    if (duplicate) {
      return res.status(409).json({ error: 'Nickname is already taken' });
    }

    await db.run("UPDATE users SET nickname = ? WHERE id = ?", [nickname, userId]);

    // Generate updated JWT token
    const token = jwt.sign({ id: userId, nickname }, JWT_SECRET, { expiresIn: '7d' });

    return res.json({
      message: 'Nickname updated successfully',
      token,
      nickname
    });
  } catch (error) {
    console.error("Nickname Update Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/v1/users/me/hosted -> Fetch hosted group buys
app.get('/api/v1/users/me/hosted', authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const db = await getDb();

    const posts = await db.all(`
      SELECT p.*, u.nickname as hostNickname 
      FROM posts p
      JOIN users u ON p.hostId = u.id
      WHERE p.hostId = ?
      ORDER BY p.createdAt DESC
    `, [userId]);

    return res.json(posts.map(p => ({ ...p, locations: JSON.parse(p.locations) })));
  } catch (error) {
    console.error("Fetch Hosted Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /api/v1/users/me/joined -> Fetch joined group buys
app.get('/api/v1/users/me/joined', authenticateToken, async (req, res) => {
  const userId = req.user.id;

  try {
    const db = await getDb();

    const posts = await db.all(`
      SELECT DISTINCT p.*, u.nickname as hostNickname 
      FROM posts p
      JOIN orders o ON p.id = o.postId
      JOIN users u ON p.hostId = u.id
      WHERE o.userId = ? AND p.hostId != ?
      ORDER BY p.createdAt DESC
    `, [userId, userId]);

    return res.json(posts.map(p => ({ ...p, locations: JSON.parse(p.locations) })));
  } catch (error) {
    console.error("Fetch Joined Error:", error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ----------------------------------------------------
// 2. Group Buying Posts Routes
// ----------------------------------------------------

// POST /api/v1/posts -> Create post
app.post('/api/v1/posts', authenticateToken, checkSuspension, async (req, res) => {
  const hostId = req.user.id;
  const {
    title,
    link = "https://default-order.com",
    category = "식품",
    locations = [], // Array of pickup locations
    targetPrice,
    baseFee = 3000,
    autoConfirmFeeLimit = 1500,
    bankAccount = "카카오뱅크 3333-01-123456",
    hostRealName = "홍길동",
    items = []
  } = req.body;

  if (!title || title.trim().length === 0) {
    return res.status(400).json({ error: "Title is required" });
  }
  if (!targetPrice || targetPrice <= 0) {
    return res.status(400).json({ error: "TargetPrice must be a positive integer" });
  }

  if (!Array.isArray(locations) || locations.length === 0) {
    return res.status(400).json({ error: "At least one pickup location must be selected." });
  }
  const invalidLoc = locations.find(loc => !STANDARD_LOCATIONS.includes(loc));
  if (invalidLoc) {
    return res.status(400).json({ error: `Invalid location chosen: ${invalidLoc}` });
  }

  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ error: `Invalid category. Must be one of: [${CATEGORIES.join(', ')}]` });
  }

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "At least one host item is required." });
  }

  const postId = `post_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const hostMaskedName = maskName(hostRealName);

  try {
    const db = await getDb();

    await db.run("BEGIN TRANSACTION");

    let hostTotal = 0;
    const hostOrders = [];

    for (const item of items) {
      const { itemName, itemPrice, quantity = 1 } = item;
      if (!itemName || !itemPrice || itemPrice <= 0 || quantity <= 0) {
        await db.run("ROLLBACK");
        return res.status(400).json({ error: "Invalid item details" });
      }
      hostTotal += itemPrice * quantity;
      hostOrders.push({
        id: `order_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
        itemName,
        itemPrice,
        quantity
      });
    }

    const isCondition1Met = hostTotal >= targetPrice;
    const isCondition2Met = (baseFee / 1) < autoConfirmFeeLimit;
    const initialStatus = (isCondition1Met || isCondition2Met) ? "CONFIRMED" : "OPEN";
    const confirmedAt = initialStatus === "CONFIRMED" ? Date.now() : 0;

    await db.run(
      `INSERT INTO posts (id, title, link, category, locations, targetPrice, baseFee, autoConfirmFeeLimit, bankAccount, hostMaskedName, hostId, status, timetableSlots, confirmedAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [postId, title, link, category, JSON.stringify(locations), targetPrice, baseFee, autoConfirmFeeLimit, bankAccount, hostMaskedName, hostId, initialStatus, JSON.stringify([]), confirmedAt, Date.now()]
    );

    for (const order of hostOrders) {
      await db.run(
        `INSERT INTO orders (id, postId, userId, itemName, itemPrice, quantity, paymentStatus, sentAt, approvedAt) 
         VALUES (?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?)`,
        [order.id, postId, hostId, order.itemName, order.itemPrice, order.quantity, Date.now(), Date.now()]
      );
    }

    await db.run("COMMIT");

    if (initialStatus === "CONFIRMED") {
      await dispatchConfirmationNotifications(db, postId);
    }

    return res.status(201).json({
      message: "SOME THING room created successfully",
      postId,
      status: initialStatus
    });

  } catch (error) {
    console.error("Create Post Error:", error);
    try {
      const db = await getDb();
      await db.run("ROLLBACK");
    } catch (_) { }
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET /api/v1/posts -> List all posts supporting multi-select location queries!
app.get('/api/v1/posts', async (req, res) => {
  const { category, location, locations } = req.query;

  // Support locations/location query params as both array and comma-separated string
  let searchLocations = [];
  const locVal = locations || location;
  if (locVal) {
    if (Array.isArray(locVal)) {
      searchLocations = locVal;
    } else {
      searchLocations = locVal.split(',');
    }
  }

  try {
    const db = await getDb();

    let sql = `
      SELECT p.*, u.nickname as hostNickname,
             SUM(o.itemPrice * o.quantity) as currentOrderAmount,
             COUNT(DISTINCT o.userId) as participantCount
      FROM posts p
      JOIN users u ON p.hostId = u.id
      LEFT JOIN orders o ON p.id = o.postId
    `;

    const params = [];
    const conditions = [];

    if (category) {
      conditions.push("p.category = ?");
      params.push(category);
    }

    if (conditions.length > 0) {
      sql += " WHERE " + conditions.join(" AND ");
    }

    sql += " GROUP BY p.id ORDER BY p.createdAt DESC";

    const posts = await db.all(sql, params);

    const formatted = posts
      .map(post => {
        const locationsArray = JSON.parse(post.locations);
        const remainingAmount = Math.max(0, post.targetPrice - (post.currentOrderAmount || 0));
        return {
          id: post.id,
          title: post.title,
          link: post.link,
          category: post.category,
          locations: locationsArray,
          targetPrice: post.targetPrice,
          baseFee: post.baseFee,
          status: post.status,
          hostNickname: post.hostNickname,
          participantCount: post.participantCount || 0,
          currentOrderAmount: post.currentOrderAmount || 0,
          remainingAmount,
          createdAt: post.createdAt
        };
      })
      .filter(post => {
        if (searchLocations.length === 0) return true;
        // Matches if there is ANY overlap between post locations and query locations
        return post.locations.some(loc => searchLocations.includes(loc));
      });

    return res.json(formatted);

  } catch (error) {
    console.error("List Posts Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET /api/v1/posts/{postId} -> Fetch details
app.get('/api/v1/posts/:postId', async (req, res) => {
  const { postId } = req.params;

  try {
    const db = await getDb();

    const post = await db.get(`
      SELECT p.*, u.nickname as hostNickname
      FROM posts p
      JOIN users u ON p.hostId = u.id
      WHERE p.id = ?
    `, [postId]);

    if (!post) return res.status(404).json({ error: "Post not found" });

    const participantsData = await db.all(`
      SELECT o.userId, u.nickname, SUM(o.itemPrice * o.quantity) as individualTotal
      FROM orders o
      JOIN users u ON o.userId = u.id
      WHERE o.postId = ?
      GROUP BY o.userId
    `, [postId]);

    const participantCount = participantsData.length;
    const totalAccumulated = participantsData.reduce((sum, p) => sum + p.individualTotal, 0);
    const isFreeShippingMet = totalAccumulated >= post.targetPrice;
    const calculatedSplitFee = isFreeShippingMet ? 0 : Math.round(post.baseFee / participantCount);

    return res.json({
      id: post.id,
      title: post.title,
      link: post.link,
      category: post.category,
      locations: JSON.parse(post.locations),
      targetPrice: post.targetPrice,
      baseFee: post.baseFee,
      autoConfirmFeeLimit: post.autoConfirmFeeLimit,
      hostId: post.hostId,
      hostNickname: post.hostNickname,
      status: post.status,
      timetableSlots: JSON.parse(post.timetableSlots || '[]'),
      confirmedAt: post.confirmedAt,
      participantCount,
      totalAccumulated,
      isFreeShippingMet,
      calculatedSplitFee,
      caseType: isFreeShippingMet ? "A" : "B"
    });

  } catch (error) {
    console.error("Get Post Detail Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ----------------------------------------------------
// 3. Order & Room Routes
// ----------------------------------------------------

// POST /api/v1/posts/{postId}/join -> Join group buy
app.post('/api/v1/posts/:postId/join', authenticateToken, checkSuspension, async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;
  const { items = [], consent = false } = req.body;

  if (!consent) {
    return res.status(400).json({ error: "배송비 자동 승인 한도 약관 동의를 완료하셔야 합니다." });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "최소 1개 이상의 구매 상품을 담으셔야 합니다." });
  }

  try {
    const db = await getDb();

    const post = await db.get("SELECT * FROM posts WHERE id = ?", [postId]);
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (post.status === "COMPLETED") {
      return res.status(400).json({ error: "이 띵 룸은 이미 마감 및 배송 배포 완료된 룸입니다." });
    }

    await db.run("BEGIN TRANSACTION");

    // Overwrite previous items inside this pool
    await db.run("DELETE FROM orders WHERE postId = ? AND userId = ?", [postId, userId]);

    for (const item of items) {
      const { itemName, itemPrice, quantity = 1 } = item;
      if (!itemName || !itemPrice || itemPrice <= 0 || quantity <= 0) {
        await db.run("ROLLBACK");
        return res.status(400).json({ error: "Invalid item quantities/prices" });
      }
      const orderId = `order_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
      await db.run(
        `INSERT INTO orders (id, postId, userId, itemName, itemPrice, quantity, paymentStatus, sentAt, approvedAt)
         VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, 0)`,
        [orderId, postId, userId, itemName, itemPrice, quantity]
      );
    }

    const participantsData = await db.all(`
      SELECT o.userId, SUM(o.itemPrice * o.quantity) as individualTotal
      FROM orders o
      WHERE o.postId = ?
      GROUP BY o.userId
    `, [postId]);

    const participantCount = participantsData.length;
    const totalAccumulated = participantsData.reduce((sum, p) => sum + p.individualTotal, 0);
    const isCondition1Met = totalAccumulated >= post.targetPrice;
    const isCondition2Met = (post.baseFee / participantCount) < post.autoConfirmFeeLimit;

    let updatedStatus = post.status;
    let confirmedAt = post.confirmedAt;
    if (post.status === 'OPEN' && (isCondition1Met || isCondition2Met)) {
      updatedStatus = "CONFIRMED";
      confirmedAt = Date.now();
      await db.run("UPDATE posts SET status = 'CONFIRMED', confirmedAt = ? WHERE id = ?", [confirmedAt, postId]);
    }

    await db.run("COMMIT");

    if (post.status === 'OPEN' && updatedStatus === 'CONFIRMED') {
      await dispatchConfirmationNotifications(db, postId);
    }

    const currentUserTotal = items.reduce((sum, i) => sum + (i.itemPrice * (i.quantity || 1)), 0);
    const splitFee = isCondition1Met ? 0 : Math.round(post.baseFee / participantCount);
    const individualCost = currentUserTotal + splitFee;

    return res.json({
      message: "N Thing?! 합류 완료",
      status: updatedStatus,
      totalAccumulated,
      participantCount,
      settlement: (updatedStatus === 'CONFIRMED' || post.status === 'CONFIRMED') ? {
        hostBankAccount: post.bankAccount,
        hostMaskedName: post.hostMaskedName,
        itemsCost: currentUserTotal,
        splitDeliveryFee: splitFee,
        individualCost: individualCost
      } : null
    });

  } catch (error) {
    console.error("Join Room Error:", error);
    try {
      const db = await getDb();
      await db.run("ROLLBACK");
    } catch (_) { }
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET /api/v1/posts/{postId}/members -> Return active members and payment status
app.get('/api/v1/posts/:postId/members', async (req, res) => {
  const { postId } = req.params;

  try {
    const db = await getDb();

    const post = await db.get("SELECT id, baseFee, targetPrice FROM posts WHERE id = ?", [postId]);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const ordersList = await db.all(`
      SELECT o.userId, u.nickname, o.itemName, o.itemPrice, o.quantity, o.paymentStatus, o.sentAt, o.approvedAt
      FROM orders o
      JOIN users u ON o.userId = u.id
      WHERE o.postId = ?
    `, [postId]);

    const participantsMap = {};
    for (const item of ordersList) {
      const { userId, nickname, itemName, itemPrice, quantity, paymentStatus, sentAt, approvedAt } = item;
      if (!participantsMap[userId]) {
        participantsMap[userId] = {
          userId,
          nickname,
          paymentStatus,
          sentAt,
          approvedAt,
          items: [],
          individualTotal: 0
        };
      }
      participantsMap[userId].items.push({ itemName, itemPrice, quantity });
      participantsMap[userId].individualTotal += itemPrice * quantity;

      if (paymentStatus === 'SENT' && participantsMap[userId].paymentStatus !== 'APPROVED') {
        participantsMap[userId].paymentStatus = 'SENT';
      }
      if (paymentStatus === 'PENDING' && participantsMap[userId].paymentStatus !== 'SENT' && participantsMap[userId].paymentStatus !== 'APPROVED') {
        participantsMap[userId].paymentStatus = 'PENDING';
      }
    }

    const participants = Object.values(participantsMap);
    const participantCount = participants.length;
    const totalAccumulated = participants.reduce((sum, p) => sum + p.individualTotal, 0);
    const isFreeShippingMet = totalAccumulated >= post.targetPrice;
    const splitFee = isFreeShippingMet ? 0 : Math.round(post.baseFee / (participantCount || 1));

    for (const p of participants) {
      p.splitDeliveryFee = splitFee;
      p.individualCost = p.individualTotal + splitFee;
    }

    return res.json(participants);

  } catch (error) {
    console.error("Get Room Members Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET /api/v1/posts/{postId}/account -> Secure payment account details (confirmed participants ONLY)
app.get('/api/v1/posts/:postId/account', authenticateToken, async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;

  try {
    const db = await getDb();

    const post = await db.get("SELECT status, bankAccount, hostMaskedName, hostId FROM posts WHERE id = ?", [postId]);
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (!['CONFIRMED', 'ARRIVED', 'COMPLETED'].includes(post.status)) {
      return res.status(403).json({
        error: "🚫 LOCKED: 공동구매 방 상태가 확정 된 이후에만 계좌번호가 개방됩니다."
      });
    }

    const isHost = post.hostId === userId;
    const order = await db.get("SELECT id FROM orders WHERE postId = ? AND userId = ?", [postId, userId]);

    if (!isHost && !order) {
      return res.status(403).json({
        error: "🚫 UNAUTHORIZED: 해당 공동구매 방에 참가(주문접수)한 띵원만 정산 계좌번호를 열람할 수 있습니다."
      });
    }

    return res.json({
      bankAccount: post.bankAccount,
      hostMaskedName: post.hostMaskedName
    });

  } catch (error) {
    console.error("Secure Account Fetch Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// POST /api/v1/posts/{postId}/payment/send -> Participant marks order as SENT
app.post('/api/v1/posts/:postId/payment/send', authenticateToken, checkSuspension, async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;

  try {
    const db = await getDb();

    const order = await db.get("SELECT id FROM orders WHERE postId = ? AND userId = ?", [postId, userId]);
    if (!order) return res.status(404).json({ error: "Order not found in this post" });

    const sentAt = Date.now();

    await db.run(
      "UPDATE orders SET paymentStatus = 'SENT', sentAt = ? WHERE postId = ? AND userId = ?",
      [sentAt, postId, userId]
    );

    return res.json({ message: "송금 완료 신고가 처리되었습니다. 호스트가 확인 후 입금을 최종 승인하게 됩니다.", sentAt });

  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/v1/posts/{postId}/payment/approve/{userId} -> Host approves deposit
app.post('/api/v1/posts/:postId/payment/approve/:userId', authenticateToken, checkSuspension, async (req, res) => {
  const { postId, userId } = req.params;
  const hostId = req.user.id;

  try {
    const db = await getDb();

    const post = await db.get("SELECT hostId, confirmedAt, title FROM posts WHERE id = ?", [postId]);
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (post.hostId !== hostId) {
      return res.status(403).json({ error: "띵장(호스트) 전용 권한입니다." });
    }

    const order = await db.get("SELECT paymentStatus, sentAt FROM orders WHERE postId = ? AND userId = ?", [postId, userId]);
    if (!order) return res.status(404).json({ error: "Participant order record not found" });

    await db.run("BEGIN TRANSACTION");

    await db.run(
      "UPDATE orders SET paymentStatus = 'APPROVED', approvedAt = ? WHERE postId = ? AND userId = ?",
      [Date.now(), postId, userId]
    );

    const elapsedSinceConfirmation = (order.sentAt || Date.now()) - post.confirmedAt;
    const isLate = elapsedSinceConfirmation > 24 * 60 * 60 * 1000;

    let penaltyApplied = false;
    let newPenaltyCount = 0;
    let newStatus = 'ACTIVE';
    let suspendedUntil = 0;

    if (isLate) {
      const user = await db.get("SELECT penaltyCount FROM users WHERE id = ?", [userId]);
      newPenaltyCount = (user.penaltyCount || 0) + 1;

      if (newPenaltyCount === 1) {
        newStatus = 'SUSPENDED_3D';
        suspendedUntil = Date.now() + 3 * 24 * 60 * 60 * 1000;
      } else if (newPenaltyCount === 2) {
        newStatus = 'SUSPENDED_30D';
        suspendedUntil = Date.now() + 30 * 24 * 60 * 60 * 1000;
      } else {
        newStatus = 'BANNED';
        suspendedUntil = 0;
      }

      await db.run(
        "UPDATE users SET penaltyCount = ?, status = ?, suspendedUntil = ? WHERE id = ?",
        [newPenaltyCount, newStatus, suspendedUntil, userId]
      );
      penaltyApplied = true;
    }

    await db.run("COMMIT");

    return res.json({
      message: "입금 승인이 정상 처리되었습니다.",
      penaltyApplied,
      penaltyDetails: penaltyApplied ? {
        offenseLevel: newPenaltyCount,
        nextStatus: newStatus,
        suspendedUntil
      } : null
    });

  } catch (error) {
    console.error("Approve Deposit Error:", error);
    try {
      const db = await getDb();
      await db.run("ROLLBACK");
    } catch (_) { }
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// POST /api/v1/posts/{postId}/arrive -> Host triggers item arrival
app.post('/api/v1/posts/:postId/arrive', authenticateToken, checkSuspension, async (req, res) => {
  const { postId } = req.params;
  const hostId = req.user.id;

  try {
    const db = await getDb();

    const post = await db.get("SELECT hostId, title FROM posts WHERE id = ?", [postId]);
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (post.hostId !== hostId) {
      return res.status(403).json({ error: "호스트 전용 권한입니다." });
    }

    await db.run("BEGIN TRANSACTION");
    await db.run("UPDATE posts SET status = 'ARRIVED' WHERE id = ?", [postId]);

    // Fetch participants of this post (excluding host) to generate notifications
    const members = await db.all("SELECT DISTINCT userId FROM orders WHERE postId = ? AND userId != ?", [postId, hostId]);
    for (const member of members) {
      const arrivalTitle = `[물품 도착 알림] ${post.title}`;
      const arrivalContent = `띵장이 수령한 배송 물품이 약속 장소에 도착했습니다!\n위클리 시간표 수령 예약을 선착순으로 작성하셔서 차질없이 물품을 찾아가시기 바랍니다.`;
      await createNotification(db, member.userId, arrivalTitle, arrivalContent, 'ARRIVAL');
    }

    await db.run("COMMIT");

    return res.json({ message: "물품도착 알림이 전송되었습니다." });

  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/v1/posts/{postId}/rescue -> Host triggers Rescue Mode
app.post('/api/v1/posts/:postId/rescue', authenticateToken, checkSuspension, async (req, res) => {
  const { postId } = req.params;
  const hostId = req.user.id;
  const { ejectedUserIds = [], actionStrategy } = req.body;

  if (!actionStrategy || !['RE_OPEN', 'SPLIT_REMAINING'].includes(actionStrategy)) {
    return res.status(400).json({ error: "Invalid or missing actionStrategy. Must be 'RE_OPEN' or 'SPLIT_REMAINING'" });
  }

  try {
    const db = await getDb();

    const post = await db.get("SELECT hostId, status, confirmedAt, title, baseFee, targetPrice, bankAccount FROM posts WHERE id = ?", [postId]);
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (post.hostId !== hostId) {
      return res.status(403).json({ error: "호스트 전용 권한입니다." });
    }

    await db.run("BEGIN TRANSACTION");

    try {
      // Calculate previous split fee before any database deletion
      const allPreviousOrders = await db.all("SELECT userId, itemPrice, quantity FROM orders WHERE postId = ?", [postId]);
      const previousUserIds = Array.from(new Set(allPreviousOrders.map(o => o.userId)));
      const previousCount = previousUserIds.length;
      const previousTotalAmount = allPreviousOrders.reduce((sum, o) => sum + o.itemPrice * o.quantity, 0);
      const previousFreeShippingMet = previousTotalAmount >= post.targetPrice;
      const previousSplitFee = previousFreeShippingMet ? 0 : Math.round(post.baseFee / (previousCount || 1));

      // Eject users and apply penalty + refund logic
      if (Array.isArray(ejectedUserIds) && ejectedUserIds.length > 0) {
        for (const uid of ejectedUserIds) {
          const user = await db.get("SELECT nickname, refundAccount, penaltyCount FROM users WHERE id = ?", [uid]);
          if (!user) continue;

          // Remove orders and slots
          await db.run("DELETE FROM orders WHERE postId = ? AND userId = ?", [postId, uid]);
          await db.run("DELETE FROM pickup_slots WHERE postId = ? AND userId = ?", [postId, uid]);

          // Apply penalty count & suspend status
          const newPenaltyCount = (user.penaltyCount || 0) + 1;
          let newStatus = 'ACTIVE';
          let suspendedUntil = 0;
          if (newPenaltyCount === 1) {
            newStatus = 'SUSPENDED_3D';
            suspendedUntil = Date.now() + 3 * 24 * 60 * 60 * 1000;
          } else if (newPenaltyCount === 2) {
            newStatus = 'SUSPENDED_30D';
            suspendedUntil = Date.now() + 30 * 24 * 60 * 60 * 1000;
          } else {
            newStatus = 'BANNED';
            suspendedUntil = 0;
          }

          await db.run(
            "UPDATE users SET penaltyCount = ?, status = ?, suspendedUntil = ?, penaltyFlag = 1 WHERE id = ?",
            [newPenaltyCount, newStatus, suspendedUntil, uid]
          );

          // Eviction notification to the evicted user
          const evictedTitle = `[공구 방출] 미입금 연체 방출 및 패널티 부과 안내`;
          const evictedContent = `귀하가 참여 중인 공동구매 '${post.title}'에서 24시간 정산 기한 내에 입금이 확인되지 않아 자동 방출 처리되었습니다.\n• 적용 패널티: 벌점 1회 누적\n• 제재 등급: ${newStatus === 'SUSPENDED_3D' ? '🚫 3일 이용정지' : newStatus === 'SUSPENDED_30D' ? '🚫 30일 이용정지' : '🛑 영구 정지 (BAN)'}\n• 입금 내역이 확인되지 않아 환불 대상에는 포함되지 않습니다.`;
          await createNotification(db, uid, evictedTitle, evictedContent, 'CANCELLATION');
        }
      }

      let nextStatus = post.status;

      if (actionStrategy === 'RE_OPEN') {
        nextStatus = 'OPEN';
        await db.run("UPDATE posts SET status = 'OPEN', confirmedAt = 0 WHERE id = ?", [postId]);
      } else if (actionStrategy === 'SPLIT_REMAINING') {
        nextStatus = 'CONFIRMED';
        await db.run("UPDATE posts SET status = 'CONFIRMED' WHERE id = ?", [postId]);
      }

      await db.run("COMMIT");

      // Notify remaining members
      const remainingMembers = await db.all(
        "SELECT DISTINCT userId FROM orders WHERE postId = ? AND userId != ?",
        [postId, hostId]
      );

      if (actionStrategy === 'RE_OPEN') {
        for (const member of remainingMembers) {
          const memberTitle = `[공구 재오픈] 공구 방 재모집 안내`;
          const memberContent = `미입금 인원 방출로 인해 공동구매 '${post.title}'가 다시 모집 중(OPEN) 상태로 복구되었습니다. 신규 띵원이 충원되어 무료배송 조건이 충족되거나 배송비 자동승인 한도가 충족되면 재확정됩니다.`;
          await createNotification(db, member.userId, memberTitle, memberContent, 'CANCELLATION');
        }
      } else if (actionStrategy === 'SPLIT_REMAINING') {
        const newMembers = await db.all("SELECT DISTINCT userId FROM orders WHERE postId = ?", [postId]);
        const newCount = newMembers.length;

        // Check if free shipping is still met
        const remainingTotalRows = await db.all("SELECT itemPrice, quantity FROM orders WHERE postId = ?", [postId]);
        const remainingTotal = remainingTotalRows.reduce((sum, o) => sum + (o.itemPrice * o.quantity), 0);
        const freeShippingStillMet = remainingTotal >= post.targetPrice;
        const newSplitFee = freeShippingStillMet ? 0 : Math.round(post.baseFee / (newCount || 1));

        const additionalShippingFee = Math.max(0, newSplitFee - previousSplitFee);

        for (const member of remainingMembers) {
          const memberTitle = `미입금자 발생으로 인한 배송비 조정 발생 !`;
          const memberContent = `미입금 인원 방출로 공동구매 배송비가 1/N 재조정되었습니다.\n• 추가 송금해야 할 배송비: ${additionalShippingFee.toLocaleString()}원 (기존 배송비 ${previousSplitFee.toLocaleString()}원 → 변경 배송비 ${newSplitFee.toLocaleString()}원)\n• 띵장 송금 계좌: ${post.bankAccount}\n\n차액 ${additionalShippingFee.toLocaleString()}원을 위 계좌로 즉시 송금해 주시기 바랍니다.`;
          await createNotification(db, member.userId, memberTitle, memberContent, 'CANCELLATION');
        }
      }

      // Retrieve recalculated stats
      const participantsData = await db.all(`
        SELECT userId, SUM(itemPrice * quantity) as individualTotal
        FROM orders
        WHERE postId = ?
        GROUP BY userId
      `, [postId]);
      const participantCount = participantsData.length;
      const totalAccumulated = participantsData.reduce((sum, p) => sum + p.individualTotal, 0);

      const returnMessage = actionStrategy === 'RE_OPEN'
        ? "미입금자 방출 후 공구 재오픈 완료!"
        : "미입금자 방출 후 남은 띵원들에게 추가 배송비 입금 알림 발송 완료!";

      return res.json({
        message: returnMessage,
        status: nextStatus,
        participantCount,
        totalAccumulated
      });

    } catch (err) {
      await db.run("ROLLBACK");
      throw err;
    }

  } catch (error) {
    console.error("Rescue Post Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// POST /api/v1/posts/{postId}/timetable -> Host sets available timetable slots
app.post('/api/v1/posts/:postId/timetable', authenticateToken, checkSuspension, async (req, res) => {
  const { postId } = req.params;
  const hostId = req.user.id;
  const { slots = [] } = req.body;

  try {
    const db = await getDb();

    const post = await db.get("SELECT hostId FROM posts WHERE id = ?", [postId]);
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (post.hostId !== hostId) {
      return res.status(403).json({ error: "호스트 전용 권한입니다." });
    }

    await db.run("UPDATE posts SET timetableSlots = ? WHERE id = ?", [JSON.stringify(slots), postId]);

    return res.json({ message: "시간표가 등록되었습니다.", slots });

  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/v1/posts/{postId}/pickup -> Participant books a slot (strict location conflict check & Single selection constraint)
app.post('/api/v1/posts/:postId/pickup', authenticateToken, checkSuspension, async (req, res) => {
  const { postId } = req.params;
  const userId = req.user.id;
  const { slotKey, location } = req.body;

  if (!slotKey || !location) {
    return res.status(400).json({ error: "slotKey and location are required inputs." });
  }

  // Validate 30-minute intervals (e.g. Wed-14:00, Wed-14:30)
  const keyParts = slotKey.split('-');
  const timeVal = keyParts[keyParts.length - 1];
  if (timeVal) {
    const tParts = timeVal.split(':');
    if (tParts.length === 2) {
      const mins = parseInt(tParts[1], 10);
      if (mins !== 0 && mins !== 30) {
        return res.status(400).json({ error: "수령 예약 시간은 30분 단위여야 합니다. (예: 14:00, 14:30)" });
      }
    } else {
      return res.status(400).json({ error: "올바르지 않은 시간 형식입니다." });
    }
  } else {
    return res.status(400).json({ error: "올바르지 않은 시간 형식입니다." });
  }

  try {
    const db = await getDb();

    // Verify post status
    const post = await db.get("SELECT status, timetableSlots, locations FROM posts WHERE id = ?", [postId]);
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (post.status !== "ARRIVED" && post.status !== "CONFIRMED") {
      return res.status(400).json({ error: "수령 예약이 불가능한 방 상태입니다." });
    }

    // Verify slot is enabled by host
    const hostSlots = JSON.parse(post.timetableSlots || '[]');
    if (!hostSlots.includes(slotKey)) {
      return res.status(400).json({ error: "호스트가 지정하지 않은 수령 슬롯 시간대입니다." });
    }

    // Verify pickup location
    const postLocations = JSON.parse(post.locations);
    if (!postLocations.includes(location)) {
      return res.status(400).json({ error: "미지정 수령 장소입니다." });
    }

    // FIRST-COME, FIRST-SERVED CONFLICT VALIDATION:
    const existingBookings = await db.all("SELECT * FROM pickup_slots WHERE postId = ? AND slotKey = ?", [postId, slotKey]);

    if (existingBookings.length > 0) {
      // Slot is occupied, check if existing bookings are at a different gate
      const occupiedLocation = existingBookings[0].location;
      if (occupiedLocation !== location) {
        return res.status(409).json({
          error: `🚫 예약 충돌: 해당 시간대(${slotKey})는 이미 다른 띵원이 '${occupiedLocation}'에서 수령하기로 선점했습니다. 동일한 '${occupiedLocation}'에서 합수령을 예약하시거나, 다른 시간대를 선택하십시오!`
        });
      }
    }

    // STRICT SINGLE BOOKING CONSTRAINT ENFORCEMENT:
    // Deletes ANY previous slot booking by this participant in this group buy to keep exactly ONE active slot!
    await db.run("BEGIN TRANSACTION");
    await db.run("DELETE FROM pickup_slots WHERE postId = ? AND userId = ?", [postId, userId]);

    const slotId = `slot_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    await db.run(
      "INSERT INTO pickup_slots (id, postId, userId, slotKey, location, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
      [slotId, postId, userId, slotKey, location, Date.now()]
    );
    await db.run("COMMIT");

    return res.json({
      message: "수령 일정 예약이 등록되었습니다 (기존 수령 예약은 자동 변경/취소 되었습니다).",
      slotKey,
      location
    });

  } catch (error) {
    console.error("Booking Slot Error:", error);
    try {
      const db = await getDb();
      await db.run("ROLLBACK");
    } catch (_) { }
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// GET /api/v1/posts/{postId}/pickup/bookings -> Return list of slot bookings
app.get('/api/v1/posts/:postId/pickup/bookings', async (req, res) => {
  const { postId } = req.params;

  try {
    const db = await getDb();

    const bookings = await db.all(`
      SELECT s.*, u.nickname 
      FROM pickup_slots s
      JOIN users u ON s.userId = u.id
      WHERE s.postId = ?
    `, [postId]);

    // Sort active slots dynamically based on the current system timestamp: closest date and time first
    const now = new Date();
    const currentDay = now.getDay(); // 0 is Sun, 1 is Mon, ..., 6 is Sat
    const dayMap = { 'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6 };

    const getSlotTimestamp = (slotKey) => {
      if (!slotKey) return 0;
      const [dayStr, timeStr] = slotKey.split('-');
      if (!dayStr || !timeStr) return 0;
      const [hourStr, minStr] = timeStr.split(':');

      const targetDayIndex = dayMap[dayStr];
      if (targetDayIndex === undefined) return 0;

      let diffDays = targetDayIndex - currentDay;
      const targetDate = new Date(now);
      targetDate.setDate(now.getDate() + diffDays);
      targetDate.setHours(parseInt(hourStr, 10), parseInt(minStr, 10), 0, 0);

      if (targetDate.getTime() < now.getTime()) {
        targetDate.setDate(targetDate.getDate() + 7);
      }
      return targetDate.getTime();
    };

    bookings.sort((a, b) => getSlotTimestamp(a.slotKey) - getSlotTimestamp(b.slotKey));

    return res.json(bookings);
  } catch (err) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/v1/notifications -> Fetch notifications for user
app.get('/api/v1/notifications', authenticateToken, async (req, res) => {
  try {
    const db = await getDb();
    const notifs = await db.all(
      "SELECT * FROM notifications WHERE userId = ? ORDER BY createdAt DESC",
      [req.user.id]
    );
    return res.json(notifs);
  } catch (err) {
    console.error("Fetch Notifications Error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// PATCH /api/v1/notifications/:id/read -> Mark notification as read
app.patch('/api/v1/notifications/:id/read', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const db = await getDb();
    const notif = await db.get("SELECT userId FROM notifications WHERE id = ?", [id]);
    if (!notif) return res.status(404).json({ error: "Notification not found" });

    if (notif.userId !== req.user.id) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await db.run("UPDATE notifications SET read = 1 WHERE id = ?", [id]);
    return res.json({ message: "Notification marked as read" });
  } catch (err) {
    console.error("Mark Read Error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});


// Start Express App & background scheduler
app.listen(PORT, async () => {
  console.log(`🛒 N Thing?! (몇띵?!) Upgraded Server running on http://localhost:${PORT}`);
});