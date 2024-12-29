import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

// 创建或获取输出通道
let arduinoOutputChannel: vscode.OutputChannel | undefined;
function getOutputChannel(): vscode.OutputChannel {
    if (!arduinoOutputChannel) {
        arduinoOutputChannel = vscode.window.createOutputChannel('Arduino');
    }
    return arduinoOutputChannel;
}

// 验证 Arduino CLI 是否可用
export async function validateArduinoCli(): Promise<boolean> {
    const config = vscode.workspace.getConfiguration('arduino-panda');
    const cliPath = config.get<string>('cliPath');

    if (!cliPath) {
        vscode.window.showErrorMessage('请在设置中配置 Arduino CLI 路径');
        return false;
    }

    try {
        await execAsync(`"${cliPath}" version`);
        return true;
    } catch (error) {
        vscode.window.showErrorMessage(`未找到 Arduino CLI: ${cliPath}，请检查配置`);
        return false;
    }
}

// 获取可用串口列表
export async function listPorts(): Promise<Array<{ port: string; description?: string }>> {
    if (!await validateArduinoCli()) {
        throw new Error('Arduino CLI 未正确配置');
    }

    const config = vscode.workspace.getConfiguration('arduino-panda');
    const cliPath = config.get<string>('cliPath');

    try {
        const { stdout } = await execAsync(`"${cliPath}" board list --format json`);
        const portsData = JSON.parse(stdout);
        
        // 确保返回的是数组
        if (!Array.isArray(portsData)) {
            return [];
        }
        // console.log('portsData', portsData);

        // 解析新的串口数据格式
        return portsData
            .map((portInfo: any) => {
                const port = portInfo.port;
                if (!port?.address) {
                    return null;
                }

                // 构建描述信息
                let description = port.protocol_label || '';
                if (port.properties) {
                    const { vid, pid } = port.properties;
                    if (vid && pid) {
                        description += ` (VID:${vid} PID:${pid})`;
                    }
                }

                return {
                    port: port.address,
                    description: description.trim()
                };
            })
            .filter((port): port is { port: string; description: string } => port !== null);

    } catch (error) {
        throw new Error(`获取串口列表失败: ${error}`);
    }
}

// 获取可用开发板列表
export async function listBoards(): Promise<Array<{ name: string; fqbn: string }>> {
    if (!await validateArduinoCli()) {
        throw new Error('Arduino CLI 未正确配置');
    }

    const config = vscode.workspace.getConfiguration('arduino-panda');
    const cliPath = config.get<string>('cliPath');

    try {
        // 获取已安装的核心包列表
        const { stdout } = await execAsync(`"${cliPath}" core list --format json`);
        const coresData = JSON.parse(stdout);
        
        // console.log('已安装的核心包:', coresData);

        if (!Array.isArray(coresData)) {
            return [];
        }

        // 收集所有已安装核心包中的开发板
        const boards: Array<{ name: string; fqbn: string }> = [];
        
        for (const core of coresData) {
            try {
                // 获取每个平台支持的所有开发板
                const { stdout: boardsOutput } = await execAsync(
                    `"${cliPath}" board listall ${core.id} --format json`
                );
                const platformBoards = JSON.parse(boardsOutput);
                // console.log('平台开发板:', platformBoards);
                
                if (platformBoards?.boards && Array.isArray(platformBoards.boards)) {
                    platformBoards.boards.forEach((board: { name: string; fqbn: string }) => {
                        if (board.name && board.fqbn) {
                            boards.push({
                                name: board.name,
                                fqbn: board.fqbn
                            });
                        }
                    });
                }
            } catch (e) {
                console.warn(`获取平台 ${core.id} 开发板列表失败:`, e);
            }
        }

        return boards;
    } catch (error) {
        console.error('获取开发板列表错误:', error);
        throw new Error(`获取开发板列表失败: ${error}`);
    }
}

// 解析错误信息的辅助函数
function parseErrorLine(line: string): { file?: string; line?: number; col?: number; message: string } {
    // 匹配格式：文件路径:行号:列号: error: 错误信息
    const match = line.match(/([^:]+):(\d+):(\d+):\s*(error|warning):\s*(.*)/);
    if (match) {
        const [_, file, lineNum, colNum, type, msg] = match;
        return {
            file: file,
            line: parseInt(lineNum),
            col: parseInt(colNum),
            message: `${type}: ${msg}`
        };
    }
    return { message: line };
}

