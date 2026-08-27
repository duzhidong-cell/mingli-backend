module.exports = {
  apps: [{
    name: 'qjbx-backend',
    script: 'dist/index.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 8787,
    },
    max_memory_restart: '512M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: 'log/error.log',
    out_file: 'log/out.log',
    merge_logs: true,
  }],
};
