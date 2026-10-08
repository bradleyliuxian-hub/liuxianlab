'use strict';
const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'data', 'users.json');
if (!fs.existsSync(file)) {
  console.log('当前还没有创建任何账号。');
  process.exit(0);
}
const users = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!Array.isArray(users) || users.length === 0) {
  console.log('当前还没有创建任何账号。');
  process.exit(0);
}
console.log('\nLiuxian Lab 账号列表\n');
for (const user of users) {
  console.log(`- ${user.username}${user.disabled ? ' [已停用]' : ''}`);
}
console.log('');