// 格式化错误信息
function formatError(error: { file?: string; line?: number; col?: number; message: string }): string {
    const location = error.file ? 
        `${vscode.workspace.asRelativePath(error.file)}${error.line ? `:${error.line}` : ''}` : '';
    const prefix = location ? `[${location}] ` : '';
    return `${prefix}${error.message}`;
}

// 获取编译输出路径
function getBuildPath(workspaceFolder: string | undefined): string {
    const config = vscode.workspace.getConfiguration('arduino-panda');
    let buildPath = config.get<string>('buildPath') || '${workspaceFolder}/build';
    
    // 替换变量
    if (workspaceFolder) {
        buildPath = buildPath.replace('${workspaceFolder}', workspaceFolder);
    }
    
    return buildPath;
}

// 准备编译环境
async function prepareCompileEnvironment(file: vscode.Uri): Promise<{ buildPath: string; sketchPath: string }> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(file)?.uri.fsPath;
    const buildPath = getBuildPath(workspaceFolder);
    const config = vscode.workspace.getConfiguration('arduino-panda');
    const compileMode = config.get<string>('compileMode') || 'single';
    console.log('compileMode', compileMode);

    // 确保 build 目录存在
    await vscode.workspace.fs.createDirectory(vscode.Uri.file(buildPath));

    if (compileMode === 'single') {
        // 单文件模式：复制到临时目录
        const sourceDir = path.dirname(file.fsPath);
        const sketchName = path.basename(file.fsPath, '.ino');
        const tmpDir = path.join(sourceDir, 'tmp', sketchName);
        const sketchPath = path.join(tmpDir, `${sketchName}.ino`);

        try {
            // 清理并创建临时目录
            try {
                await vscode.workspace.fs.delete(vscode.Uri.file(path.join(sourceDir, 'tmp')), { recursive: true });
            } catch (e) {
                // 忽略目录不存在的错误
            }
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(tmpDir));

            // 复制源文件
            await vscode.workspace.fs.copy(file, vscode.Uri.file(sketchPath), { overwrite: true });

            return { buildPath, sketchPath };
        } catch (error) {
            console.error('准备编译环境失败:', error);
            throw new Error(`准备编译环境失败: ${error}`);
        }
    } else {
        // 多文件模式：直接使用原始文件
        return { buildPath, sketchPath: file.fsPath };
    }
}

// 清理编译环境
async function cleanupCompileEnvironment(file: vscode.Uri): Promise<void> {
    const config = vscode.workspace.getConfiguration('arduino-panda');
    const compileMode = config.get<string>('compileMode') || 'single';

    if (compileMode === 'single') {
        // 仅在单文件模式下清理临时目录
        await cleanupTmpDir(path.dirname(file.fsPath));
    }
}

// 清理临时目录
async function cleanupTmpDir(sourceDir: string): Promise<void> {
    try {
        const tmpDir = path.join(sourceDir, 'tmp');
        await vscode.workspace.fs.delete(vscode.Uri.file(tmpDir), { recursive: true });
        console.log('临时目录清理完成:', tmpDir);
    } catch (e) {
        // 忽略清理失败的错误
        console.warn('清理临时目录失败:', e);
    }
}

// 添加进度检测函数
function parseProgress(line: string): { stage?: string; progress?: number } {
    if (line.includes('Compiling')) return { stage: '编译中', progress: 30 };
    if (line.includes('Linking')) return { stage: '链接中', progress: 60 };
    if (line.includes('Building')) return { stage: '构建中', progress: 80 };
    if (line.includes('Uploading')) return { stage: '上传中', progress: 90 };
    return {};
}

