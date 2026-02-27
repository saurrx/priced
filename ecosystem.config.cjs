module.exports = {
    apps: [
        {
            name: "actions-server",
            script: "npm",
            args: "run start",
            cwd: "./actions-server",
            env: {
                PORT: 3000,
                NODE_ENV: "production",
            }
        },
        {
            name: "python-backend",
            script: "venv/bin/uvicorn",
            args: "main:app --host 0.0.0.0 --port 8000",
            cwd: "./server",
            interpreter: "none"
        },
        {
            name: "jupiter-sync-cron",
            script: "npm",
            args: "run sync",
            cwd: ".",
            instances: 1,
            autorestart: false,
            cron_restart: "*/30 * * * *",
            watch: false
        }
    ]
};
