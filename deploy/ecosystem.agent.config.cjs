module.exports = {
  apps: [
    {
      name: "stoppage-agent",
      cwd: "/home/linuxuser/stoppage",
      script: "node_modules/.bin/tsx",
      args: "apps/agent/src/index.ts live --live-tx",
      interpreter: "none",
      exec_mode: "fork",
      autorestart: true,
      restart_delay: 5000,
      max_restarts: 20,
      min_uptime: 10000,
      watch: false,
      env: {
        NODE_ENV: "production",
        AGENT_HTTP_PORT: "8765",
      },
    },
  ],
};
