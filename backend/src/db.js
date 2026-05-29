import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '../dding.db');

export const STANDARD_LOCATIONS = [
  "농장문", "누리관문", "텍문", "나리문", "동문", "정문", "수의대문", "쪽문", "조은문", "솔로문",
  "서문", "수영장문", "어린이집문", "북문", "보람관", "누리관", "첨성관", "향토관", "봉사관", "화목관"
];

export const CATEGORIES = [
  "식품", "문구류", "의류", "생활", "뷰티", "도서", "기타"
];

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

let db = null;

export async function getDb() {
  if (db) return db;

  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  // Enable foreign keys
  await db.run("PRAGMA foreign_keys = ON;");

  // Rebuild the schema
  await db.exec(`
    DROP TABLE IF EXISTS pickup_slots;
    DROP TABLE IF EXISTS orders;
    DROP TABLE IF EXISTS posts;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS notifications;

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      password TEXT, -- SHA-255 hash (null for social fallback simulators)
      nickname TEXT UNIQUE NOT NULL,
      provider TEXT NOT NULL CHECK(provider IN ('kakao', 'naver', 'google', 'local')),
      penaltyCount INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'SUSPENDED_3D', 'SUSPENDED_30D', 'BANNED')),
      suspendedUntil INTEGER DEFAULT 0,
      refundAccount TEXT,
      penaltyFlag INTEGER DEFAULT 0,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      link TEXT NOT NULL,
      category TEXT NOT NULL,
      locations TEXT NOT NULL, -- Serialized JSON array of strings
      targetPrice INTEGER NOT NULL,
      baseFee INTEGER NOT NULL,
      autoConfirmFeeLimit INTEGER NOT NULL,
      bankAccount TEXT NOT NULL,
      hostMaskedName TEXT NOT NULL,
      hostId TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('OPEN', 'CONFIRMED', 'ARRIVED', 'COMPLETED')),
      timetableSlots TEXT, -- Serialized JSON array of strings (e.g. ["Mon-10:00", "Mon-10:30"])
      confirmedAt INTEGER DEFAULT 0,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (hostId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      postId TEXT NOT NULL,
      userId TEXT NOT NULL,
      itemName TEXT NOT NULL,
      itemPrice INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      paymentStatus TEXT DEFAULT 'PENDING' CHECK(paymentStatus IN ('PENDING', 'SENT', 'APPROVED')),
      sentAt INTEGER DEFAULT 0,
      approvedAt INTEGER DEFAULT 0,
      FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE pickup_slots (
      id TEXT PRIMARY KEY,
      postId TEXT NOT NULL,
      userId TEXT NOT NULL,
      slotKey TEXT NOT NULL, -- E.g. "Mon-10:00"
      location TEXT NOT NULL, -- Chosen gate
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (postId) REFERENCES posts(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(postId, userId) -- Strict Single Booking constraint enforced directly in DB! A user can only book ONE slot per post!
    );

    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('CONFIRMED', 'CANCELLATION', 'ARRIVAL', 'REFUND', 'GENERAL')),
      read INTEGER DEFAULT 0,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  console.log("Seeding mock data for N Tjing?! (몇 띵?!)...");

  const defaultPwHash = hashPassword("1234");

  // Seed Mock Users
  const users = [
    { id: "kakao_1", password: defaultPwHash, nickname: "침성관배고파", provider: "kakao", penaltyCount: 0, status: "ACTIVE", refundAccount: "하나은행 123-456-789012", createdAt: Date.now() },
    { id: "naver_1", password: defaultPwHash, nickname: "정문치킨요정", provider: "naver", penaltyCount: 0, status: "ACTIVE", refundAccount: "신한은행 110-222-333333", createdAt: Date.now() },
    { id: "google_1", password: defaultPwHash, nickname: "쪽문배달왕", provider: "google", penaltyCount: 0, status: "ACTIVE", refundAccount: "우체국 2004-5555-6666", createdAt: Date.now() },
    { id: "kakao_2", password: defaultPwHash, nickname: "복현관지름신", provider: "kakao", penaltyCount: 1, status: "ACTIVE", refundAccount: "농협 302-1234-5678-99", createdAt: Date.now() },
    { id: "naver_2", password: defaultPwHash, nickname: "향토관야식러", provider: "naver", penaltyCount: 0, status: "ACTIVE", refundAccount: "카카오뱅크 3333-22-111111", createdAt: Date.now() }
  ];

  for (const user of users) {
    await db.run(
      `INSERT INTO users (id, password, nickname, provider, penaltyCount, status, suspendedUntil, refundAccount, penaltyFlag, createdAt) 
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, ?)`,
      [user.id, user.password, user.nickname, user.provider, user.penaltyCount, user.status, user.refundAccount, user.createdAt]
    );
  }

  // Seed Mock Posts with 30-minute interval timetable slots
  const posts = [
    {
      id: "post_1",
      title: "[식품] 첨성관/향토관 같이 시켜요! 생수 2L 묶음배송",
      link: "https://coupang.com/water-bundle",
      category: "식품",
      locations: JSON.stringify(["첨성관", "향토관", "정문"]),
      targetPrice: 30000,
      baseFee: 3000,
      autoConfirmFeeLimit: 1200,
      bankAccount: "토스뱅크 1000-1234-5678",
      hostMaskedName: "서*은",
      hostId: "kakao_1",
      status: "OPEN",
      // Enforces 30-minute intervals
      timetableSlots: JSON.stringify(["Mon-12:00", "Mon-12:30", "Mon-13:00", "Tue-15:00", "Tue-15:30"]),
      confirmedAt: 0,
      createdAt: Date.now() - 3600000
    },
    {
      id: "post_2",
      title: "[문구류] 텍문/나리문 무선제본 노트 10개 세트 띵",
      link: "https://smartstore.naver.com/notes",
      category: "문구류",
      locations: JSON.stringify(["텍문", "나리문", "북문"]),
      targetPrice: 20000,
      baseFee: 2500,
      autoConfirmFeeLimit: 1000,
      bankAccount: "국민은행 603102-04-123456",
      hostMaskedName: "홍*동",
      hostId: "naver_1",
      status: "CONFIRMED",
      // Enforces 30-minute intervals
      timetableSlots: JSON.stringify(["Wed-10:00", "Wed-10:30", "Wed-11:00", "Thu-14:00", "Thu-14:30"]),
      confirmedAt: Date.now() - 7200000,
      createdAt: Date.now() - 10800000
    }
  ];

  for (const post of posts) {
    await db.run(
      `INSERT INTO posts (id, title, link, category, locations, targetPrice, baseFee, autoConfirmFeeLimit, bankAccount, hostMaskedName, hostId, status, timetableSlots, confirmedAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [post.id, post.title, post.link, post.category, post.locations, post.targetPrice, post.baseFee, post.autoConfirmFeeLimit, post.bankAccount, post.hostMaskedName, post.hostId, post.status, post.timetableSlots, post.confirmedAt, post.createdAt]
    );
  }

  // Seed Mock Orders
  const orders = [
    { id: "order_1", postId: "post_1", userId: "kakao_1", itemName: "쿠팡 스파클 생수 2L x 6개입", itemPrice: 6500, quantity: 2, paymentStatus: "APPROVED", sentAt: Date.now(), approvedAt: Date.now() },
    { id: "order_2", postId: "post_2", userId: "naver_1", itemName: "무선제본 무지 노트 A4", itemPrice: 12000, quantity: 1, paymentStatus: "APPROVED", sentAt: Date.now(), approvedAt: Date.now() },
    { id: "order_3", postId: "post_2", userId: "google_1", itemName: "무선제본 격자 노트 A4", itemPrice: 6000, quantity: 1, paymentStatus: "SENT", sentAt: Date.now() - 3600000 },
    { id: "order_4", postId: "post_2", userId: "kakao_2", itemName: "제본용 철제 스프링 고리", itemPrice: 3000, quantity: 1, paymentStatus: "APPROVED", sentAt: Date.now() - 7200000, approvedAt: Date.now() - 7100000 }
  ];

  for (const order of orders) {
    await db.run(
      `INSERT INTO orders (id, postId, userId, itemName, itemPrice, quantity, paymentStatus, sentAt, approvedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [order.id, order.postId, order.userId, order.itemName, order.itemPrice, order.quantity, order.paymentStatus, order.sentAt || 0, order.approvedAt || 0]
    );
  }

  // Seed Mock pickup bookings (one slot booked)
  const bookings = [
    { id: "book_1", postId: "post_2", userId: "kakao_2", slotKey: "Wed-10:00", location: "텍문", createdAt: Date.now() }
  ];

  for (const book of bookings) {
    await db.run(
      "INSERT INTO pickup_slots (id, postId, userId, slotKey, location, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
      [book.id, book.postId, book.userId, book.slotKey, book.location, book.createdAt]
    );
  }

  return db;
}