// 编译 Arduino 程序
export async function compileSketch(file: vscode.Uri, board: string): Promise<void> {
    if (!await validateArduinoCli()) {
        throw new Error('Arduino CLI 未正确配置');
    }

    const config = vscode.workspace.getConfiguration('arduino-panda');
    const cliPath = config.get<string>('cliPath');
    const outputChannel = getOutputChannel();
    
    try {
        outputChannel.clear();
        outputChannel.show(true);
        outputChannel.appendLine(`[编译] ${vscode.workspace.asRelativePath(file)}`);

        // 准备编译环境
        const { buildPath, sketchPath } = await prepareCompileEnvironment(file);

        outputChannel.appendLine(`[开发板] ${board}`);
        outputChannel.appendLine(`[输出目录] ${buildPath}`);
        outputChannel.appendLine('-------------------');

        const command = [
            `"${cliPath}"`,
            'compile',
            `--build-path "${buildPath}"`,
            `--fqbn ${board}`,
            `"${sketchPath}"`
        ].join(' ');

        console.log('执行命令:', command);
        
        const { stdout, stderr } = await execAsync(command);
        
        if (stderr) {
            const errorLines = stderr.split('\n')
                .filter(line => line.includes('error:') || line.includes('warning:'))
                .map(line => {
                    const error = parseErrorLine(line.trim());
                    return formatError(error);
                });

            if (errorLines.length > 0) {
                outputChannel.appendLine('\n编译错误/警告:');
                outputChannel.appendLine('-------------------');
                errorLines.forEach(line => {
                    outputChannel.appendLine(line);
                    
                    // 如果是错误，添加一个空行使其更易读
                    if (line.includes('error:')) {
                        outputChannel.appendLine('');
                    }
                });
            }
        }

        // 编译完成后清理临时目录
        await cleanupTmpDir(path.dirname(file.fsPath));
        outputChannel.appendLine(stdout);
        if (stdout) {
            const successMatch = stdout.match(/Compilation completed successfully/i);
            if (successMatch) {
                outputChannel.appendLine('\n✓ 编译成功');
                outputChannel.appendLine(`[生成文件] ${buildPath}/sketch.ino.hex`);
                outputChannel.appendLine(`[编译时间] ${new Date().toLocaleTimeString()}`);
            }
        }
    } catch (error: any) {
        // 发生错误时也要清理临时目录
        await cleanupTmpDir(path.dirname(file.fsPath));
        
        outputChannel.appendLine('\n× 编译失败');
        if (error.stderr) {
            const errorLines = error.stderr.split('\n')
                .filter((line: string) => line.trim())
                .map((line: string) => line.trim());
            
            errorLines.forEach((line: string) => {
                outputChannel.appendLine(line);
            });
        }
        throw new Error('编译失败');
    }
}

// 上传程序到开发板
export async function uploadToArduino(file: vscode.Uri, board: string, port: string): Promise<void> {
    if (!await validateArduinoCli()) {
        throw new Error('Arduino CLI 未正确配置');
    }

    const config = vscode.workspace.getConfiguration('arduino-panda');
    const cliPath = config.get<string>('cliPath');

    try {
        const { stdout, stderr } = await execAsync(
            `"${cliPath}" upload -p ${port} --fqbn ${board} "${file.fsPath}"`
        );
        
        // 创建输出通道显示上传信息
        const outputChannel = vscode.window.createOutputChannel('Arduino');
        outputChannel.show();
        
        if (stdout) outputChannel.appendLine(stdout);
        if (stderr) outputChannel.appendLine(stderr);
    } catch (error) {
        throw new Error(`上传失败: ${error}`);
    }
}

// 上传 hex 文件到开发板
export async function uploadHexFile(file: vscode.Uri, board: string, port: string): Promise<void> {
    if (!await validateArduinoCli()) {
        throw new Error('Arduino CLI 未正确配置');
    }

    const config = vscode.workspace.getConfiguration('arduino-panda');
    const cliPath = config.get<string>('cliPath');

    try {
        // 创建临时目录用于复制hex文件
        const tmpDir = path.join(process.env.TEMP || '', 'arduino-panda');
        const tmpHexFile = path.join(tmpDir, 'temp.hex');
        
        // 确保临时目录存在
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(tmpDir));
        
        // 复制hex文件到临时目录
        await vscode.workspace.fs.copy(file, vscode.Uri.file(tmpHexFile), { overwrite: true });

        console.log('文件路径：', {
            hexFile: tmpHexFile
        });

        // 使用 arduino-cli 上传
        const command = [
            `"${cliPath}"`,
            'upload',
            `-i "${tmpHexFile}"`,
            `-p ${port}`,
            `--fqbn ${board}`
        ].join(' ');

        console.log('执行命令:', command);
        
        const { stdout, stderr } = await execAsync(command);
        
        const outputChannel = vscode.window.createOutputChannel('Arduino');
        outputChannel.show();
        
        if (stdout) outputChannel.appendLine(stdout);
        if (stderr) outputChannel.appendLine(stderr);

        // 清理临时文件
        try {
            await vscode.workspace.fs.delete(vscode.Uri.file(tmpHexFile));
        } catch (e) {
            console.warn('清理临时文件失败:', e);
        }
    } catch (error) {
        console.error('Upload error:', error);
        throw new Error(`上传失败: ${error}`);
    }
}

