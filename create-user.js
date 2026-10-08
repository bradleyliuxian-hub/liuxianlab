'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const bcrypt = require('bcryptjs');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const BCRYPT_ROUNDS = 12;

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function readUsers() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    throw new Error(`无法读取 ${USERS_FILE}: ${error.message}`);
  }
}

function writeUsers(users) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tempFile = `${USERS_FILE}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(users, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempFile, USERS_FILE);
  try { fs.chmodSync(USERS_FILE, 0o600); } catch (_) {}
}

function ask(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(query, (answer) => {
    rl.close();
    resolve(answer);
  }));
}

function askHidden(query) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    if (!stdin.isTTY) {
      return reject(new Error('需要在交互式终端中输入密码。'));
    }

    stdout.write(query);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';

    function cleanup() {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
    }

    function onData(char) {
      if (char === '\u0003') {
        cleanup();
        stdout.write('\n');
        process.exit(130);
      }
      if (char === '\r' || char === '\n') {
        cleanup();
        stdout.write('\n');
        return resolve(value);
      }
      if (char === '\u007f' || char === '\b') {
        if (value.length > 0) {
          value = value.slice(0, -1);
          stdout.write('\b \b');
        }
        return;
      }
      if (char >= ' ' && char !== '\u007f') {
        value += char;
        stdout.write('*');
      }
    }

    stdin.on('data', onData);
  });
}

async function main() {
  console.log('\nLiuxian Lab · 创建账号\n');

  const usernameArg = process.argv[2];
  const rawUsername = usernameArg || await ask('账号（3-32位，字母/数字/._-）：');
  const username = normalizeUsername(rawUsername);

  if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
    throw new Error('账号格式不正确。只能使用 3-32 位字母、数字、点、下划线或连字符。');
  }

  const users = readUsers();
  if (users.some((user) => normalizeUsername(user.username) === username)) {
    throw new Error(`账号 ${username} 已存在。`);
  }

  const password = await askHidden('密码（至少12位）：');
  const confirm = await askHidden('再次输入密码：');

  if (password.length < 12) {
    throw new Error('密码至少需要 12 位。');
  }
  if (password !== confirm) {
    throw new Error('两次输入的密码不一致。');
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  users.push({
    username,
    passwordHash,
    disabled: false,
    createdAt: new Date().toISOString()
  });
  writeUsers(users);

  console.log(`\n✓ 已创建账号：${username}`);
  console.log('✓ 密码仅保存为 bcrypt 哈希，不会写入网页代码。\n');
}

main().catch((error) => {
  console.error(`\n创建失败：${error.message}\n`);
  process.exit(1);
});
