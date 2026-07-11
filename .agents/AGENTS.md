# Agent Rules for High Robustness Execution

## 1. 防御性命令行执行规范
为了避免在用户的 Electron 聊天界面中产生烦人的 `⚠️ 🛠️ <command> failed` 系统提示条，所有代理在通过 `run_command` 工具执行系统检测或诊断命令时，必须遵守以下规范：

1. **零崩溃退出保证**：任何执行可能不存在或可能由于环境差异而报错的命令（例如 `dotnet`，`wmic`，`netstat` 等），必须保证其执行的 Exit Code 恒为 `0`（即成功状态）。
2. **使用 PowerShell try-catch 包裹**：在执行可能失败的程序时，将其包装进 PowerShell 脚本，利用 `try { <command> } catch {}` 将错误静默拦截，不要将其抛出给 shell 的异常处理器。
   - *错误示范*：`dotnet --version`
   - *正确示范*：`powershell -NoProfile -Command "try { if (Get-Command dotnet -ErrorAction SilentlyContinue) { dotnet --version } else { Write-Output 'dotnet not installed' } } catch {}"`
3. **针对 Windows 11 下废弃的 wmic 命令**：绝不要直接在裸 shell 里执行 `wmic`，而应该先探测是否存在，或直接使用 CIM/WMI 的现代 PowerShell 等等效 cmdlet（如 `Get-CimInstance`）作为首选方案，并加上 `try-catch`。
   - *正确示范*：`powershell -NoProfile -Command "try { Get-CimInstance Win32_Processor | Select-Object Name,NumberOfCores,NumberOfLogicalProcessors | Format-List } catch {}"`
4. **重定向错误流**：对于非交互式探测命令，确保使用 `2>$null` 或 `2>nul` 丢弃 stderr 报错。
