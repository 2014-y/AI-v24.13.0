const { exec } = require('child_process');
const pid = process.pid; // 当前 node 进程的 PID
const cmd = `powershell -ExecutionPolicy Bypass -NoProfile -Command "try { (Get-Process -Id ${pid}).WorkingSet64 } catch { 0 }"`;
exec(cmd, (err, stdout) => {
    console.log("Current PID:", pid);
    console.log("Error:", err);
    console.log("Memory bytes stdout:", stdout.trim());
});
