const { exec } = require('child_process');
// 探测当前运行的 mihomo 进程
const cmd = `powershell -ExecutionPolicy Bypass -NoProfile -Command "try { Get-Process -Name *mihomo* | Select-Object Id, Name, WorkingSet64 | ConvertTo-Json } catch { Write-Output 'error' }"`;
exec(cmd, (err, stdout) => {
    console.log("Error:", err);
    console.log("Stdout:", stdout);
});
