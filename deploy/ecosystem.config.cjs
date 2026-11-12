// PM2 process file – run from the repo root:  pm2 start deploy/ecosystem.config.cjs
// Keep ONE instance (fork mode): the 5 AM backup and the payment-reminder jobs run inside
// the API process, so a cluster of N would send N reminders and take N backups.
module.exports = {
  apps: [
    {
      name: 'haulmind-india',
      cwd: __dirname + '/../backend',
      script: 'index.js',
      exec_mode: 'fork',
      instances: 1,
      env: { NODE_ENV: 'production' }, // everything else comes from backend/.env
      max_memory_restart: '700M',
      time: true,
      out_file: '/var/log/haulmind/out.log',
      error_file: '/var/log/haulmind/error.log',
      merge_logs: true,
    },
  ],
};