// 编译并上传 Arduino 程序
export async function compileAndUpload(file: vscode.Uri, board: string, port: string): Promise<void> {
    if (!await validateArduinoCli()) {
        throw new Error('Arduino CLI 未正确配置');
    }

    const config = vscode.workspace.getConfiguration('arduino-panda');
    const cliPath = config.get<string>('cliPath');
    const outputChannel = getOutputChannel();

    try {
        outputChannel.clear();
        outputChannel.show(true);
        outputChannel.appendLine(`[编译并上传] ${vscode.workspace.asRelativePath(file)}`);

        // 准备编译环境
        const { buildPath, sketchPath } = await prepareCompileEnvironment(file);

        outputChannel.appendLine(`[开发板] ${board}`);
        outputChannel.appendLine(`[串口] ${port}`);
        outputChannel.appendLine(`[输出目录] ${buildPath}`);
        outputChannel.appendLine('-------------------');

        const command = [
            `"${cliPath}"`,
            'compile',
            '-u',
            `--build-path "${buildPath}"`,
            `-p ${port}`,
            `--fqbn ${board}`,
            `"${sketchPath}"`
        ].join(' ');

        console.log('执行命令:', command);
        
        const { stdout, stderr } = await execAsync(command);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Arduino",
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ message: "准备编译环境...", increment: 10 });
                
                // 处理输出
                const lines = stdout.split('\n');
                for (const line of lines) {
                    outputChannel.appendLine(line);
                    const { stage, progress: progressValue } = parseProgress(line);
                    if (stage) {
                        progress.report({ message: stage, increment: progressValue });
                    }
                }

                // 检查编译结果
                if (stderr && stderr.includes('error:')) {
                    throw new Error('编译错误');
                }

                // 检查上传结果
                const uploadSuccess = stdout.includes('Device responded') || 
                                    stdout.includes('avrdude done') ||
                                    stdout.includes('Upload complete');

                if (uploadSuccess) {
                    progress.report({ message: "完成", increment: 100 });
                    outputChannel.appendLine('\n✓ 编译上传成功');
                    outputChannel.appendLine(`[完成时间] ${new Date().toLocaleTimeString()}`);
                } else {
                    throw new Error('上传失败');
                }

            } catch (error) {
                // ... 错误处理代码 ...
            }
        });

        // 编译上传完成后清理临时目录
        await cleanupTmpDir(path.dirname(file.fsPath));
        // 输出stdout
        outputChannel.appendLine(stdout);
        if (stdout) {
            if (stdout.includes('Compilation completed successfully')) {
                outputChannel.appendLine('\n✓ 编译成功');
                outputChannel.appendLine(`[生成文件] ${buildPath}/sketch.ino.hex`);
            }
            if (stdout.includes('Upload successful')) {
                outputChannel.appendLine('\n✓ 上传成功');
                outputChannel.appendLine(`[上传时间] ${new Date().toLocaleTimeString()}`);
                outputChannel.appendLine(`[目标设备] ${port} (${board})`);
            }
        }
    } catch (error: any) {
        // 发生错误时也要清理临时目录
        await cleanupTmpDir(path.dirname(file.fsPath));

        outputChannel.appendLine('\n× 编译或上传失败');
        if (error.stderr) {
            const errorLines = error.stderr.split('\n')
                .filter((line: string) => line.trim())
                .map((line: string) => line.trim());
            
            errorLines.forEach((line: string) => {
                outputChannel.appendLine(line);
            });
        }
        throw new Error('编译或上传失败');
    }
} 