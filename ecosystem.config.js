module.exports = {
  apps: [
    {
      name: "liuxianlab",
      script: "npm",
      args: "start",
      env: {
        NODE_ENV: "production",
        SESSION_SECRET: "你的随机字符串"
      }
    }
  ]
}
